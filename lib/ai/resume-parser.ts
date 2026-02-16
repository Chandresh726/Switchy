import { generateText, Output } from "ai";
import { z } from "zod";
import { getAIClientV2, getAIGenerationOptions } from "./client";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
      proficiency: z.number().min(1).max(5).optional(),
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
- Estimate proficiency levels (1-5) based on context:
  - 5: Explicitly mentioned as expert, lead, or architect level
  - 4: Senior experience, multiple years mentioned
  - 3: Moderate experience, listed prominently
  - 2: Listed but minimal context
  - 1: Mentioned in passing or learning
- Categorize skills appropriately (frontend, backend, devops, database, cloud, mobile, soft skills, etc.)
- For dates, use YYYY-MM format when possible
- Leave fields empty/null if information is not present
- Be thorough but don't hallucinate information not in the resume`;

export async function parseResume(resumeText: string): Promise<ResumeData> {
  const [modelSetting, reasoningEffortSetting, providerIdSetting] = await Promise.all([
    db.query.settings.findFirst({
      where: eq(settings.key, "resume_parser_model"),
    }),
    db.query.settings.findFirst({
      where: eq(settings.key, "resume_parser_reasoning_effort"),
    }),
    db.query.settings.findFirst({
      where: eq(settings.key, "resume_parser_provider_id"),
    }),
  ]);
  const modelId = modelSetting?.value || "gemini-3-flash-preview";
  const reasoningEffort = reasoningEffortSetting?.value || "medium";
  const providerId = providerIdSetting?.value || undefined;

  const model = await getAIClientV2({ modelId, reasoningEffort: reasoningEffort as "low" | "medium" | "high" | undefined, providerId });
  const providerOptions = await getAIGenerationOptions(modelId, reasoningEffort, providerId);

  const prompt = `Parse the following resume and extract structured information:

---
${resumeText}
---

Extract all relevant information including contact details, skills, work experience, and education.`;

  const result = await generateText({
    model,
    output: Output.object({ schema: ResumeDataSchema }),
    system: RESUME_PARSING_SYSTEM_PROMPT,
    prompt,
    ...providerOptions,
  });

  if (result.output === undefined || result.output === null) {
    throw new Error("Model did not produce structured output for resume parsing");
  }

  return result.output as ResumeData;
}
