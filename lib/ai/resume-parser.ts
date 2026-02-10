import { generateText } from "ai";
import { z } from "zod";
import { getAIClient } from "./client";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const ResumeDataSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedinUrl: z.string().optional(),
  githubUrl: z.string().optional(),
  portfolioUrl: z.string().optional(),
  summary: z.string().optional(),
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
      location: z.string().optional(),
      startDate: z.string(),
      endDate: z.string().optional(),
      description: z.string().optional(),
      highlights: z.array(z.string()).optional(),
    })
  ),
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: z.string(),
        field: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        gpa: z.string().optional(),
        honors: z.string().optional(),
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

const JSON_FORMAT_INSTRUCTIONS = `

IMPORTANT: You must respond with ONLY a valid JSON object in the following format, no other text:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "+1234567890",
  "location": "City, State",
  "linkedinUrl": "https://linkedin.com/in/...",
  "githubUrl": "https://github.com/...",
  "portfolioUrl": "https://...",
  "summary": "Professional summary...",
  "skills": [
    {"name": "JavaScript", "category": "frontend", "proficiency": 4},
    ...
  ],
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "location": "City, State",
      "startDate": "2020-01",
      "endDate": "2023-06",
      "description": "Job description",
      "highlights": ["Achievement 1", "Achievement 2"]
    },
    ...
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Bachelor's",
      "field": "Computer Science",
      "startDate": "2016-09",
      "endDate": "2020-05",
      "gpa": "3.8",
      "honors": "Cum Laude"
    },
    ...
  ]
}`;

function extractJSON(text: string): unknown {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No valid JSON found in response");
}

export async function parseResume(resumeText: string): Promise<ResumeData> {
  // Fetch configured model from settings or default to gemini-3-flash-preview
  const modelSetting = await db.query.settings.findFirst({
    where: eq(settings.key, "resume_parser_model"),
  });
  const modelId = modelSetting?.value || "gemini-3-flash-preview";
  const model = await getAIClient(modelId);

  const { text } = await generateText({
    model,
    system: RESUME_PARSING_SYSTEM_PROMPT,
    prompt: `Parse the following resume and extract structured information:

---
${resumeText}
---

Extract all relevant information including contact details, skills, work experience, and education.${JSON_FORMAT_INSTRUCTIONS}`,
  });

  // Parse and validate the JSON response
  const parsed = extractJSON(text);
  const result = ResumeDataSchema.parse(parsed);

  return result;
}
