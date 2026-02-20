import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { getAIClientV2, getAIGenerationOptions, getDefaultProvider, getProviderById } from "./client";
import { resolveProviderModelSelection } from "./providers/model-catalog";
import { AIError } from "./shared/errors";
import type { ReasoningEffort } from "./providers/types";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export type AIFeature = "matcher" | "writing" | "resume_parser";

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
    let modelId = this.config.modelId;
    let reasoningEffort = this.config.reasoningEffort;
    let providerId = this.config.providerId;

    const featureSettings = await this.getFeatureSettings();
    modelId = modelId ?? featureSettings.modelId;
    reasoningEffort = reasoningEffort ?? featureSettings.reasoningEffort;
    providerId = providerId ?? featureSettings.providerId;

    const resolvedSelection = await resolveProviderModelSelection({
      providerId,
      modelId,
    });

    modelId = resolvedSelection.modelId;
    providerId = resolvedSelection.providerId;

    this.model = await getAIClientV2({
      modelId,
      reasoningEffort,
      providerId,
    });

    this.providerOptions = await getAIGenerationOptions(modelId, reasoningEffort, providerId);
  }

  private async getFeatureSettings(): Promise<{
    modelId?: string;
    reasoningEffort: ReasoningEffort;
    providerId?: string;
  }> {
    const settingKeys = {
      matcher: {
        model: "matcher_model",
        reasoning: "matcher_reasoning_effort",
        provider: "matcher_provider_id",
      },
      writing: {
        model: "ai_writing_model",
        reasoning: "ai_writing_reasoning_effort",
        provider: "ai_writing_provider_id",
      },
      resume_parser: {
        model: "resume_parser_model",
        reasoning: "resume_parser_reasoning_effort",
        provider: "resume_parser_provider_id",
      },
    };

    const keys = settingKeys[this.config.feature];
    const keysList = [keys.model, keys.reasoning, keys.provider];

    const settingsResults = await db
      .select()
      .from(settings)
      .where(inArray(settings.key, keysList));

    const settingsMap = new Map(settingsResults.map((s) => [s.key, s.value]));

    return {
      modelId: settingsMap.get(keys.model) ?? undefined,
      reasoningEffort: (settingsMap.get(keys.reasoning) as ReasoningEffort) ?? "medium",
      providerId: settingsMap.get(keys.provider) ?? undefined,
    };
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
    const schema = options.schema;
    
    const isArray = "element" in schema && typeof (schema as Record<string, unknown>).element === "object";
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let output: any;
    
    if (isArray) {
      output = Output.array({ element: (schema as unknown as z.ZodArray<z.ZodTypeAny>).element });
    } else {
      output = Output.object({ schema });
    }

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
