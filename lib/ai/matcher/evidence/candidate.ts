import { CandidateEvidenceSchema, type CandidateEvidence } from "@/lib/ai/artifacts/schemas";

import { calculateTotalExperienceYears } from "../utils";

export interface CandidateEvidenceItem {
  id: string;
  type: "skill" | "summary" | "experience" | "education";
  label: string;
  text: string;
  roleTitle?: string;
  startDate?: string | null;
  endDate?: string | null;
}

const SKILL_ALIASES: ReadonlyArray<ReadonlyArray<string>> = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["node.js", "nodejs", "node"],
  ["react", "reactjs", "react.js"],
  ["next.js", "nextjs", "next"],
  ["postgresql", "postgres"],
  ["amazon web services", "aws"],
  ["google cloud platform", "google cloud", "gcp"],
  ["kubernetes", "k8s"],
  ["continuous integration", "ci/cd", "cicd"],
];

const ALIAS_LOOKUP = new Map<string, string>(
  SKILL_ALIASES.flatMap((group) => group.map((alias) => [alias, group[0]] as const))
);

const MAX_EVIDENCE_ITEM_CHARS = 2_000;

function boundedEvidenceText(values: Array<string | null | undefined>): string {
  const parts: string[] = [];
  let remaining = MAX_EVIDENCE_ITEM_CHARS;
  for (const value of values) {
    if (!value || remaining <= 0) continue;
    const normalized = value.trim();
    if (!normalized) continue;
    const separatorLength = parts.length === 0 ? 0 : 1;
    const available = remaining - separatorLength;
    if (available <= 0) break;
    const bounded = normalized.slice(0, available);
    parts.push(bounded);
    remaining -= bounded.length + separatorLength;
  }
  return parts.join("\n");
}

export function normalizeSkill(value: string): string {
  const normalized = value.normalize("NFC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
  return ALIAS_LOOKUP.get(normalized) ?? normalized;
}

export function enrichCandidateEvidence(
  input: CandidateEvidence,
  referenceDate = new Date()
): CandidateEvidence {
  const evidence = CandidateEvidenceSchema.parse(input);
  const asOfMonth = referenceDate.toISOString().slice(0, 7);
  const monthStart = Date.parse(`${asOfMonth}-01T00:00:00.000Z`);

  return CandidateEvidenceSchema.parse({
    ...evidence,
    totalExperienceYears: calculateTotalExperienceYears(
      evidence.experience,
      monthStart
    ),
    experienceAsOfMonth: asOfMonth,
    // Candidate snapshots are a facts-only normalization boundary. Subjective
    // seniority, management, and domain conclusions belong to the match model.
    seniorityLevel: null,
    managementExperience: false,
    domainKeywords: [],
  });
}

export function buildCandidateEvidenceItems(
  evidence: CandidateEvidence
): CandidateEvidenceItem[] {
  return [
    ...(evidence.summary
      ? [{
          id: "summary",
          type: "summary" as const,
          label: "Professional summary",
          text: evidence.summary.slice(0, MAX_EVIDENCE_ITEM_CHARS),
        }]
      : []),
    ...evidence.experience.map((item, index) => ({
      id: `experience:${index}`,
      type: "experience" as const,
      label: `${item.title} at ${item.company}`,
      roleTitle: item.title,
      startDate: item.startDate,
      endDate: item.endDate,
      text: boundedEvidenceText([
        `Dates: ${item.startDate ?? "unknown"} to ${item.endDate ?? "present"}`,
        `Role: ${item.title}`,
        `Company: ${item.company}`,
        item.location ? `Location: ${item.location}` : null,
        item.description,
        ...item.highlights,
      ]),
    })),
    ...evidence.education.map((item, index) => ({
      id: `education:${index}`,
      type: "education" as const,
      label: `${item.degree} at ${item.institution}`,
      text: boundedEvidenceText([
        `Degree: ${item.degree}`,
        item.field ? `Field: ${item.field}` : null,
        `Institution: ${item.institution}`,
        item.startDate || item.endDate
          ? `Dates: ${item.startDate ?? "unknown"} to ${item.endDate ?? "unknown"}`
          : null,
        item.gpa ? `GPA: ${item.gpa}` : null,
        item.honors ? `Honors: ${item.honors}` : null,
      ]),
    })),
    ...evidence.skills.map((skill, index) => ({
      id: `skill:${index}`,
      type: "skill" as const,
      label: skill.name,
      text: boundedEvidenceText([skill.name, skill.category]),
    })),
  ];
}
