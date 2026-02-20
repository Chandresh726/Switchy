import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { education, experience, profile, skills } from "@/lib/db/schema";

export interface CandidateProfileSnapshot {
  profile: typeof profile.$inferSelect;
  skills: Array<typeof skills.$inferSelect>;
  experience: Array<typeof experience.$inferSelect>;
  education: Array<typeof education.$inferSelect>;
}

export async function fetchCandidateProfileSnapshot(): Promise<CandidateProfileSnapshot | null> {
  const profiles = await db.select().from(profile).limit(1);
  if (profiles.length === 0) {
    return null;
  }

  const userProfile = profiles[0];

  const [userSkills, userExperience, userEducation] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
    db.select().from(education).where(eq(education.profileId, userProfile.id)),
  ]);

  return {
    profile: userProfile,
    skills: userSkills,
    experience: userExperience,
    education: userEducation,
  };
}
