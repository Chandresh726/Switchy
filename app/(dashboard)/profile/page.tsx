"use client";

import { useCallback, useMemo, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { EducationEditor } from "@/components/profile/education-editor";
import { ExperienceList } from "@/components/profile/experience-list";
import { ProfileForm } from "@/components/profile/profile-form";
import { ResumeManager } from "@/components/profile/resume-manager";
import { SkillsEditor } from "@/components/profile/skills-editor";
import { ApiErrorState } from "@/components/ui/api-error-state";
import type { ResumeData } from "@/lib/ai/resume/contracts";
import { deleteResume, getProfile } from "@/lib/api/clients/profile";
import type { Resume } from "@/lib/api/contracts/profile";
import { buildResumeReview } from "@/lib/profile/resume-review";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

type ReviewSection = "profile" | "education" | "experience" | "skills";

interface PendingResumeReview {
  key: number;
  fileName: string;
  data: ResumeData;
  resolvedSections: ReviewSection[];
}

export default function ProfilePage() {
  const [pendingResumeReview, setPendingResumeReview] =
    useState<PendingResumeReview | null>(null);

  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: queryKeys.profile.detail(),
    queryFn: getProfile,
  });

  const resumeReview = useMemo(() => {
    if (!pendingResumeReview || !profileQuery.data) return null;
    return buildResumeReview(profileQuery.data, pendingResumeReview.data);
  }, [pendingResumeReview, profileQuery.data]);

  const changedSections = useMemo(() => {
    if (!resumeReview) return [];
    const sections: ReviewSection[] = [];
    if (resumeReview.profile.changedFields.length > 0) sections.push("profile");
    if (resumeReview.education.changes.length > 0) sections.push("education");
    if (resumeReview.experience.changes.length > 0) sections.push("experience");
    if (resumeReview.skills.changes.length > 0) sections.push("skills");
    return sections;
  }, [resumeReview]);

  const unresolvedSections = changedSections.filter(
    (section) => !pendingResumeReview?.resolvedSections.includes(section)
  );

  const handleResumeParsed = useCallback((data: ResumeData, resume: Resume) => {
    setPendingResumeReview({
      key: resume.id,
      fileName: resume.fileName,
      data,
      resolvedSections: [],
    });
    toast.success("Resume uploaded. Review the proposed profile changes below.");
  }, []);

  const resolveReviewSection = useCallback((section: ReviewSection) => {
    setPendingResumeReview((current) => {
      if (!current || current.resolvedSections.includes(section)) return current;
      return {
        ...current,
        resolvedSections: [...current.resolvedSections, section],
      };
    });
  }, []);

  const handleDeleteResume = async (id: number) => {
    await deleteResume(id);
  };

  const additionsCount = resumeReview
    ? resumeReview.skills.changes.filter(({ kind }) => kind === "add").length
      + resumeReview.experience.changes.filter(({ kind }) => kind === "add").length
      + resumeReview.education.changes.filter(({ kind }) => kind === "add").length
    : 0;
  const updatesCount = resumeReview
    ? resumeReview.profile.changedFields.length
      + resumeReview.skills.changes.filter(({ kind }) => kind === "update").length
      + resumeReview.experience.changes.filter(({ kind }) => kind === "update").length
      + resumeReview.education.changes.filter(({ kind }) => kind === "update").length
    : 0;
  const unchangedCount = resumeReview
    ? resumeReview.skills.unchangedCount
      + resumeReview.experience.unchangedCount
      + resumeReview.education.unchangedCount
    : 0;
  const skippedCount = resumeReview
    ? resumeReview.skills.duplicateCount
      + resumeReview.skills.invalidCount
      + resumeReview.experience.duplicateCount
      + resumeReview.experience.invalidCount
      + resumeReview.education.duplicateCount
      + resumeReview.education.invalidCount
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your professional profile for AI-powered job matching
        </p>
      </div>

      {profileQuery.isError ? (
        <ApiErrorState
          error={profileQuery.error}
          fallbackMessage="Your profile could not be loaded."
          onRetry={() => void profileQuery.refetch()}
        />
      ) : null}

      {profileQuery.isError ? null : (
        <ResumeManager
          resumes={profileQuery.data?.resumes || []}
          onParsed={handleResumeParsed}
          onDelete={handleDeleteResume}
          onRefresh={() => void cacheOwnership.resumeMutation(queryClient)}
        />
      )}

      {pendingResumeReview && resumeReview && unresolvedSections.length > 0 ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Reviewing {pendingResumeReview.fileName}
          </p>
          <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">
            {additionsCount} new records · {updatesCount} updates · {unchangedCount} already
            current{skippedCount > 0 ? ` · ${skippedCount} duplicates or invalid entries skipped` : ""}.
            Save or revert each affected section below.
          </p>
        </div>
      ) : null}

      {pendingResumeReview && resumeReview && changedSections.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            No profile changes found in {pendingResumeReview.fileName}
          </p>
          <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">
            Your saved profile already matches this resume
            {skippedCount > 0 ? `; ${skippedCount} duplicates or invalid entries were skipped` : ""}.
          </p>
        </div>
      ) : null}

      {profileQuery.isError ? null : (
        <ProfileForm
          initialData={
            pendingResumeReview &&
            resumeReview &&
            unresolvedSections.includes("profile")
              ? resumeReview.profile.proposed
              : undefined
          }
          reviewKey={
            unresolvedSections.includes("profile")
              ? pendingResumeReview?.key
              : undefined
          }
          onReviewResolved={() => resolveReviewSection("profile")}
        />
      )}

      {profileQuery.isError ? null : (
        <EducationEditor
          profileId={profileQuery.data?.id || null}
          resumeReview={
            pendingResumeReview &&
            resumeReview &&
            unresolvedSections.includes("education")
              ? {
                  key: pendingResumeReview.key,
                  review: resumeReview.education,
                }
              : undefined
          }
          onReviewResolved={() => resolveReviewSection("education")}
        />
      )}

      {profileQuery.isError ? null : (
        <ExperienceList
          profileId={profileQuery.data?.id || null}
          resumeReview={
            pendingResumeReview &&
            resumeReview &&
            unresolvedSections.includes("experience")
              ? {
                  key: pendingResumeReview.key,
                  review: resumeReview.experience,
                }
              : undefined
          }
          onReviewResolved={() => resolveReviewSection("experience")}
        />
      )}

      {profileQuery.isError ? null : (
        <SkillsEditor
          profileId={profileQuery.data?.id || null}
          resumeReview={
            pendingResumeReview &&
            resumeReview &&
            unresolvedSections.includes("skills")
              ? {
                  key: pendingResumeReview.key,
                  review: resumeReview.skills,
                }
              : undefined
          }
          onReviewResolved={() => resolveReviewSection("skills")}
        />
      )}
    </div>
  );
}
