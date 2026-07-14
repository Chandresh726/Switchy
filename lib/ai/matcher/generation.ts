import { z } from "zod";

import type { AICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";
import { fingerprintAIInput } from "@/lib/ai/runtime/fingerprint";
import type { AIExecutionPolicy } from "@/lib/ai/runtime/types";

export interface GenerationOptions<T extends z.ZodTypeAny> {
  runtime: AICapabilityRuntime;
  schema: T;
  instructions: string;
  prompt: string;
  policy: AIExecutionPolicy;
  subject: { type: string; id: string };
  promptVersion: string;
  schemaVersion: string;
  policyVersion: string;
  retry?: {
    baseDelayMs: number;
    maxDelayMs: number;
  };
  signal?: AbortSignal;
}

export interface GenerationResult<T> {
  data: T;
  runId: string;
  attempts: number;
}

export async function generateStructured<T extends z.ZodTypeAny>(
  options: GenerationOptions<T>
): Promise<GenerationResult<z.infer<T>>> {
  const result = await options.runtime.executeStructured({
    schema: options.schema,
    instructions: options.instructions,
    prompt: options.prompt,
    policy: options.policy,
    subject: options.subject,
    versions: {
      prompt: options.promptVersion,
      schema: options.schemaVersion,
      policy: options.policyVersion,
    },
    inputFingerprint: fingerprintAIInput({
      instructions: options.instructions,
      prompt: options.prompt,
      schemaVersion: options.schemaVersion,
    }),
    signal: options.signal,
    retry: options.retry,
  });

  return {
    data: result.output,
    runId: result.runId,
    attempts: result.attempts,
  };
}
