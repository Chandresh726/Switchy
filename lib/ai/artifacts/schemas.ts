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
    acceptedLocationTypes: z.array(z.string().min(1).max(100)).max(20),
    acceptedEmploymentTypes: z.array(z.string().min(1).max(100)).max(20),
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

export const JobAnalysisEvidenceSchema = z.object({
  mustHaveSkills: z.array(z.string().min(1).max(200)).max(500),
  preferredSkills: z.array(z.string().min(1).max(200)).max(500),
  minimumExperienceYears: z.number().min(0).max(100).nullable(),
  seniorityLevel: z.string().max(100).nullable(),
  managementTrack: z.boolean().nullable(),
  educationRequirements: z.array(z.string().min(1).max(500)).max(100),
  locationConstraints: z.array(z.string().min(1).max(500)).max(100),
  employmentType: z.string().max(100).nullable(),
  compensationText: z.string().max(2_000).nullable(),
  domainKeywords: z.array(z.string().min(1).max(200)).max(500),
  extractionConfidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();

export type JobAnalysisEvidence = z.infer<typeof JobAnalysisEvidenceSchema>;

export const MatchBreakdownSchema = z.object({
  mustHaveSkills: z.number().min(0).max(100).nullable().optional(),
  preferredSkills: z.number().min(0).max(100).nullable().optional(),
  experience: z.number().min(0).max(100).nullable().optional(),
  seniority: z.number().min(0).max(100).nullable().optional(),
  location: z.number().min(0).max(100).nullable().optional(),
  employmentType: z.number().min(0).max(100).nullable().optional(),
  legacy: z.number().min(0).max(100).optional(),
}).strict();

export type MatchBreakdown = z.infer<typeof MatchBreakdownSchema>;

export const MatchEvidenceSchema = z.object({
  reasons: z.array(z.string().max(2_000)).max(500).default([]),
  matchedSkills: z.array(z.string().max(200)).max(500).default([]),
  missingSkills: z.array(z.string().max(200)).max(500).default([]),
  recommendations: z.array(z.string().max(2_000)).max(500).default([]),
  componentEvidence: z.record(
    z.string().min(1).max(100),
    z.array(z.string().max(2_000)).max(100)
  ).default({}),
}).strict();

export type MatchEvidence = z.infer<typeof MatchEvidenceSchema>;

export const ArtifactFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ArtifactVersionSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
export const MatchSourceSchema = z.enum(["legacy", "deterministic", "adjudicated"]);
