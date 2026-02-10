"use client";

import { useQuery } from "@tanstack/react-query";
import { ProfileForm } from "@/components/profile/profile-form";
import { SkillsEditor } from "@/components/profile/skills-editor";
import { ExperienceList } from "@/components/profile/experience-list";
import { ResumeUpload } from "@/components/profile/resume-upload";
import { useState } from "react";
import { FileText, ChevronDown, ChevronUp, History, Download, Calendar, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ResumeData {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  summary?: string;
  skills: Array<{
    name: string;
    category?: string;
    proficiency?: number;
  }>;
  experience: Array<{
    company: string;
    title: string;
    location?: string;
    startDate: string;
    endDate?: string;
    description?: string;
    highlights?: string[];
  }>;
  education?: Array<{
    institution: string;
    degree: string;
    field?: string;
    startDate?: string;
    endDate?: string;
    gpa?: string;
    honors?: string;
  }>;
}

interface Resume {
  id: number;
  fileName: string;
  version: number;
  createdAt: string;
  isCurrent: boolean;
}

export default function ProfilePage() {
  const [parsedResumeData, setParsedResumeData] = useState<ResumeData | null>(null);
  const [showResumeUpload, setShowResumeUpload] = useState(true);
  const [pendingResumeData, setPendingResumeData] = useState<ResumeData | null>(null);
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false);

  const { data: profile, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      return data;
    },
  });

  const handleResumeParsed = (data: ResumeData, autofill: boolean) => {
    // If autofill is OFF, just show success message and refresh the list
    if (!autofill) {
      toast.success("Resume saved to history");
      refetch();
      return;
    }

    // If autofill is ON
    const hasExistingData = profile && (
      profile.name ||
      profile.summary ||
      (profile.skills && profile.skills.length > 0) ||
      (profile.experience && profile.experience.length > 0)
    );

    if (hasExistingData) {
      // Prompt user before overwriting
      setPendingResumeData(data);
      setShowOverwriteDialog(true);
    } else {
      // Empty profile, just fill it
      setParsedResumeData(data);
      setShowResumeUpload(false);
      toast.success("Profile auto-filled from resume");
      refetch();
    }
  };

  const confirmOverwrite = () => {
    if (pendingResumeData) {
      setParsedResumeData(pendingResumeData);
      setShowResumeUpload(false);
      setShowOverwriteDialog(false);
      setPendingResumeData(null);
      toast.success("Profile updated with resume data");
      refetch();
    }
  };

  // Determine if this is a new user (no profile or empty profile)
  const isNewUser = !profile || !profile.name;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Profile</h1>
        <p className="mt-1 text-zinc-400">
          Manage your professional profile for AI-powered job matching
        </p>
      </div>

      <AlertDialog open={showOverwriteDialog} onOpenChange={setShowOverwriteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite existing profile?</AlertDialogTitle>
            <AlertDialogDescription>
              Your profile already has data. Do you want to overwrite it with the information extracted from this resume?
              This will update your basic info, skills, and experience.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowOverwriteDialog(false);
              setPendingResumeData(null);
              toast.info("Resume saved, but profile was not updated");
              refetch();
            }}>
              Keep Existing
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmOverwrite}>
              Overwrite Profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resume Upload Section */}
      {(isNewUser || showResumeUpload) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <FileText className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-white">Quick Setup with Resume</h2>
                <p className="text-sm text-zinc-400">Upload your resume to auto-fill your profile</p>
              </div>
            </div>
            {!isNewUser && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowResumeUpload(!showResumeUpload)}
              >
                {showResumeUpload ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
          <div className="mt-4">
            <ResumeUpload onParsed={handleResumeParsed} />
          </div>
        </div>
      )}

      {/* Parsed Resume Summary (if any) */}
      {parsedResumeData && (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-900/20 p-4">
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <FileText className="h-4 w-4" />
            <span>
              Resume parsed! Found {parsedResumeData.skills.length} skills and{" "}
              {parsedResumeData.experience.length} work experiences. Review and save below.
            </span>
          </div>
        </div>
      )}

      {/* Resume History */}
      {profile?.resumes && profile.resumes.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-zinc-400" />
            <h2 className="text-lg font-medium text-white">Resume History</h2>
          </div>
          <div className="space-y-3">
            {profile.resumes.map((resume: Resume) => (
              <div
                key={resume.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800">
                    <FileText className="h-4 w-4 text-zinc-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-zinc-200">{resume.fileName}</p>
                      {resume.isCurrent && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                          <CheckCircle className="h-3 w-3" />
                          Current
                        </span>
                      )}
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                        v{resume.version}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {new Date(resume.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {/*
                  TODO: Implement download functionality
                  For now we just show a button that doesn't do anything or links to a placeholder
                */}
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Download className="h-4 w-4 text-zinc-400" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile Form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-medium text-white">Basic Information</h2>
        <ProfileForm
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
        />
      </div>

      {/* Skills */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-medium text-white">Skills</h2>
        <SkillsEditor
          profileId={profile?.id || null}
          initialSkills={parsedResumeData?.skills}
        />
      </div>

      {/* Experience */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-4 text-lg font-medium text-white">Work Experience</h2>
        <ExperienceList
          profileId={profile?.id || null}
          initialExperience={parsedResumeData?.experience}
        />
      </div>
    </div>
  );
}
