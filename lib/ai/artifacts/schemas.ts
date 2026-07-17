import { z } from "zod";

const NormalizedTextSchema = z.string().max(100_000);
const OptionalNormalizedTextSchema = NormalizedTextSchema.nullable();

export const CandidateEvidenceSchema = z.object({
  summary: OptionalNormalizedTextSchema,
  skills: z.array(z.object({
    name: z.string().min(1).max(200),
    category: z.string().max(200).nullable(),
  }).strict()).max(2_000),
  experience: z.array(z.object({
    title: z.string().min(1).max(500),
    company: z.string().min(1).max(500),
    location: z.string().max(500).nullable(),
    startDate: z.string().min(1).max(100),
    endDate: z.string().max(100).nullable(),
    description: OptionalNormalizedTextSchema,
    highlights: z.array(NormalizedTextSchema).max(500),
  }).strict()).max(500),
  education: z.array(z.object({
    institution: z.string().min(1).max(500),
    degree: z.string().min(1).max(500),
    field: z.string().max(500).nullable(),
    startDate: z.string().max(100).nullable(),
    endDate: z.string().max(100).nullable(),
    gpa: z.string().max(100).nullable(),
    honors: z.string().max(2_000).nullable(),
  }).strict()).max(200),
  preferences: z.object({
    preferredCountry: z.string().max(200).nullable(),
    preferredCity: z.string().max(200).nullable(),
  }).strict(),
  totalExperienceYears: z.number().min(0).max(100).nullable().default(null),
  experienceAsOfMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().default(null),
  seniorityLevel: z.enum([
    "entry", "mid", "senior", "lead", "manager", "director", "executive",
  ]).nullable().default(null),
  managementExperience: z.boolean().default(false),
  domainKeywords: z.array(z.string().min(1).max(200)).max(200).default([]),
}).strict();

export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>;

export const JobEvidenceInputSchema = z.object({
  title: z.string().min(1).max(1_000),
  description: OptionalNormalizedTextSchema,
  location: z.string().max(1_000).nullable(),
  locationType: z.string().max(100).nullable(),
  seniorityLevel: z.string().max(100).nullable(),
  department: z.string().max(500).nullable(),
  employmentType: z.string().max(100).nullable(),
  compensationText: z.string().max(2_000).nullable(),
}).strict();

export type JobEvidenceInput = z.infer<typeof JobEvidenceInputSchema>;

const JobRequirementTypeSchema = z.enum([
  "competency",
  "technology",
  "responsibility",
  "experience",
  "education",
  "domain",
  "management",
  "location",
  "authorization",
  "license",
  "employment",
]);

const JobRequirementImportanceSchema = z.enum([
  "critical",
  "important",
  "preferred",
  "contextual",
]);

export const JobRequirementEvidenceSchema = z.object({
  id: z.string().min(1).max(100),
  type: JobRequirementTypeSchema,
  text: z.string().min(1).max(1_000),
  importance: JobRequirementImportanceSchema,
  sourceEvidence: z.string().min(1).max(1_000),
}).strict();

export type JobRequirementEvidence = z.infer<typeof JobRequirementEvidenceSchema>;

export const JobAnalysisEvidenceSchema = z.object({
  summary: z.string().min(1).max(1_500),
  requirements: z.array(JobRequirementEvidenceSchema).max(20),
}).strict();

export type JobAnalysisEvidence = z.infer<typeof JobAnalysisEvidenceSchema>;

export const MatchBreakdownSchema = z.object({
  responsibilities: z.number().min(0).max(100).nullable().optional(),
  skillsAndTechnologies: z.number().min(0).max(100).nullable().optional(),
  experienceAndSeniority: z.number().min(0).max(100).nullable().optional(),
  domainFit: z.number().min(0).max(100).nullable().optional(),
  legacy: z.number().min(0).max(100).optional(),
}).strict();

export type MatchBreakdown = z.infer<typeof MatchBreakdownSchema>;

const MatchCategoryScoresSchema = z.object({
  responsibilities: z.number().min(0).max(100).nullable(),
  skillsAndTechnologies: z.number().min(0).max(100).nullable(),
  experienceAndSeniority: z.number().min(0).max(100).nullable(),
  domainFit: z.number().min(0).max(100).nullable(),
}).strict();

export const MatchReasoningPointSchema = z.object({
  type: z.enum(["match", "gap", "context"]),
  text: z.string().min(1).max(700),
  candidateEvidenceReferences: z.array(z.string().min(1).max(100)).max(12),
  jobRequirementReferences: z.array(z.string().min(1).max(100)).max(12),
}).strict();

export type MatchReasoningPoint = z.infer<typeof MatchReasoningPointSchema>;

export const AIMatchOutcomeSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(1).max(1_200),
  categoryScores: MatchCategoryScoresSchema,
  reasoning: z.array(MatchReasoningPointSchema).min(1).max(6),
  matchedSkills: z.array(z.string().min(1).max(200)).max(30),
}).strict();

export type AIMatchOutcome = z.infer<typeof AIMatchOutcomeSchema>;

export const MatchEvidenceSchema = z.object({
  summary: z.string().max(2_000).default(""),
  reasoning: z.array(MatchReasoningPointSchema).max(6).default([]),
  matchedSkills: z.array(z.string().max(200)).max(30).default([]),
});

export type MatchEvidence = z.infer<typeof MatchEvidenceSchema>;

export const ArtifactFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ArtifactVersionSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
export const MatchSourceSchema = z.enum(["legacy", "deterministic", "adjudicated", "ai"]);
