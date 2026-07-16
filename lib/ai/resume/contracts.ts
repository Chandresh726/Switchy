import { z } from "zod";

const OPTIONAL_TEXT = z.string().max(10_000).nullable().optional();

export const ResumeDataSchema = z.object({
  name: z.string().max(300),
  email: z.string().max(500).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  linkedinUrl: z.string().max(2_000).nullable().optional(),
  githubUrl: z.string().max(2_000).nullable().optional(),
  portfolioUrl: z.string().max(2_000).nullable().optional(),
  summary: OPTIONAL_TEXT,
  skills: z.array(z.object({
    name: z.string().max(300),
    category: z.string().max(300).optional(),
  })).max(500),
  experience: z.array(z.object({
    company: z.string().max(500),
    title: z.string().max(500),
    location: z.string().max(500).nullable().optional(),
    startDate: z.string().max(100),
    endDate: z.string().max(100).nullable().optional(),
    description: OPTIONAL_TEXT,
    highlights: z.array(z.string().max(2_000)).max(100).optional(),
  })).max(100),
  education: z.array(z.object({
    institution: z.string().max(500),
    degree: z.string().max(500),
    field: z.string().max(500).nullable().optional(),
    startDate: z.string().max(100).nullable().optional(),
    endDate: z.string().max(100).nullable().optional(),
    gpa: z.string().max(100).nullable().optional(),
    honors: z.string().max(1_000).nullable().optional(),
  })).max(100).optional(),
});

export const ResumeValidationWarningSchema = z.object({
  code: z.enum([
    "duplicate_skill",
    "empty_required_field",
    "malformed_date",
    "suspicious_url",
  ]),
  path: z.string().min(1).max(500),
  message: z.string().min(1).max(1_000),
});

export const ResumeValidationWarningsSchema = z.array(ResumeValidationWarningSchema).max(1_000);

export type ResumeData = z.infer<typeof ResumeDataSchema>;
export type ResumeValidationWarning = z.infer<typeof ResumeValidationWarningSchema>;
