"use client";

import { useQuery } from "@tanstack/react-query";
import { ProfileForm } from "@/components/profile/profile-form";
import { SkillsEditor } from "@/components/profile/skills-editor";
import { ExperienceList } from "@/components/profile/experience-list";
import { EducationEditor } from "@/components/profile/education-editor";
import { ResumeManager } from "@/components/profile/resume-manager";
import type { ResumeData } from "@/lib/ai/resume/contracts";
import { deleteResume, getProfile } from "@/lib/api/clients/profile";
import { useState } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { ApiErrorState } from "@/components/ui/api-error-state";

export default function ProfilePage() {
  const [parsedResumeData, setParsedResumeData] = useState<ResumeData | null>(null);

  const profileQuery = useQuery({
    queryKey: queryKeys.profile.detail(),
    queryFn: async () => {
      return getProfile();
    },
  });

  const handleResumeParsed = (data: ResumeData, autofill: boolean) => {
    if (!autofill) return;

    setParsedResumeData(data);
    toast.success("Resume uploaded. Review the extracted data below.");
  };

  const handleDeleteResume = async (id: number) => {
    await deleteResume(id);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
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

      {/* Resume Manager */}
      {profileQuery.isError ? null : <ResumeManager
        resumes={profileQuery.data?.resumes || []}
        onParsed={handleResumeParsed}
        onDelete={handleDeleteResume}
        onRefresh={() => void profileQuery.refetch()}
      />}

      {/* Parsed Resume Summary */}
      {parsedResumeData && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <span>
              Resume parsed! Found {parsedResumeData.skills.length} skills,{" "}
              {parsedResumeData.experience.length} work experiences, and{" "}
              {parsedResumeData.education?.length || 0} education entries. Review and save below.
            </span>
          </div>
        </div>
      )}

      {/* Basic Information */}
      {profileQuery.isError ? null : <ProfileForm
        initialData={
          parsedResumeData
            ? {
              name: parsedResumeData.name,
              email: parsedResumeData.email || "",
              phone: parsedResumeData.phone || "",
              location: parsedResumeData.location || "",
              linkedinUrl: parsedResumeData.linkedinUrl || "",
              githubUrl: parsedResumeData.githubUrl || "",
              portfolioUrl: parsedResumeData.portfolioUrl || "",
              summary: parsedResumeData.summary || "",
            }
            : undefined
        }
      />}

      {/* Education */}
      {profileQuery.isError ? null : <EducationEditor
        profileId={profileQuery.data?.id || null}
        initialEducation={parsedResumeData?.education?.map((education) => ({
          institution: education.institution,
          degree: education.degree,
          field: education.field ?? undefined,
          startDate: education.startDate ?? undefined,
          endDate: education.endDate ?? undefined,
          gpa: education.gpa ?? undefined,
          honors: education.honors ?? undefined,
        }))}
      />}

      {/* Experience */}
      {profileQuery.isError ? null : <ExperienceList
        profileId={profileQuery.data?.id || null}
        initialExperience={parsedResumeData?.experience.map((experience) => ({
          ...experience,
          location: experience.location ?? undefined,
          endDate: experience.endDate ?? undefined,
          description: experience.description ?? undefined,
        }))}
      />}

      {/* Skills */}
      {profileQuery.isError ? null : <SkillsEditor
        profileId={profileQuery.data?.id || null}
        initialSkills={parsedResumeData?.skills}
      />}
    </div>
  );
}
