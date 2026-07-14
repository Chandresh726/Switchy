import { fingerprintAIInput } from "@/lib/ai/runtime/fingerprint";

import {
  CandidateEvidenceSchema,
  JobEvidenceInputSchema,
  type CandidateEvidence,
  type JobEvidenceInput,
} from "./schemas";

function normalizeText(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIdentifier(value?: string | null): string | null {
  return normalizeText(value)?.toLocaleLowerCase("en-US") ?? null;
}

function normalizeStringArray(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map(normalizeIdentifier)
        .filter((value): value is string => value !== null)
    )
  ).sort(compareCodePoints);
}

function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function parseHighlights(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map(normalizeText)
      .filter((item): item is string => item !== null)
      .sort(compareCodePoints)
      .filter((item, index, all) => index === 0 || item !== all[index - 1]);
  } catch {
    return [];
  }
}

export interface CandidateFingerprintInput {
  profile: {
    id: number;
    summary: string | null;
    preferredCountry: string | null;
    preferredCity: string | null;
  };
  skills: Array<{ name: string; category: string | null }>;
  experience: Array<{
    title: string;
    company: string;
    location: string | null;
    startDate: string;
    endDate: string | null;
    description: string | null;
    highlights: string | null;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field: string | null;
    startDate: string | null;
    endDate: string | null;
    gpa: string | null;
    honors: string | null;
  }>;
  preferences?: {
    acceptedLocationTypes?: string[];
    acceptedEmploymentTypes?: string[];
  };
}

export function buildCandidateEvidence(input: CandidateFingerprintInput): CandidateEvidence {
  return canonicalizeCandidateEvidence(CandidateEvidenceSchema.parse({
    summary: normalizeText(input.profile.summary),
    skills: input.skills
      .map((skill) => ({
        name: normalizeIdentifier(skill.name),
        category: normalizeIdentifier(skill.category),
      }))
      .filter((skill): skill is { name: string; category: string | null } => skill.name !== null)
      .sort((left, right) =>
        compareCodePoints(left.name, right.name) ||
        compareCodePoints(left.category ?? "", right.category ?? "")
      )
      .filter((skill, index, all) =>
        index === 0 || skill.name !== all[index - 1].name || skill.category !== all[index - 1].category
      ),
    experience: input.experience
      .map((item) => ({
        title: normalizeText(item.title),
        company: normalizeText(item.company),
        location: normalizeText(item.location),
        startDate: normalizeText(item.startDate),
        endDate: normalizeText(item.endDate),
        description: normalizeText(item.description),
        highlights: parseHighlights(item.highlights),
      }))
      .filter((item): item is typeof item & {
        title: string;
        company: string;
        startDate: string;
      } => item.title !== null && item.company !== null && item.startDate !== null)
      .sort((left, right) =>
        compareCodePoints(JSON.stringify(left), JSON.stringify(right))
      ),
    education: input.education
      .map((item) => ({
        institution: normalizeText(item.institution),
        degree: normalizeText(item.degree),
        field: normalizeText(item.field),
        startDate: normalizeText(item.startDate),
        endDate: normalizeText(item.endDate),
        gpa: normalizeText(item.gpa),
        honors: normalizeText(item.honors),
      }))
      .filter((item): item is typeof item & { institution: string; degree: string } =>
        item.institution !== null && item.degree !== null
      )
      .sort((left, right) =>
        compareCodePoints(JSON.stringify(left), JSON.stringify(right))
      ),
    preferences: {
      preferredCountry: normalizeIdentifier(input.profile.preferredCountry),
      preferredCity: normalizeIdentifier(input.profile.preferredCity),
      acceptedLocationTypes: normalizeStringArray(
        input.preferences?.acceptedLocationTypes ?? []
      ),
      acceptedEmploymentTypes: normalizeStringArray(
        input.preferences?.acceptedEmploymentTypes ?? []
      ),
    },
  }));
}

export function canonicalizeCandidateEvidence(input: CandidateEvidence): CandidateEvidence {
  const evidence = CandidateEvidenceSchema.parse(input);
  const normalized = {
    summary: normalizeText(evidence.summary),
    skills: evidence.skills.map((skill) => ({
      name: normalizeIdentifier(skill.name) ?? "",
      category: normalizeIdentifier(skill.category),
    })).sort((left, right) => compareCodePoints(JSON.stringify(left), JSON.stringify(right)))
      .filter((skill, index, all) =>
        index === 0 || JSON.stringify(skill) !== JSON.stringify(all[index - 1])
      ),
    experience: evidence.experience.map((item) => ({
      title: normalizeText(item.title) ?? "",
      company: normalizeText(item.company) ?? "",
      location: normalizeText(item.location),
      startDate: normalizeText(item.startDate) ?? "",
      endDate: normalizeText(item.endDate),
      description: normalizeText(item.description),
      highlights: Array.from(new Set(item.highlights
        .map(normalizeText)
        .filter((value): value is string => value !== null)))
        .sort(compareCodePoints),
    })).sort((left, right) => compareCodePoints(JSON.stringify(left), JSON.stringify(right))),
    education: evidence.education.map((item) => ({
      institution: normalizeText(item.institution) ?? "",
      degree: normalizeText(item.degree) ?? "",
      field: normalizeText(item.field),
      startDate: normalizeText(item.startDate),
      endDate: normalizeText(item.endDate),
      gpa: normalizeText(item.gpa),
      honors: normalizeText(item.honors),
    })).sort((left, right) => compareCodePoints(JSON.stringify(left), JSON.stringify(right))),
    preferences: {
      preferredCountry: normalizeIdentifier(evidence.preferences.preferredCountry),
      preferredCity: normalizeIdentifier(evidence.preferences.preferredCity),
      acceptedLocationTypes: normalizeStringArray(evidence.preferences.acceptedLocationTypes),
      acceptedEmploymentTypes: normalizeStringArray(
        evidence.preferences.acceptedEmploymentTypes
      ),
    },
  };
  return CandidateEvidenceSchema.parse(normalized);
}

export function buildCandidateFingerprint(evidence: CandidateEvidence): string {
  return fingerprintAIInput(canonicalizeCandidateEvidence(evidence));
}

export interface JobFingerprintInput {
  title: string;
  description: string | null;
  location: string | null;
  locationType: string | null;
  seniorityLevel: string | null;
  department: string | null;
  employmentType: string | null;
  salary: string | null;
}

export function buildJobEvidenceInput(input: JobFingerprintInput): JobEvidenceInput {
  return canonicalizeJobEvidenceInput({
    title: input.title,
    description: input.description,
    location: input.location,
    locationType: input.locationType,
    seniorityLevel: input.seniorityLevel,
    department: input.department,
    employmentType: input.employmentType,
    compensationText: input.salary,
  });
}

export function canonicalizeJobEvidenceInput(input: JobEvidenceInput): JobEvidenceInput {
  const evidence = JobEvidenceInputSchema.parse(input);
  return JobEvidenceInputSchema.parse({
    title: normalizeText(evidence.title) ?? "",
    description: normalizeText(evidence.description),
    location: normalizeText(evidence.location),
    locationType: normalizeIdentifier(evidence.locationType),
    seniorityLevel: normalizeIdentifier(evidence.seniorityLevel),
    department: normalizeIdentifier(evidence.department),
    employmentType: normalizeIdentifier(evidence.employmentType),
    compensationText: normalizeText(evidence.compensationText),
  });
}

export function buildJobFingerprint(evidence: JobEvidenceInput): string {
  return fingerprintAIInput(canonicalizeJobEvidenceInput(evidence));
}
