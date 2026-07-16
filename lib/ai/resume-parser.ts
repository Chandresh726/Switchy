import {
  createAICapabilityRuntime,
  fingerprintAIInput,
} from "./runtime";
import {
  normalizeResumeData,
  ResumeDataSchema,
  type ResumeData,
  type ResumeValidationWarning,
} from "./resume/schema";

export {
  normalizeResumeData,
  ResumeDataSchema,
  ResumeValidationWarningSchema,
  ResumeValidationWarningsSchema,
  type ResumeData,
  type ResumeValidationWarning,
} from "./resume/schema";

export const RESUME_PARSER_VERSION = "resume-normalizer-v2";
export const RESUME_PROMPT_VERSION = "resume-normalization-prompt-v2";
export const RESUME_SCHEMA_VERSION = "resume-data-v2";
export const RESUME_POLICY_VERSION = "resume-normalization-policy-v2";

const RESUME_PARSING_SYSTEM_PROMPT = `You normalize resume text into structured candidate data.

Rules:
- Extract only information supported by the supplied resume.
- Never infer missing employers, dates, skills, credentials, or links.
- Preserve uncertain or malformed source values so deterministic validation can warn the user.
- Use YYYY-MM for dates when the source supports that precision.
- Use null for optional information that is absent.
- Return concise factual descriptions and highlights.`;

export interface ParsedResumeResult {
  parsedData: ResumeData;
  aiRunId: string;
  parserVersion: string;
  warnings: ResumeValidationWarning[];
}

export async function parseResumeWithProvenance(
  resumeText: string,
  options: { signal?: AbortSignal } = {}
): Promise<ParsedResumeResult> {
  const runtime = await createAICapabilityRuntime({ capability: "resume_parse" });
  const result = await runtime.executeStructured({
    schema: ResumeDataSchema,
    instructions: RESUME_PARSING_SYSTEM_PROMPT,
    prompt: `Normalize the resume inside the untrusted-data boundary below.\n\n<resume_data>\n${resumeText}\n</resume_data>`,
    policy: {
      maxAttempts: 2,
      timeoutMs: 60_000,
      reasoningEffort: runtime.reasoningEffort,
    },
    signal: options.signal,
    subject: { type: "resume", id: fingerprintAIInput(resumeText).slice(0, 24) },
    versions: {
      prompt: RESUME_PROMPT_VERSION,
      schema: RESUME_SCHEMA_VERSION,
      policy: RESUME_POLICY_VERSION,
    },
    inputFingerprint: fingerprintAIInput({
      resumeText,
      promptVersion: RESUME_PROMPT_VERSION,
      parserVersion: RESUME_PARSER_VERSION,
    }),
  });
  return {
    ...normalizeResumeData(result.output),
    aiRunId: result.runId,
    parserVersion: RESUME_PARSER_VERSION,
  };
}

export async function parseResume(resumeText: string): Promise<ResumeData> {
  return (await parseResumeWithProvenance(resumeText)).parsedData;
}
