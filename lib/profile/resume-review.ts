import type { ResumeData } from "@/lib/ai/resume/contracts";
import {
  resumeEducationApplyItemSchema,
  resumeExperienceApplyItemSchema,
  resumeSkillApplyItemSchema,
} from "@/lib/api/contracts/profile";
import type {
  Experience,
  ProfileResponse,
  Skill,
} from "@/lib/api/contracts/profile";

interface ResumeProfileDraft {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  summary: string;
}

export interface ResumeSkillInput {
  name: string;
  category?: string | null;
}

export interface ResumeExperienceInput {
  company: string;
  title: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  description?: string | null;
  highlights?: string[] | null;
}

export interface ResumeEducationInput {
  institution: string;
  degree: string;
  field?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  gpa?: string | null;
  honors?: string | null;
}

interface ResumeReviewChange<TValue> {
  key: string;
  kind: "add" | "update";
  currentId: number | null;
  value: TValue;
  changedFields: string[];
}

export interface ResumeSectionReview<TValue> {
  changes: ResumeReviewChange<TValue>[];
  unchangedCount: number;
  duplicateCount: number;
  invalidCount: number;
}

interface ResumeProfileReview {
  proposed: ResumeProfileDraft;
  changedFields: string[];
}

export interface ResumeReview {
  profile: ResumeProfileReview;
  skills: ResumeSectionReview<ResumeSkillInput>;
  experience: ResumeSectionReview<ResumeExperienceInput>;
  education: ResumeSectionReview<ResumeEducationInput>;
}

const PROFILE_FIELDS: Array<{
  key: keyof ResumeProfileDraft;
  label: string;
}> = [
  { key: "name", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "linkedinUrl", label: "LinkedIn URL" },
  { key: "githubUrl", label: "GitHub URL" },
  { key: "portfolioUrl", label: "Portfolio URL" },
  { key: "summary", label: "Professional summary" },
];

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function identityPart(value: string | null | undefined): string {
  return cleanText(value).toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

const MONTH_NUMBERS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function dateIdentityPart(value: string | null | undefined): string {
  const normalized = identityPart(value).replace(/[,/]/g, " ");
  const numericMatch = normalized.match(/^(\d{4})[-\s](\d{1,2})$/);
  if (numericMatch) {
    const month = Number(numericMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${numericMatch[1]}-${String(month).padStart(2, "0")}`;
    }
  }

  const monthYearMatch = normalized.match(/^([a-z]{3})[a-z]*\s+(\d{4})$/);
  if (monthYearMatch && MONTH_NUMBERS[monthYearMatch[1]]) {
    return `${monthYearMatch[2]}-${MONTH_NUMBERS[monthYearMatch[1]]}`;
  }

  const yearMonthMatch = normalized.match(/^(\d{4})\s+([a-z]{3})[a-z]*$/);
  if (yearMonthMatch && MONTH_NUMBERS[yearMonthMatch[2]]) {
    return `${yearMonthMatch[1]}-${MONTH_NUMBERS[yearMonthMatch[2]]}`;
  }

  return normalized;
}

function valuesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  return cleanText(left) === cleanText(right);
}

function parseHighlights(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : null;
  } catch {
    return null;
  }
}

function changedFieldLabels<TValue extends object>(
  current: TValue,
  proposed: TValue,
  fields: Array<{ key: keyof TValue; label: string }>
): string[] {
  return fields
    .filter(({ key }) => JSON.stringify(current[key] ?? null) !== JSON.stringify(proposed[key] ?? null))
    .map(({ label }) => label);
}

function buildResumeProfileReview(
  profile: NonNullable<ProfileResponse>,
  resume: ResumeData
): ResumeProfileReview {
  const current: ResumeProfileDraft = {
    name: profile.name,
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    location: profile.location ?? "",
    linkedinUrl: profile.linkedinUrl ?? "",
    githubUrl: profile.githubUrl ?? "",
    portfolioUrl: profile.portfolioUrl ?? "",
    summary: profile.summary ?? "",
  };
  const proposed = { ...current };

  for (const { key } of PROFILE_FIELDS) {
    const extractedValue = cleanText(resume[key]);
    if (extractedValue) proposed[key] = extractedValue;
  }

  return {
    proposed,
    changedFields: PROFILE_FIELDS
      .filter(({ key }) => !valuesMatch(current[key], proposed[key]))
      .map(({ label }) => label),
  };
}

export function buildSkillsResumeReview(
  currentSkills: Skill[],
  extractedSkills: ResumeSkillInput[]
): ResumeSectionReview<ResumeSkillInput> {
  const currentByKey = new Map<string, Skill>();
  for (const skill of currentSkills) {
    const key = identityPart(skill.name);
    if (key && !currentByKey.has(key)) currentByKey.set(key, skill);
  }

  const seen = new Set<string>();
  const changes: ResumeReviewChange<ResumeSkillInput>[] = [];
  let unchangedCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const extracted of extractedSkills) {
    const name = cleanText(extracted.name);
    const key = identityPart(name);
    if (!key) {
      invalidCount += 1;
      continue;
    }

    const current = currentByKey.get(key);
    const extractedCategory = cleanText(extracted.category);
    const proposed = {
      name,
      category: extractedCategory || current?.category || "other",
    };
    const parsed = resumeSkillApplyItemSchema.safeParse(proposed);
    if (!parsed.success) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    if (!current) {
      changes.push({
        key,
        kind: "add",
        currentId: null,
        value: parsed.data,
        changedFields: [],
      });
      continue;
    }

    if (
      valuesMatch(current.name, parsed.data.name)
      && valuesMatch(current.category, parsed.data.category)
    ) {
      unchangedCount += 1;
      continue;
    }

    changes.push({
      key,
      kind: "update",
      currentId: current.id,
      value: parsed.data,
      changedFields: [
        ...(!valuesMatch(current.name, parsed.data.name) ? ["Name"] : []),
        ...(!valuesMatch(current.category, parsed.data.category) ? ["Category"] : []),
      ],
    });
  }

  return { changes, unchangedCount, duplicateCount, invalidCount };
}

export function buildExperienceResumeReview(
  currentExperience: Experience[],
  extractedExperience: ResumeExperienceInput[]
): ResumeSectionReview<ResumeExperienceInput> {
  const currentByKey = new Map<string, Experience>();
  for (const item of currentExperience) {
    const key = [
      identityPart(item.company),
      identityPart(item.title),
      dateIdentityPart(item.startDate),
    ].join("|");
    if (!currentByKey.has(key)) currentByKey.set(key, item);
  }

  const seen = new Set<string>();
  const changes: ResumeReviewChange<ResumeExperienceInput>[] = [];
  let unchangedCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const extracted of extractedExperience) {
    const company = cleanText(extracted.company);
    const title = cleanText(extracted.title);
    const startDate = cleanText(extracted.startDate);
    if (!company || !title || !startDate) {
      invalidCount += 1;
      continue;
    }

    const key = [
      identityPart(company),
      identityPart(title),
      dateIdentityPart(startDate),
    ].join("|");

    const current = currentByKey.get(key);
    const extractedHighlights = extracted.highlights
      ?.map(cleanText)
      .filter(Boolean) ?? [];
    const extractedDescription =
      cleanText(extracted.description) || extractedHighlights.join("\n");

    if (!current) {
      const parsed = resumeExperienceApplyItemSchema.safeParse({
        company,
        title,
        location: cleanText(extracted.location) || null,
        startDate,
        endDate: cleanText(extracted.endDate) || null,
        description: extractedDescription || null,
        highlights: extractedHighlights.length > 0 ? extractedHighlights : null,
      });
      if (!parsed.success) {
        invalidCount += 1;
        continue;
      }
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(key);
      changes.push({
        key,
        kind: "add",
        currentId: null,
        value: parsed.data,
        changedFields: [],
      });
      continue;
    }

    const currentValue: ResumeExperienceInput = {
      company: current.company,
      title: current.title,
      location: current.location,
      startDate: current.startDate,
      endDate: current.endDate,
      description: current.description,
      highlights: parseHighlights(current.highlights),
    };
    const proposed: ResumeExperienceInput = {
      company,
      title,
      location: cleanText(extracted.location) || current.location,
      startDate,
      endDate: cleanText(extracted.endDate) || null,
      description: extractedDescription || current.description,
      highlights: extractedHighlights.length > 0
        ? extractedHighlights
        : parseHighlights(current.highlights),
    };
    const parsed = resumeExperienceApplyItemSchema.safeParse(proposed);
    if (!parsed.success) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    const changedFields = changedFieldLabels(
      currentValue,
      parsed.data,
      [
        { key: "company", label: "Company" },
        { key: "title", label: "Job title" },
        { key: "location", label: "Location" },
        { key: "startDate", label: "Start date" },
        { key: "endDate", label: "End date" },
        { key: "description", label: "Description" },
        { key: "highlights", label: "Highlights" },
      ]
    );
    if (changedFields.length === 0) {
      unchangedCount += 1;
      continue;
    }

    changes.push({
      key,
      kind: "update",
      currentId: current.id,
      value: parsed.data,
      changedFields,
    });
  }

  return { changes, unchangedCount, duplicateCount, invalidCount };
}

export function buildEducationResumeReview(
  currentEducation: Array<{
    id: number;
    profileId: number;
    institution: string;
    degree: string;
    field: string | null;
    startDate: string | null;
    endDate: string | null;
    gpa: string | null;
    honors: string | null;
  }>,
  extractedEducation: ResumeEducationInput[]
): ResumeSectionReview<ResumeEducationInput> {
  const currentByKey = new Map<string, (typeof currentEducation)[number]>();
  for (const item of currentEducation) {
    const key = [item.institution, item.degree].map(identityPart).join("|");
    if (!currentByKey.has(key)) currentByKey.set(key, item);
  }

  const seen = new Set<string>();
  const changes: ResumeReviewChange<ResumeEducationInput>[] = [];
  let unchangedCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const extracted of extractedEducation) {
    const institution = cleanText(extracted.institution);
    const degree = cleanText(extracted.degree);
    if (!institution || !degree) {
      invalidCount += 1;
      continue;
    }

    const key = [institution, degree].map(identityPart).join("|");

    const current = currentByKey.get(key);
    if (!current) {
      const parsed = resumeEducationApplyItemSchema.safeParse({
        institution,
        degree,
        field: cleanText(extracted.field) || null,
        startDate: cleanText(extracted.startDate) || null,
        endDate: cleanText(extracted.endDate) || null,
        gpa: cleanText(extracted.gpa) || null,
        honors: cleanText(extracted.honors) || null,
      });
      if (!parsed.success) {
        invalidCount += 1;
        continue;
      }
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(key);
      changes.push({
        key,
        kind: "add",
        currentId: null,
        value: parsed.data,
        changedFields: [],
      });
      continue;
    }

    const currentValue: ResumeEducationInput = {
      institution: current.institution,
      degree: current.degree,
      field: cleanText(current.field) || null,
      startDate: cleanText(current.startDate) || null,
      endDate: cleanText(current.endDate) || null,
      gpa: cleanText(current.gpa) || null,
      honors: cleanText(current.honors) || null,
    };
    const proposed: ResumeEducationInput = {
      institution,
      degree,
      field: cleanText(extracted.field) || currentValue.field,
      startDate: cleanText(extracted.startDate) || currentValue.startDate,
      endDate: cleanText(extracted.endDate) || currentValue.endDate,
      gpa: cleanText(extracted.gpa) || currentValue.gpa,
      honors: cleanText(extracted.honors) || currentValue.honors,
    };
    const parsed = resumeEducationApplyItemSchema.safeParse(proposed);
    if (!parsed.success) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    const changedFields = changedFieldLabels(
      currentValue,
      parsed.data,
      [
        { key: "institution", label: "Institution" },
        { key: "degree", label: "Degree" },
        { key: "field", label: "Field" },
        { key: "startDate", label: "Start date" },
        { key: "endDate", label: "End date" },
        { key: "gpa", label: "GPA" },
        { key: "honors", label: "Honors" },
      ]
    );
    if (changedFields.length === 0) {
      unchangedCount += 1;
      continue;
    }

    changes.push({
      key,
      kind: "update",
      currentId: current.id,
      value: parsed.data,
      changedFields,
    });
  }

  return { changes, unchangedCount, duplicateCount, invalidCount };
}

export function buildResumeReview(
  profile: NonNullable<ProfileResponse>,
  resume: ResumeData
): ResumeReview {
  return {
    profile: buildResumeProfileReview(profile, resume),
    skills: buildSkillsResumeReview(profile.skills, resume.skills),
    experience: buildExperienceResumeReview(profile.experience, resume.experience),
    education: buildEducationResumeReview(profile.education, resume.education ?? []),
  };
}
