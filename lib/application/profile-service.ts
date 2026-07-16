import { desc, eq } from "drizzle-orm";

import { NotFoundError } from "@/lib/api";
import type {
  educationUpdateBodySchema,
  educationWriteBodySchema,
  experienceUpdateBodySchema,
  experienceWriteBodySchema,
  profileWriteBodySchema,
  skillCreateBodySchema,
  skillUpdateBodySchema,
} from "@/lib/api/contracts/profile";
import { scheduleProfileRematch } from "@/lib/ai/matcher/profile-rematch";
import { db } from "@/lib/db";
import { education, experience, profile, resumes, skills } from "@/lib/db/schema";

import type { z } from "zod";

type ProfileWriteInput = z.infer<typeof profileWriteBodySchema>;
type SkillCreateInput = z.infer<typeof skillCreateBodySchema>;
type SkillUpdateInput = z.infer<typeof skillUpdateBodySchema>;
type ExperienceCreateInput = z.infer<typeof experienceWriteBodySchema>;
type ExperienceUpdateInput = z.infer<typeof experienceUpdateBodySchema>;
type EducationCreateInput = z.infer<typeof educationWriteBodySchema>;
type EducationUpdateInput = z.infer<typeof educationUpdateBodySchema>;

function parseDateValue(date: string | null) {
  if (!date) return Number.POSITIVE_INFINITY;
  if (["present", "current", "now"].includes(date.trim().toLowerCase())) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortByMostRecent<T extends { startDate: string | null; endDate: string | null; id: number }>(a: T, b: T) {
  return parseDateValue(b.endDate) - parseDateValue(a.endDate)
    || parseDateValue(b.startDate) - parseDateValue(a.startDate)
    || b.id - a.id;
}

export async function getProfile() {
  const [profileData] = await db.select().from(profile).limit(1);
  if (!profileData) return null;
  const [skillRows, experienceRows, educationRows, resumeRows] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, profileData.id)),
    db.select().from(experience).where(eq(experience.profileId, profileData.id)),
    db.select().from(education).where(eq(education.profileId, profileData.id)),
    db.select().from(resumes).where(eq(resumes.profileId, profileData.id)).orderBy(desc(resumes.version)),
  ]);
  return { ...profileData, skills: skillRows, experience: experienceRows, education: educationRows, resumes: resumeRows };
}

export async function saveProfile(input: ProfileWriteInput) {
  const [existing] = await db.select().from(profile).limit(1);
  if (!existing) {
    const [created] = await db.insert(profile).values(input).returning();
    await scheduleProfileRematch();
    return created;
  }
  const matchingFactsChanged = existing.summary !== (input.summary ?? null)
    || existing.preferredCountry !== (input.preferredCountry ?? null)
    || existing.preferredCity !== (input.preferredCity ?? null);
  const [updated] = await db.update(profile).set({ ...input, updatedAt: new Date() }).where(eq(profile.id, existing.id)).returning();
  if (matchingFactsChanged) await scheduleProfileRematch();
  return updated;
}

export const listSkills = (profileId: number) => db.select().from(skills).where(eq(skills.profileId, profileId));

export async function createSkill(input: SkillCreateInput) {
  const [created] = await db.insert(skills).values(input).returning();
  await scheduleProfileRematch();
  return created;
}

export async function updateSkill(id: number, input: SkillUpdateInput) {
  const [updated] = await db.update(skills).set(input).where(eq(skills.id, id)).returning();
  if (!updated) throw new NotFoundError("Skill not found", "skill_not_found");
  await scheduleProfileRematch();
  return updated;
}

export async function deleteSkill(id: number) {
  const [deleted] = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id });
  if (!deleted) throw new NotFoundError("Skill not found", "skill_not_found");
  await scheduleProfileRematch();
  return { success: true as const };
}

export async function listExperience(profileId: number) {
  return (await db.select().from(experience).where(eq(experience.profileId, profileId))).sort(sortByMostRecent);
}

export async function createExperience(input: ExperienceCreateInput) {
  const { highlights, ...values } = input;
  const [created] = await db.insert(experience).values({ ...values, highlights: highlights ? JSON.stringify(highlights) : null }).returning();
  await scheduleProfileRematch();
  return created;
}

export async function updateExperience(id: number, input: ExperienceUpdateInput) {
  const { highlights, ...values } = input;
  const [updated] = await db.update(experience).set({ ...values, endDate: values.endDate || null, highlights: highlights ? JSON.stringify(highlights) : null }).where(eq(experience.id, id)).returning();
  if (!updated) throw new NotFoundError("Experience not found", "experience_not_found");
  await scheduleProfileRematch();
  return updated;
}

export async function deleteExperience(id: number) {
  const [deleted] = await db.delete(experience).where(eq(experience.id, id)).returning({ id: experience.id });
  if (!deleted) throw new NotFoundError("Experience not found", "experience_not_found");
  await scheduleProfileRematch();
  return { success: true as const };
}

export async function listEducation(profileId: number) {
  return (await db.select().from(education).where(eq(education.profileId, profileId))).sort(sortByMostRecent);
}

export async function createEducation(input: EducationCreateInput) {
  const [created] = await db.insert(education).values(input).returning();
  await scheduleProfileRematch();
  return created;
}

export async function updateEducation(id: number, input: EducationUpdateInput) {
  const [updated] = await db.update(education).set({ ...input, endDate: input.endDate || null }).where(eq(education.id, id)).returning();
  if (!updated) throw new NotFoundError("Education not found", "education_not_found");
  await scheduleProfileRematch();
  return updated;
}

export async function deleteEducation(id: number) {
  const [deleted] = await db.delete(education).where(eq(education.id, id)).returning({ id: education.id });
  if (!deleted) throw new NotFoundError("Education not found", "education_not_found");
  await scheduleProfileRematch();
  return { success: true as const };
}
