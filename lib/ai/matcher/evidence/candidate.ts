import { CandidateEvidenceSchema, type CandidateEvidence } from "@/lib/ai/artifacts/schemas";

import { calculateTotalExperienceYears } from "../utils";

export type SeniorityLevel =
  | "entry"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "director"
  | "executive";

export interface ScoringCandidate {
  evidence: CandidateEvidence;
  normalizedSkills: Set<string>;
  totalExperienceYears: number | null;
  seniorityLevel: SeniorityLevel | null;
  managementExperience: boolean;
  domainKeywords: Set<string>;
  evidenceItems: CandidateEvidenceItem[];
}

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

const DOMAIN_STOP_WORDS = new Set([
  "and", "engineer", "engineering", "developer", "development", "manager",
  "senior", "lead", "the", "with", "for", "from", "that", "this", "work",
]);

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

export function seniorityRank(level: SeniorityLevel): number {
  const ranks: Record<SeniorityLevel, number> = {
    entry: 0,
    mid: 1,
    senior: 2,
    lead: 3,
    manager: 3,
    director: 4,
    executive: 5,
  };
  return ranks[level];
}

export function inferSeniority(value?: string | null): SeniorityLevel | null {
  if (!value) return null;
  const text = value.toLocaleLowerCase("en-US");
  if (/\b(chief|c[etp]o|vice president|vp|executive)\b/.test(text)) return "executive";
  if (/\b(director|head of)\b/.test(text)) return "director";
  if (/\b(manager|management)\b/.test(text)) return "manager";
  if (/\b(lead|principal|staff|architect)\b/.test(text)) return "lead";
  if (/\b(senior|sr\.?|level 3|iii)\b/.test(text)) return "senior";
  if (/\b(junior|jr\.?|entry|graduate|intern|level 1|\bi\b)\b/.test(text)) return "entry";
  if (/\b(mid|intermediate|level 2|\bii\b)\b/.test(text)) return "mid";
  return null;
}

function collectDomainKeywords(evidence: CandidateEvidence): Set<string> {
  const text = evidence.experience
    .flatMap((item) => [item.title, item.description ?? "", ...item.highlights])
    .join(" ")
    .toLocaleLowerCase("en-US");
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]{2,}/gu) ?? [];
  return new Set(tokens.filter((token) => !DOMAIN_STOP_WORDS.has(token)).slice(0, 200));
}

function hasManagementEvidence(evidence: CandidateEvidence): boolean {
  return evidence.experience.some((item) => {
    const details = [item.description ?? "", ...item.highlights].join(" ");
    return /\b(manager|director|head of|vice president|vp|chief)\b/i.test(item.title) ||
      /\b(people management|people manager|managed direct reports?|managed (?:a |the )?team|led (?:a |the )?team|managed \d+ (?:engineers|people|reports)|hired and mentored)\b/i.test(details);
  });
}

export function enrichCandidateEvidence(
  input: CandidateEvidence,
  referenceDate = new Date()
): CandidateEvidence {
  const evidence = CandidateEvidenceSchema.parse(input);
  const seniorities = evidence.experience
    .map((item) => inferSeniority(item.title))
    .filter((level): level is SeniorityLevel => level !== null)
    .sort((left, right) => seniorityRank(right) - seniorityRank(left));
  const domainKeywords = Array.from(collectDomainKeywords(evidence)).sort();
  const asOfMonth = referenceDate.toISOString().slice(0, 7);
  const monthStart = Date.parse(`${asOfMonth}-01T00:00:00.000Z`);

  return CandidateEvidenceSchema.parse({
    ...evidence,
    totalExperienceYears: calculateTotalExperienceYears(
      evidence.experience,
      monthStart
    ),
    experienceAsOfMonth: asOfMonth,
    seniorityLevel: seniorities[0] ?? null,
    managementExperience: hasManagementEvidence(evidence),
    domainKeywords,
  });
}

export function buildScoringCandidate(evidence: CandidateEvidence): ScoringCandidate {
  const normalizedSkills = new Set(evidence.skills.map((skill) => normalizeSkill(skill.name)));
  const evidenceItems: CandidateEvidenceItem[] = [
    ...evidence.skills.map((skill, index) => ({
      id: `skill:${index}`,
      type: "skill" as const,
      label: skill.name,
      text: boundedEvidenceText([skill.name, skill.category]),
    })),
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
        item.title,
        item.description,
        ...item.highlights,
      ]),
    })),
    ...evidence.education.map((item, index) => ({
      id: `education:${index}`,
      type: "education" as const,
      label: `${item.degree} at ${item.institution}`,
      text: boundedEvidenceText([item.degree, item.field, item.institution, item.honors]),
    })),
  ];

  return {
    evidence,
    normalizedSkills,
    totalExperienceYears: evidence.totalExperienceYears,
    seniorityLevel: evidence.seniorityLevel,
    managementExperience: evidence.managementExperience,
    domainKeywords: new Set(evidence.domainKeywords),
    evidenceItems,
  };
}
