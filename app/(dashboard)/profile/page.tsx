"use client";

import { useQuery } from "@tanstack/react-query";
import { ProfileForm } from "@/components/profile/profile-form";
import { SkillsEditor } from "@/components/profile/skills-editor";
import { ExperienceList } from "@/components/profile/experience-list";
import { ResumeManager } from "@/components/profile/resume-manager";
import { useState } from "react";
import { toast } from "sonner";

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

  const { data: profile, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  const handleResumeParsed = (data: ResumeData, autofill: boolean) => {
    setParsedResumeData(data);
    toast.success("Resume uploaded. Review the extracted data below.");

    // Trigger autofill if the user has enabled it
    if (autofill) {
      // The data is already being passed to ProfileForm, SkillsEditor, and ExperienceList
      // through parsedResumeData state, which triggers their initialData props
      console.log("[Profile] Autofill enabled - form fields populated from resume");
    }
  };

  const handleDeleteResume = async (id: number) => {
    const res = await fetch(`/api/profile/resumes?id=${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete resume");
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Profile</h1>
        <p className="mt-1 text-zinc-400">
          Manage your professional profile for AI-powered job matching
        </p>
      </div>

      {/* Resume Manager */}
      <ResumeManager
        resumes={profile?.resumes || []}
        onParsed={handleResumeParsed}
        onDelete={handleDeleteResume}
        onRefresh={refetch}
      />

      {/* Parsed Resume Summary */}
      {parsedResumeData && (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-900/20 p-4">
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <span>
              Resume parsed! Found {parsedResumeData.skills.length} skills and{" "}
              {parsedResumeData.experience.length} work experiences. Review and save below.
            </span>
          </div>
        </div>
      )}

      {/* Basic Information */}
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

      {/* Skills */}
      <SkillsEditor
        profileId={profile?.id || null}
        initialSkills={parsedResumeData?.skills}
      />

      {/* Experience */}
      <ExperienceList
        profileId={profile?.id || null}
        initialExperience={parsedResumeData?.experience}
      />
    </div>
  );
}
