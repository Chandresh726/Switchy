import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profile, skills, experience, education, jobs, companies } from "@/lib/db/schema";

export interface CandidateProfileData {
  name: string;
  summary: string | null;
  skills: Array<{ name: string; proficiency: number; category: string | null }>;
  experience: Array<{ title: string; company: string; description: string | null }>;
  education: Array<{ degree: string; institution: string; field: string | null }>;
}

export async function fetchCandidateProfile(): Promise<CandidateProfileData | null> {
  const profiles = await db.select().from(profile).limit(1);
  if (profiles.length === 0) return null;

  const userProfile = profiles[0];

  const [userSkills, userExperience, userEducation] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
    db.select().from(education).where(eq(education.profileId, userProfile.id)),
  ]);

  return {
    name: userProfile.name || "",
    summary: userProfile.summary,
    skills: userSkills.map((s) => ({
      name: s.name,
      proficiency: s.proficiency,
      category: s.category,
    })),
    experience: userExperience.map((e) => ({
      title: e.title,
      company: e.company,
      description: e.description,
    })),
    education: userEducation.map((e) => ({
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
