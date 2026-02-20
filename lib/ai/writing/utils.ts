import { eq } from "drizzle-orm";

import { fetchCandidateProfileSnapshot } from "@/lib/ai/profile/profile-snapshot";
import { db } from "@/lib/db";
import { jobs, companies } from "@/lib/db/schema";

export interface CandidateProfileData {
  name: string;
  summary: string | null;
  skills: Array<{ name: string; proficiency: number; category: string | null }>;
  experience: Array<{ title: string; company: string; description: string | null }>;
  education: Array<{ degree: string; institution: string; field: string | null }>;
}

export async function fetchCandidateProfile(): Promise<CandidateProfileData | null> {
  const snapshot = await fetchCandidateProfileSnapshot();
  if (!snapshot) return null;

  return {
    name: snapshot.profile.name || "",
    summary: snapshot.profile.summary,
    skills: snapshot.skills.map((s) => ({
      name: s.name,
      proficiency: s.proficiency,
      category: s.category,
    })),
    experience: snapshot.experience.map((e) => ({
      title: e.title,
      company: e.company,
      description: e.description,
    })),
    education: snapshot.education.map((e) => ({
      degree: e.degree,
      institution: e.institution,
      field: e.field,
    })),
  };
}

export interface JobDataWithCompany {
  id: number;
  title: string;
  description: string | null;
  companyName: string;
  location: string | null;
  employmentType: string | null;
  url: string | null;
  externalId: string | null;
}

export async function fetchJobWithCompany(jobId: number): Promise<JobDataWithCompany | null> {
  const result = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      description: jobs.description,
      companyName: companies.name,
      location: jobs.location,
      employmentType: jobs.employmentType,
      url: jobs.url,
      externalId: jobs.externalId,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (result.length === 0) return null;

  return result[0];
}
