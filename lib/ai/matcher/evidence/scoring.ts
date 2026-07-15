import type {
  JobAnalysisEvidence,
  JobEvidenceInput,
  JobRequirementEvidence,
  MatchBand,
  MatchBreakdown,
  MatchConstraint,
  MatchEvidence,
  RequirementAssessment,
} from "@/lib/ai/artifacts";
import { COUNTRY_MAPPINGS } from "@/lib/scraper/utils/common";

import {
  inferSeniority,
  normalizeSkill,
  seniorityRank,
  type ScoringCandidate,
} from "./candidate";
import { isOverallExperienceScope } from "./job-analysis";

export const SCORING_POLICY_VERSION = "evidence-score-v4";

const ROLE_COMPONENT_WEIGHTS = {
  requirementFit: 50,
  experience: 35,
  seniority: 15,
} as const;
const NEUTRAL_PRIOR_SCORE = 60;

const REQUIREMENT_WEIGHTS = {
  critical: 4,
  important: 3,
  preferred: 1,
  contextual: 0,
} as const;

const STATUS_SCORES = {
  direct_match: 100,
  equivalent_match: 90,
  transferable_match: 75,
  partial_match: 50,
  missing: 0,
  unknown: null,
  not_applicable: null,
} as const;

const TRANSFERABLE_SKILL_FAMILIES: ReadonlyArray<ReadonlyArray<string>> = [
  ["amazon web services", "azure", "google cloud platform"],
  ["postgresql", "mysql", "mariadb", "oracle", "sql server"],
  ["react", "vue", "angular", "svelte"],
  ["kubernetes", "docker", "containerd"],
  ["terraform", "pulumi", "cloudformation"],
  ["javascript", "typescript"],
];

const TRANSFERABLE_FAMILY_BY_SKILL = new Map<string, Set<string>>(
  TRANSFERABLE_SKILL_FAMILIES.flatMap((family) => {
    const normalized = new Set(family.map(normalizeSkill));
    return Array.from(normalized).map((skill) => [skill, normalized] as const);
  })
);

type RoleComponentName = keyof typeof ROLE_COMPONENT_WEIGHTS;

export interface ScoredRequirementAssessment extends RequirementAssessment {
  importance: JobRequirementEvidence["importance"];
  type: JobRequirementEvidence["type"];
  text: string;
  terms: string[];
  experienceYears?: number | null;
  experienceScope?: string | null;
  semanticConfidence?: number;
}

export interface DeterministicScoreResult {
  score: number;
  roleFitScore: number;
  matchBand: MatchBand;
  breakdown: MatchBreakdown;
  evidence: MatchEvidence;
  confidence: number;
  evidenceCoverage: number;
  extractionConfidence: number;
  constraints: MatchConstraint[];
  requirementAssessments: ScoredRequirementAssessment[];
  hardCap: number | null;
  availableWeight: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
}

function truncateEvidence(value: string): string {
  return value.slice(0, 2_000);
}

function containsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}+#])${escaped}(?=$|[^\\p{L}\\p{N}+#])`,
    "iu"
  ).test(text);
}

function containsCountryEquivalent(location: string, country: string): boolean {
  const normalizedCountry = country.toLocaleLowerCase("en-US").trim();
  const canonicalCountry = Object.entries(COUNTRY_MAPPINGS).find(
    ([key, variations]) =>
      key === normalizedCountry || variations.includes(normalizedCountry)
  )?.[0];
  const variations = canonicalCountry
    ? COUNTRY_MAPPINGS[canonicalCountry] ?? [normalizedCountry]
    : [normalizedCountry];
  return variations.some((variation) => containsTerm(location, variation));
}

function inferArrangement(constraints: string[]): string | undefined {
  const text = constraints.join("; ").toLocaleLowerCase("en-US");
  const hasRemote = /\bremote\b/.test(text) &&
    !/(?:\bno\b|\bnot\b|\bwithout\b)\s+(?:\w+\s+){0,3}\bremote\b|\bremote\b.{0,30}\b(?:not available|unavailable|not allowed|not offered|not permitted)\b/.test(text);
  const hasOnsite = /\bon-?site\b/.test(text) &&
    !/(?:\bno\b|\bnot\b|\bwithout\b)\s+(?:\w+\s+){0,3}\bon-?site\b|\bon-?site\b.{0,30}\b(?:not available|unavailable|not allowed|not offered|not permitted)\b/.test(text);
  const hasHybrid = /\bhybrid\b/.test(text) &&
    !/(?:\bno\b|\bnot\b|\bwithout\b)\s+(?:\w+\s+){0,3}\bhybrid\b|\bhybrid\b.{0,30}\b(?:not available|unavailable|not allowed|not offered|not permitted)\b/.test(text);

  if (hasHybrid || (hasRemote && hasOnsite)) return "hybrid";
  if (hasOnsite) return "onsite";
  if (hasRemote) return "remote";
  return undefined;
}

function hasExplicitGeography(value: string): boolean {
  const remainder = value.toLocaleLowerCase("en-US")
    .replace(/\b(remote|hybrid|on-?site|work|working|role|position|job|is|are|available|allowed|option|can|be|performed|anywhere|only|in|from|within|based|located|restricted|limited|fully|friendly|first)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return remainder.length > 0;
}

function locationComponent(
  candidate: ScoringCandidate,
  job: JobEvidenceInput,
  analysis: JobAnalysisEvidence
): { score: number; blocking: boolean; reason: string } | null {
  const analyzedArrangement = inferArrangement(analysis.locationConstraints);
  const locationType = (analyzedArrangement ?? job.locationType)
    ?.replace("-", "")
    .toLocaleLowerCase("en-US");
  const geographicLocation = [job.location, ...analysis.locationConstraints]
    .filter((item): item is string => Boolean(item && hasExplicitGeography(item)))
    .join(", ")
    .toLocaleLowerCase("en-US");
  const accepted = candidate.evidence.preferences.acceptedLocationTypes;
  const preferredCountry = candidate.evidence.preferences.preferredCountry;
  const preferredCity = candidate.evidence.preferences.preferredCity;

  if (!locationType && !geographicLocation) return null;
  if (locationType === "remote") {
    if (accepted.length > 0 && !accepted.includes("remote")) {
      return {
        score: 0,
        blocking: false,
        reason: "Remote work arrangement is outside candidate preferences",
      };
    }
    if ((preferredCity || preferredCountry) && geographicLocation) {
      const compatible = preferredCity
        ? containsTerm(geographicLocation, preferredCity)
        : Boolean(
            preferredCountry && containsCountryEquivalent(geographicLocation, preferredCountry)
          );
      return {
        score: compatible ? 100 : 0,
        blocking: !compatible,
        reason: compatible
          ? "Remote role's geographic restriction matches the candidate"
          : "Remote role's geographic restriction excludes the candidate's location",
      };
    }
    return { score: 100, blocking: false, reason: "Role is remote" };
  }

  if (accepted.length > 0 && locationType && !accepted.includes(locationType)) {
    return {
      score: 0,
      blocking: false,
      reason: `Work arrangement ${locationType} is outside candidate preferences`,
    };
  }

  if (!preferredCountry && !preferredCity) {
    return accepted.length > 0 && locationType
      ? { score: 100, blocking: false, reason: `Accepted ${locationType} work arrangement` }
      : null;
  }
  if (!geographicLocation) return null;

  const compatible = preferredCity
    ? containsTerm(geographicLocation, preferredCity)
    : Boolean(
        preferredCountry && containsCountryEquivalent(geographicLocation, preferredCountry)
      );
  return {
    score: compatible ? 100 : 0,
    blocking: !compatible && locationType === "onsite",
    reason: compatible
      ? "Job location matches the candidate preference"
      : "Job location conflicts with the candidate preference",
  };
}

function employmentComponent(
  candidate: ScoringCandidate,
  job: JobEvidenceInput,
  analysis: JobAnalysisEvidence
): { score: number; reason: string } | null {
  const employmentType = (job.employmentType ?? analysis.employmentType)
    ?.toLocaleLowerCase("en-US");
  const accepted = candidate.evidence.preferences.acceptedEmploymentTypes;
  if (!employmentType || accepted.length === 0) return null;
  const compatible = accepted.includes(employmentType);
  return {
    score: compatible ? 100 : 0,
    reason: compatible
      ? `Accepted ${employmentType} employment type`
      : `Employment type ${employmentType} is outside candidate preferences`,
  };
}

function legacyRequirements(analysis: JobAnalysisEvidence): JobRequirementEvidence[] {
  return [
    ...analysis.mustHaveSkills.map((skill, index) => ({
      id: `legacy-must:${index}`,
      type: "technology" as const,
      text: skill,
      terms: [skill],
      alternatives: [],
      importance: "important" as const,
      explicitness: "ambiguous" as const,
      experienceYears: null,
      experienceScope: null,
      sourceEvidence: skill,
      confidence: analysis.extractionConfidence,
    })),
    ...analysis.preferredSkills.map((skill, index) => ({
      id: `legacy-preferred:${index}`,
      type: "technology" as const,
      text: skill,
      terms: [skill],
      alternatives: [],
      importance: "preferred" as const,
      explicitness: "explicit" as const,
      experienceYears: null,
      experienceScope: null,
      sourceEvidence: skill,
      confidence: analysis.extractionConfidence,
    })),
  ];
}

function evidenceReferencesForTerm(
  candidate: ScoringCandidate,
  term: string
): string[] {
  const normalized = normalizeSkill(term);
  return candidate.evidenceItems.filter((item) =>
    (item.type === "skill" && normalizeSkill(item.label) === normalized) ||
    containsTerm(item.text.toLocaleLowerCase("en-US"), term.toLocaleLowerCase("en-US"))
  ).map((item) => item.id).slice(0, 20);
}

function findTransferableEvidence(
  candidate: ScoringCandidate,
  terms: string[]
): string[] {
  const families = terms
    .map(normalizeSkill)
    .map((term) => TRANSFERABLE_FAMILY_BY_SKILL.get(term))
    .filter((family): family is Set<string> => family !== undefined);
  if (families.length === 0) return [];

  const candidateMatches = Array.from(candidate.normalizedSkills).filter((skill) =>
    families.some((family) => family.has(skill))
  );
  return candidateMatches.flatMap((skill) =>
    candidate.evidenceItems
      .filter((item) => item.type === "skill" && normalizeSkill(item.label) === skill)
      .map((item) => item.id)
  ).slice(0, 20);
}

function experienceScore(required: number, candidate: number): number {
  const gap = required - candidate;
  if (gap <= 0.5) return 100;
  if (gap <= 1.5) return 100 - (gap - 0.5) * 10;
  if (gap <= 3) return 90 - (gap - 1.5) * (35 / 1.5);
  return Math.max(10, 55 - (gap - 3) * 25);
}

function requirementAssessment(
  candidate: ScoringCandidate,
  requirement: JobRequirementEvidence
): ScoredRequirementAssessment {
  if (requirement.importance === "contextual") {
    return {
      requirementId: requirement.id,
      status: "not_applicable",
      confidence: requirement.confidence,
      evidenceReferences: [],
      rationale: "Contextual evidence does not reduce the candidate's match.",
      importance: requirement.importance,
      type: requirement.type,
      text: requirement.text,
      terms: requirement.terms,
    };
  }

  if (requirement.type === "experience" && requirement.experienceYears !== null) {
    if (!isOverallExperienceScope(requirement.experienceScope)) {
      const scopeTerms = Array.from(new Set([
        ...requirement.terms,
        ...(requirement.experienceScope?.match(/[\p{L}\p{N}+#.-]{3,}/gu) ?? []),
      ])).slice(0, 20);
      const references = scopeTerms.flatMap((term) =>
        evidenceReferencesForTerm(candidate, term)
      );
      return {
        requirementId: requirement.id,
        status: references.length > 0 ? "partial_match" : "unknown",
        confidence: references.length > 0 ? 0.45 : 0.3,
        evidenceReferences: Array.from(new Set(references)).slice(0, 20),
        rationale: references.length > 0
          ? "Related candidate evidence exists, but scoped duration needs semantic review."
          : "The available profile does not establish duration for this scoped experience.",
        importance: requirement.importance,
        type: requirement.type,
        text: requirement.text,
        terms: requirement.terms,
        experienceYears: requirement.experienceYears,
        experienceScope: requirement.experienceScope,
      };
    }
    if (candidate.totalExperienceYears === null) {
      return {
        requirementId: requirement.id,
        status: "unknown",
        confidence: 0.3,
        evidenceReferences: [],
        rationale: "Candidate experience duration is unavailable.",
        importance: requirement.importance,
        type: requirement.type,
        text: requirement.text,
        terms: requirement.terms,
        experienceYears: requirement.experienceYears,
        experienceScope: requirement.experienceScope,
      };
    }
    const score = experienceScore(requirement.experienceYears, candidate.totalExperienceYears);
    return {
      requirementId: requirement.id,
      status: score >= 99 ? "direct_match" : score >= 70 ? "partial_match" : "missing",
      confidence: requirement.confidence,
      evidenceReferences: ["candidate:total_experience"],
      rationale: `${candidate.totalExperienceYears.toFixed(1)} years of candidate experience compared with ${requirement.experienceYears} requested years.`,
      importance: requirement.importance,
      type: requirement.type,
      text: requirement.text,
      terms: requirement.terms,
      experienceYears: requirement.experienceYears,
      experienceScope: requirement.experienceScope,
    };
  }

  if (requirement.type === "management") {
    return {
      requirementId: requirement.id,
      status: candidate.managementExperience ? "direct_match" : "missing",
      confidence: requirement.confidence,
      evidenceReferences: candidate.managementExperience ? ["candidate:management"] : [],
      rationale: candidate.managementExperience
        ? "Candidate evidence includes management responsibility."
        : "Candidate evidence does not demonstrate people-management responsibility.",
      importance: requirement.importance,
      type: requirement.type,
      text: requirement.text,
      terms: requirement.terms,
    };
  }

  const terms = Array.from(new Set([
    ...requirement.terms,
    ...requirement.alternatives,
  ].map(normalizeSkill).filter(Boolean)));
  const directReferences = terms.flatMap((term) => evidenceReferencesForTerm(candidate, term));
  if (directReferences.length > 0) {
    return {
      requirementId: requirement.id,
      status: "direct_match",
      confidence: Math.max(0.8, requirement.confidence),
      evidenceReferences: Array.from(new Set(directReferences)).slice(0, 20),
      rationale: "Candidate evidence directly supports the requested requirement or an allowed alternative.",
      importance: requirement.importance,
      type: requirement.type,
      text: requirement.text,
      terms: requirement.terms,
    };
  }

  const transferableReferences = findTransferableEvidence(candidate, terms);
  if (transferableReferences.length > 0) {
    return {
      requirementId: requirement.id,
      status: "transferable_match",
      confidence: 0.65,
      evidenceReferences: Array.from(new Set(transferableReferences)),
      rationale: "Candidate evidence shows a closely related technology family that may transfer.",
      importance: requirement.importance,
      type: requirement.type,
      text: requirement.text,
      terms: requirement.terms,
    };
  }

  const clearlyMissing = (
    requirement.importance === "critical" || requirement.importance === "important"
  ) &&
    requirement.explicitness === "explicit" &&
    requirement.confidence >= 0.75 &&
    terms.length > 0;
  return {
    requirementId: requirement.id,
    status: clearlyMissing ? "missing" : "unknown",
    confidence: clearlyMissing ? requirement.confidence : Math.min(0.5, requirement.confidence),
    evidenceReferences: [],
    rationale: clearlyMissing
      ? "No candidate evidence supports this explicit critical requirement."
      : "The available profile evidence is insufficient for a reliable determination.",
    importance: requirement.importance,
    type: requirement.type,
    text: requirement.text,
    terms: requirement.terms,
  };
}

function mergeSemanticAssessments(
  deterministic: ScoredRequirementAssessment[],
  semantic: RequirementAssessment[]
): ScoredRequirementAssessment[] {
  const semanticById = new Map(semantic.map((assessment) => [assessment.requirementId, assessment]));
  return deterministic.map((assessment) => {
    const replacement = semanticById.get(assessment.requirementId);
    if (!replacement || replacement.confidence < 0.5) return assessment;
    return {
      ...assessment,
      ...replacement,
      requirementType: assessment.type,
      requirementImportance: assessment.importance,
      requirementText: assessment.text,
      semanticConfidence: replacement.confidence,
    };
  });
}

function effectiveAssessmentScore(assessment: ScoredRequirementAssessment): number | null {
  const statusScore = STATUS_SCORES[assessment.status];
  if (statusScore === null) return null;
  if (assessment.semanticConfidence === undefined) return statusScore;
  return statusScore * assessment.semanticConfidence +
    NEUTRAL_PRIOR_SCORE * (1 - assessment.semanticConfidence);
}

function assessmentKnownFraction(assessment: ScoredRequirementAssessment): number {
  if (STATUS_SCORES[assessment.status] === null) return 0;
  return assessment.semanticConfidence ?? 1;
}

function requirementAggregate(assessments: ScoredRequirementAssessment[]): {
  score: number | null;
  coverage: number;
  totalWeight: number;
  knownWeight: number;
} {
  const scoreBearing = assessments.filter((assessment) =>
    assessment.importance !== "contextual" &&
    !["location", "authorization", "license", "employment"].includes(assessment.type) &&
    !(assessment.type === "experience" && isOverallExperienceScope(assessment.experienceScope)) &&
    !(assessment.type === "management" && assessment.importance !== "preferred")
  );
  const totalWeight = scoreBearing.reduce(
    (sum, assessment) => sum + REQUIREMENT_WEIGHTS[assessment.importance],
    0
  );
  const knownWeight = scoreBearing.reduce(
    (sum, assessment) => sum + REQUIREMENT_WEIGHTS[assessment.importance] *
      assessmentKnownFraction(assessment),
    0
  );
  if (totalWeight === 0) {
    return { score: null, coverage: 0, totalWeight, knownWeight };
  }
  const score = scoreBearing.reduce((sum, assessment) =>
    sum + (effectiveAssessmentScore(assessment) ?? NEUTRAL_PRIOR_SCORE) *
      REQUIREMENT_WEIGHTS[assessment.importance], 0) / totalWeight;
  return {
    score,
    coverage: totalWeight === 0 ? 0 : knownWeight / totalWeight,
    totalWeight,
    knownWeight,
  };
}

function bandForScore(score: number, coverage: number): MatchBand {
  if (coverage < 0.55) return "insufficient_evidence";
  if (score >= 85) return "high";
  if (score >= 70) return "good";
  if (score >= 55) return "possible";
  if (score >= 40) return "stretch";
  return "low";
}

function buildSummary(
  band: MatchBand,
  assessments: ScoredRequirementAssessment[],
  semanticSummary?: string
): string {
  if (semanticSummary?.trim()) return semanticSummary.trim().slice(0, 2_000);
  if (band === "insufficient_evidence") {
    return "There is not enough verified evidence to classify this match reliably yet.";
  }
  const strengths = assessments.filter((assessment) =>
    ["direct_match", "equivalent_match", "transferable_match"].includes(assessment.status)
  ).length;
  const gaps = assessments.filter((assessment) => assessment.status === "missing").length;
  return `${band[0].toUpperCase()}${band.slice(1)} role fit based on ${strengths} supported requirement${strengths === 1 ? "" : "s"}${gaps > 0 ? ` and ${gaps} meaningful gap${gaps === 1 ? "" : "s"}` : ""}.`;
}

export function scoreDeterministically(
  candidate: ScoringCandidate,
  job: JobEvidenceInput,
  analysis: JobAnalysisEvidence,
  semanticAssessments: RequirementAssessment[] = [],
  semanticSummary?: string
): DeterministicScoreResult {
  const requirements = (analysis.requirements?.length ?? 0) > 0
    ? analysis.requirements!
    : legacyRequirements(analysis);
  const deterministicAssessments = requirements.map((requirement) =>
    requirementAssessment(candidate, requirement)
  );
  const assessments = mergeSemanticAssessments(
    deterministicAssessments,
    semanticAssessments
  );
  const requirementResult = requirementAggregate(assessments);
  const values: Partial<Record<RoleComponentName, number>> = {};
  const componentCoverage: Partial<Record<RoleComponentName, number>> = {};
  const componentEvidence: Record<string, string[]> = {};
  const reasons: string[] = [];
  const recommendations: string[] = [];

  if (requirementResult.score !== null) {
    values.requirementFit = requirementResult.score;
    componentCoverage.requirementFit = requirementResult.coverage;
    componentEvidence.requirementFit = assessments
      .filter((assessment) => assessment.importance !== "contextual")
      .map((assessment) => truncateEvidence(
        `${assessment.status}: ${assessment.text} — ${assessment.rationale}`
      ));
  }

  if (analysis.minimumExperienceYears !== null && candidate.totalExperienceYears !== null) {
    const score = experienceScore(
      analysis.minimumExperienceYears,
      candidate.totalExperienceYears
    );
    values.experience = score;
    componentCoverage.experience = 1;
    componentEvidence.experience = [
      `Candidate: ${candidate.totalExperienceYears.toFixed(1)} years`,
      `Requested: ${analysis.minimumExperienceYears} years`,
      analysis.minimumExperienceYears - candidate.totalExperienceYears <= 0.5
        ? "A difference of six months or less is treated as fully compatible"
        : "Experience uses a gradual tolerance curve rather than a hard cutoff",
    ];
  }

  const requiredSeniority = inferSeniority(analysis.seniorityLevel ?? job.seniorityLevel);
  if (requiredSeniority && candidate.seniorityLevel) {
    const gap = seniorityRank(requiredSeniority) - seniorityRank(candidate.seniorityLevel);
    values.seniority = gap <= 0 ? 100 : gap === 1 ? 75 : gap === 2 ? 50 : 25;
    componentCoverage.seniority = 1;
    componentEvidence.seniority = [
      `Candidate: ${candidate.seniorityLevel}`,
      `Requested: ${requiredSeniority}`,
    ];
  }
  const managementAssessments = assessments.filter((assessment) =>
    assessment.type === "management" &&
    (assessment.importance === "critical" || assessment.importance === "important")
  );
  if (managementAssessments.length > 0) {
    const managementResult = requirementAggregate(managementAssessments.map((assessment) => ({
      ...assessment,
      type: "competency" as const,
    })));
    const titleSeniority = values.seniority;
    const titleCoverage = componentCoverage.seniority ?? 0;
    const managementScore = managementResult.score ?? NEUTRAL_PRIOR_SCORE;
    values.seniority = titleSeniority === undefined
      ? managementScore
      : (titleSeniority + managementScore) / 2;
    componentCoverage.seniority = titleSeniority === undefined
      ? managementResult.coverage
      : (titleCoverage + managementResult.coverage) / 2;
    componentEvidence.seniority = [
      ...(componentEvidence.seniority ?? []),
      ...managementAssessments.map((assessment) =>
        truncateEvidence(`${assessment.status}: ${assessment.text} — ${assessment.rationale}`)
      ),
    ];
  } else if (
    analysis.managementTrack === true &&
    !assessments.some((assessment) => assessment.type === "management")
  ) {
    values.seniority = candidate.managementExperience ? 100 : 45;
    componentCoverage.seniority = 1;
    componentEvidence.seniority = [candidate.managementExperience
      ? "Candidate evidence demonstrates the requested management responsibility"
      : "Role asks for management responsibility that is not demonstrated in the profile"];
  }

  const configuredComponents = Object.entries(values) as Array<[RoleComponentName, number]>;
  const totalConfiguredWeight = configuredComponents.reduce(
    (sum, [component]) => sum + ROLE_COMPONENT_WEIGHTS[component],
    0
  );
  const observedWeight = configuredComponents.reduce(
    (sum, [component]) =>
      sum + ROLE_COMPONENT_WEIGHTS[component] * (componentCoverage[component] ?? 0),
    0
  );
  const observedScore = observedWeight === 0
    ? NEUTRAL_PRIOR_SCORE
    : configuredComponents.reduce((sum, [component, componentScore]) =>
        sum + componentScore * ROLE_COMPONENT_WEIGHTS[component] *
          (componentCoverage[component] ?? 0), 0) / observedWeight;
  const scoreBearingBreadth = Math.min(1, observedWeight / 100);
  const evidenceCoverage = totalConfiguredWeight === 0
    ? 0
    : Math.min(1, observedWeight / totalConfiguredWeight);
  const uncalibratedRoleFitScore =
    observedScore * scoreBearingBreadth + NEUTRAL_PRIOR_SCORE * (1 - scoreBearingBreadth);
  const explicitExperienceGap = analysis.minimumExperienceYears !== null &&
    candidate.totalExperienceYears !== null
    ? analysis.minimumExperienceYears - candidate.totalExperienceYears
    : 0;
  const seniorityGap = requiredSeniority && candidate.seniorityLevel
    ? seniorityRank(requiredSeniority) - seniorityRank(candidate.seniorityLevel)
    : 0;
  const experienceCalibration = explicitExperienceGap > 3
    ? Math.max(0.65, 0.84 - (explicitExperienceGap - 3) * 0.06)
    : 1;
  const seniorityCalibration = seniorityGap >= 2
    ? Math.max(0.65, 0.75 - (seniorityGap - 2) * 0.1)
    : 1;
  const mismatchCalibration = Math.max(
    0.65,
    experienceCalibration * seniorityCalibration
  );
  const roleFitScore = round(uncalibratedRoleFitScore * mismatchCalibration);
  const matchBand = bandForScore(roleFitScore, evidenceCoverage);

  if (explicitExperienceGap > 3) {
    reasons.push(
      `A ${round(explicitExperienceGap)}-year experience difference lowers compatibility gradually`
    );
    componentEvidence.experience = [
      ...(componentEvidence.experience ?? []),
      "A significant experience difference applies a gradual whole-role calibration, not a hard cap",
    ];
  }
  if (seniorityGap >= 2) {
    reasons.push(`Candidate and role seniority differ by ${seniorityGap} levels`);
    componentEvidence.seniority = [
      ...(componentEvidence.seniority ?? []),
      "A multi-level seniority difference applies a gradual whole-role calibration, not a hard cap",
    ];
  }

  const location = locationComponent(candidate, job, analysis);
  const employment = employmentComponent(candidate, job, analysis);
  const constraints: MatchConstraint[] = [];
  if (location) {
    constraints.push({
      type: "location",
      status: location.score === 100 ? "satisfied" : "conflict",
      severity: location.blocking ? "blocking" : "preference",
      message: location.reason,
    });
    componentEvidence.location = [location.reason];
  }
  if (employment) {
    constraints.push({
      type: "employment",
      status: employment.score === 100 ? "satisfied" : "conflict",
      severity: "preference",
      message: employment.reason,
    });
    componentEvidence.employmentType = [employment.reason];
  }
  for (const assessment of assessments) {
    if (!["location", "authorization", "license", "employment"].includes(assessment.type)) {
      continue;
    }
    if (assessment.importance === "contextual") continue;
    const constraintStatus = assessment.semanticConfidence !== undefined &&
      assessment.semanticConfidence < 0.7
      ? "unknown"
      : assessment.status === "missing"
        ? "conflict"
        : ["direct_match", "equivalent_match", "transferable_match"].includes(assessment.status)
          ? "satisfied"
          : "unknown";
    constraints.push({
      type: assessment.type as "location" | "authorization" | "license" | "employment",
      status: constraintStatus,
      severity: assessment.type === "employment"
        ? "preference"
        : assessment.importance === "critical"
          ? "blocking"
          : "informational",
      message: `${assessment.text}: ${assessment.rationale}`,
    });
  }

  const matchedSkills = assessments.filter((assessment) =>
    ["direct_match", "equivalent_match", "transferable_match"].includes(assessment.status)
  ).flatMap((assessment) => assessment.terms);
  const missingSkills = assessments.filter((assessment) =>
    assessment.status === "missing" &&
    (assessment.importance === "critical" || assessment.importance === "important")
  ).flatMap((assessment) => assessment.terms);
  const gaps = assessments.filter((assessment) =>
    assessment.status === "missing" && assessment.importance !== "contextual"
  );
  if (gaps.length > 0) {
    reasons.push(`${gaps.length} meaningful requirement gap${gaps.length === 1 ? "" : "s"} identified`);
    recommendations.push(...gaps.slice(0, 8).map((assessment) =>
      truncateEvidence(`Review requirement: ${assessment.text}`)
    ));
  }
  const transferable = assessments.filter((assessment) =>
    assessment.status === "transferable_match"
  );
  if (transferable.length > 0) {
    reasons.push(`${transferable.length} requirement${transferable.length === 1 ? "" : "s"} supported by transferable experience`);
  }

  const extractionConfidence = roundConfidence(analysis.extractionConfidence);
  const semanticConfidences = assessments
    .map((assessment) => assessment.semanticConfidence)
    .filter((value): value is number => value !== undefined);
  const semanticConfidence = semanticConfidences.length === 0
    ? 1
    : semanticConfidences.reduce((sum, value) => sum + value, 0) /
      semanticConfidences.length;
  const confidence = roundConfidence(
    extractionConfidence * 0.45 + evidenceCoverage * 0.35 + semanticConfidence * 0.2
  );
  const preferenceScores = [location?.score, employment?.score].filter(
    (value): value is number => value !== undefined
  );
  const preferenceFit = preferenceScores.length === 0
    ? null
    : preferenceScores.reduce((sum, value) => sum + value, 0) / preferenceScores.length;
  const summary = buildSummary(matchBand, assessments, semanticSummary);

  return {
    score: roleFitScore,
    roleFitScore,
    matchBand,
    breakdown: {
      roleFit: roleFitScore,
      requirementFit: requirementResult.score === null ? null : round(requirementResult.score),
      preferenceFit: preferenceFit === null ? null : round(preferenceFit),
      mustHaveSkills: requirementResult.score === null ? null : round(requirementResult.score),
      preferredSkills: null,
      experience: values.experience === undefined ? null : round(values.experience),
      seniority: values.seniority === undefined ? null : round(values.seniority),
      location: location?.score ?? null,
      employmentType: employment?.score ?? null,
    },
    evidence: {
      reasons,
      matchedSkills: Array.from(new Set(matchedSkills)).slice(0, 500),
      missingSkills: Array.from(new Set(missingSkills)).slice(0, 500),
      recommendations,
      componentEvidence,
      summary,
      matchBand,
      roleFitScore,
      evidenceCoverage: roundConfidence(evidenceCoverage),
      extractionConfidence,
      constraints,
      requirementAssessments: assessments.map((assessment) => ({
        requirementId: assessment.requirementId,
        status: assessment.status,
        confidence: assessment.confidence,
        evidenceReferences: assessment.evidenceReferences,
        rationale: assessment.rationale.slice(0, 1_000),
        requirementType: assessment.type,
        requirementImportance: assessment.importance,
        requirementText: assessment.text,
      })),
    },
    confidence,
    evidenceCoverage: roundConfidence(evidenceCoverage),
    extractionConfidence,
    constraints,
    requirementAssessments: assessments,
    hardCap: null,
    availableWeight: round(observedWeight),
  };
}

export function applyAdjudicationAdjustment(
  deterministic: DeterministicScoreResult,
  adjustment: number
): number {
  const boundedAdjustment = Math.max(-10, Math.min(10, adjustment));
  return round(Math.max(0, Math.min(100, deterministic.score + boundedAdjustment)));
}
