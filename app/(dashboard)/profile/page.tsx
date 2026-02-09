"use client";

import { useQuery } from "@tanstack/react-query";
import { ProfileForm } from "@/components/profile/profile-form";
import { SkillsEditor } from "@/components/profile/skills-editor";
import { ExperienceList } from "@/components/profile/experience-list";
import { ResumeUpload } from "@/components/profile/resume-upload";
import { useState } from "react";
import { FileText, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export default function ProfilePage() {
  const [parsedResumeData, setParsedResumeData] = useState<ResumeData | null>(null);
  const [showResumeUpload, setShowResumeUpload] = useState(true);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  const handleResumeParsed = (data: ResumeData) => {
    setParsedResumeData(data);
    setShowResumeUpload(false);
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
