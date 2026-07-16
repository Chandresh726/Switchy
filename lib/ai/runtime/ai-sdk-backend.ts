import {
  generateText,
  jsonSchema,
  Output,
  streamText,
  type CallWarning,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";

import type {
  AIGenerationBackend,
  BackendResult,
  BackendStreamingInput,
  BackendStructuredInput,
  BackendTextInput,
} from "@/lib/ai/local-cli/types";

function normalizeUsage(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function normalizeWarnings(warnings?: CallWarning[]): string[] {
  return Array.from(new Set((warnings ?? []).map((warning) => warning.type))).slice(0, 20);
}

export class AISDKGenerationBackend implements AIGenerationBackend {
  constructor(
    private readonly model: LanguageModel,
    private readonly providerOptions?: Record<string, unknown>
  ) {}

  async generateText(input: BackendTextInput): Promise<BackendResult<string>> {
    const result = await generateText({
      model: this.model,
      instructions: input.instructions,
      prompt: input.prompt,
      ...this.providerOptions,
      abortSignal: input.signal,
      timeout: input.timeoutMs,
      maxRetries: 0,
      maxOutputTokens: input.maxOutputTokens,
    });
    return {
      output: result.text,
      usage: normalizeUsage(result.usage),
      finishReason: result.finishReason,
      warningCodes: normalizeWarnings(result.warnings),
    };
  }

  async streamText(input: BackendStreamingInput): Promise<BackendResult<string>> {
    const result = streamText({
      model: this.model,
      instructions: input.instructions,
      prompt: input.prompt,
      ...this.providerOptions,
      abortSignal: input.signal,
      timeout: input.timeoutMs,
      maxRetries: 0,
      maxOutputTokens: input.maxOutputTokens,
    });
    let output = "";
    for await (const delta of result.textStream) {
      output += delta;
      await input.onDelta(delta);
    }
    const [usage, finishReason, warnings] = await Promise.all([
      result.usage,
      result.finishReason,
      result.warnings,
    ]);
    return {
      output,
      usage: normalizeUsage(usage),
      finishReason,
      warningCodes: normalizeWarnings(warnings),
    };
  }

  async generateStructured<T>(
    input: BackendStructuredInput<T>
  ): Promise<BackendResult<T>> {
    const schema = jsonSchema<T>(input.jsonSchema, {
      validate: async (value) => {
        try {
          return { success: true, value: input.validate(value) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error : new Error("Schema validation failed") };
        }
      },
    });
    const result = await generateText({
      model: this.model,
      output: Output.object({ schema }),
      instructions: input.instructions,
      prompt: input.prompt,
      ...this.providerOptions,
      abortSignal: input.signal,
      timeout: input.timeoutMs,
      maxRetries: 0,
      maxOutputTokens: input.maxOutputTokens,
    });
    return {
      output: result.output,
      usage: normalizeUsage(result.usage),
      finishReason: result.finishReason,
      warningCodes: normalizeWarnings(result.warnings),
    };
  }
}
