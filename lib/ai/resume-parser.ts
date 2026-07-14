import { z } from "zod";

import {
  createAICapabilityRuntime,
  fingerprintAIInput,
} from "./runtime";

const ResumeDataSchema = z.object({
  name: z.string(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  githubUrl: z.string().nullable().optional(),
  portfolioUrl: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  skills: z.array(
    z.object({
      name: z.string(),
      category: z.string().optional(),
    })
  ),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().nullable().optional(),
      startDate: z.string(),
      endDate: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      highlights: z.array(z.string()).optional(),
    })
  ),
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: z.string(),
        field: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        gpa: z.string().nullable().optional(),
        honors: z.string().nullable().optional(),
      })
    )
    .optional(),
});

export type ResumeData = z.infer<typeof ResumeDataSchema>;

const RESUME_PARSING_SYSTEM_PROMPT = `You are an expert resume parser. Your job is to extract structured information from resume text.

Guidelines:
- Extract all relevant information accurately
- For skills, identify both technical skills (programming languages, frameworks, tools) and soft skills
- Categorize skills appropriately (frontend, backend, devops, database, cloud, mobile, soft skills, etc.)
- For dates, use YYYY-MM format when possible
- Leave fields empty/null if information is not present
- Be thorough but don't hallucinate information not in the resume`;

const RESUME_PROMPT_VERSION = "legacy-resume-parse-v1";
const RESUME_SCHEMA_VERSION = "resume-data-v1";
const RESUME_POLICY_VERSION = "resume-parse-policy-v1";

export async function parseResume(resumeText: string): Promise<ResumeData> {
  const runtime = await createAICapabilityRuntime({ capability: "resume_parse" });
  const prompt = `Parse the following resume and extract structured information:

---
${resumeText}
---

Extract all relevant information including contact details, skills, work experience, and education.`;

  const result = await runtime.executeStructured({
    schema: ResumeDataSchema,
    instructions: RESUME_PARSING_SYSTEM_PROMPT,
    prompt,
    policy: {
      maxAttempts: 2,
      timeoutMs: 60_000,
      reasoningEffort: runtime.reasoningEffort,
    },
    subject: { type: "resume", id: fingerprintAIInput(resumeText).slice(0, 24) },
    versions: {
      prompt: RESUME_PROMPT_VERSION,
      schema: RESUME_SCHEMA_VERSION,
      policy: RESUME_POLICY_VERSION,
    },
    inputFingerprint: fingerprintAIInput({
      resumeText,
      promptVersion: RESUME_PROMPT_VERSION,
    }),
  });

  return result.output;
}
