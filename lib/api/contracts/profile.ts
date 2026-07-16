import { z } from "zod";

import { ResumeDataSchema, ResumeValidationWarningsSchema } from "@/lib/ai/resume/contracts";

import { positiveIntegerIdSchema } from "./common";

export const profileIdQuerySchema = z.object({ profileId: positiveIntegerIdSchema });
export const childIdQuerySchema = z.object({ id: positiveIntegerIdSchema });
export const resumeUploadFormSchema = z.object({
  file: z.custom<File>(
    (value) => typeof File !== "undefined" && value instanceof File,
    "file must be an uploaded file"
  ),
  autofill: z.enum(["true", "false"]).default("true")
    .transform((value) => value === "true"),
});

export const skillCreateBodySchema = z.object({
  profileId: positiveIntegerIdSchema,
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(200).nullable().optional(),
});

export const profileWriteBodySchema = z.object({
  name: z.string().trim().min(1).max(300),
  email: z.string().trim().email().max(320).nullable().optional().or(z.literal("")),
  phone: z.string().max(100).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  preferredCountry: z.string().max(200).nullable().optional(),
  preferredCity: z.string().max(200).nullable().optional(),
  linkedinUrl: z.string().url().max(2_000).nullable().optional().or(z.literal("")),
  githubUrl: z.string().url().max(2_000).nullable().optional().or(z.literal("")),
  portfolioUrl: z.string().url().max(2_000).nullable().optional().or(z.literal("")),
  resumePath: z.string().max(2_000).nullable().optional(),
  summary: z.string().max(20_000).nullable().optional(),
});

const highlightsSchema = z.array(z.string().max(2_000)).max(200).optional().nullable();
export const experienceWriteBodySchema = z.object({
  id: positiveIntegerIdSchema.optional(),
  profileId: positiveIntegerIdSchema.optional(),
  company: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  location: z.string().max(500).nullable().optional(),
  startDate: z.string().trim().min(1).max(100),
  endDate: z.string().max(100).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  highlights: highlightsSchema,
});

export const educationWriteBodySchema = z.object({
  id: positiveIntegerIdSchema.optional(),
  profileId: positiveIntegerIdSchema.optional(),
  institution: z.string().trim().min(1).max(300),
  degree: z.string().trim().min(1).max(300),
  field: z.string().max(300).nullable().optional(),
  startDate: z.string().trim().min(1).max(100),
  endDate: z.string().max(100).nullable().optional(),
  gpa: z.string().max(100).nullable().optional(),
  honors: z.string().max(2_000).nullable().optional(),
});

export const skillSchema = z.object({
  id: z.number().int().positive(),
  profileId: z.number().int().positive().nullable(),
  name: z.string(),
  category: z.string().nullable(),
});
export const experienceSchema = z.object({
  id: z.number().int().positive(),
  profileId: z.number().int().positive().nullable(),
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  description: z.string().nullable(),
  highlights: z.string().nullable(),
});
export const educationSchema = z.object({
  id: z.number().int().positive(),
  profileId: z.number().int().positive().nullable(),
  institution: z.string(),
  degree: z.string(),
  field: z.string().nullable(),
  startDate: z.string().nullable().transform((value) => value ?? ""),
  endDate: z.string().nullable(),
  gpa: z.string().nullable(),
  honors: z.string().nullable(),
});
export const resumeResponseSchema = z.object({
  id: z.number().int().positive(),
  profileId: z.number().int().positive().nullable(),
  fileName: z.string(),
  filePath: z.string(),
  parsedData: z.string(),
  aiRunId: z.string().nullable(),
  parserVersion: z.string().nullable(),
  validationWarnings: z.string().nullable(),
  version: z.number().int().positive(),
  isCurrent: z.boolean(),
  createdAt: z.string().nullable().transform((value) => value ?? ""),
});
export const profileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  preferredCountry: z.string().nullable(),
  preferredCity: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  resumePath: z.string().nullable(),
  summary: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export const profileResponseSchema = z.union([
  profileSchema.extend({
    skills: z.array(skillSchema),
    experience: z.array(experienceSchema),
    education: z.array(educationSchema),
    resumes: z.array(resumeResponseSchema),
  }),
  z.null(),
]);
export const resumesResponseSchema = z.array(resumeResponseSchema);
export const skillsResponseSchema = z.array(skillSchema);
export const experienceResponseSchema = z.array(experienceSchema);
export const educationResponseSchema = z.array(educationSchema);
export const resumeUploadResponseSchema = z.object({
  parsedData: ResumeDataSchema.nullable(),
  resumeRecord: resumeResponseSchema,
  aiRunId: z.string().nullable(),
  parserVersion: z.string().nullable(),
  warnings: ResumeValidationWarningsSchema,
});
