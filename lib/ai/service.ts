import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { getDefaultProvider, getProviderById } from "./client";
import { resolveAIContextForFeature, type AIFeature } from "./runtime-context";
import { AIError } from "./shared/errors";
import type { ReasoningEffort } from "./providers/types";

export interface AIServiceConfig {
  feature: AIFeature;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  providerId?: string;
}

export interface StructuredGenerationOptions<T extends z.ZodTypeAny> {
  schema: T;
  system: string;
  prompt: string;
}

export interface TextGenerationOptions {
  system: string;
  prompt: string;
}

export class AIService {
  private model: LanguageModel | null = null;
  private providerOptions: Record<string, unknown> | undefined;
  private config: AIServiceConfig;

  private constructor(config: AIServiceConfig) {
    this.config = config;
  }

  static async create(config: AIServiceConfig): Promise<AIService> {
    const service = new AIService(config);
    await service.initialize();
    return service;
  }

  private async initialize(): Promise<void> {
    const context = await resolveAIContextForFeature(this.config.feature, {
      providerId: this.config.providerId,
      modelId: this.config.modelId,
      reasoningEffort: this.config.reasoningEffort,
    });

    this.model = context.model;
    this.providerOptions = context.providerOptions;
  }

  getClient(): LanguageModel {
    if (!this.model) {
      throw new AIError({
        type: "generation_failed",
        message: "AIService not initialized. Call initialize() first or use AIService.create()",
      });
    }
    return this.model;
  }

  getProviderOptions(): Record<string, unknown> | undefined {
    return this.providerOptions;
  }

  async generateStructured<T extends z.ZodTypeAny>(
    options: StructuredGenerationOptions<T>
  ): Promise<z.infer<T>> {
    const model = this.getClient();
    const output = options.schema instanceof z.ZodArray
      ? Output.array({ element: options.schema.element })
      : Output.object({ schema: options.schema });

    const result = await generateText({
      model,
      output,
      system: options.system,
      prompt: options.prompt,
      ...this.providerOptions,
    });

    if (result.output === undefined || result.output === null) {
      throw new AIError({
        type: "no_object",
        message: "Model did not produce structured output",
      });
    }

    return result.output as z.infer<T>;
  }

  async generateText(options: TextGenerationOptions): Promise<string> {
    const model = this.getClient();

    const result = await generateText({
      model,
      system: options.system,
      prompt: options.prompt,
      ...this.providerOptions,
    });

    return result.text;
  }
}

export async function createMatcherService(options?: {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  providerId?: string;
}): Promise<AIService> {
  return AIService.create({
    feature: "matcher",
    ...options,
  });
}

export async function createWritingService(options?: {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  providerId?: string;
}): Promise<AIService> {
  return AIService.create({
    feature: "writing",
    ...options,
  });
}

export async function createResumeParserService(options?: {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  providerId?: string;
}): Promise<AIService> {
  return AIService.create({
    feature: "resume_parser",
    ...options,
  });
}

export async function getDefaultProviderId(): Promise<string | null> {
  const provider = await getDefaultProvider();
  return provider?.id ?? null;
}

export async function getProviderTypeById(providerId: string): Promise<string | null> {
  const provider = await getProviderById(providerId);
  return provider?.provider ?? null;
}
