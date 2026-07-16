import { eq } from "drizzle-orm";
import { z } from "zod";

import { CLI_MODEL_CACHE_TTL_MS } from "@/lib/ai/local-cli/constants";
import type { ProviderModelDefinition } from "@/lib/ai/providers/model-catalog";
import { isReasoningEffort, type LocalCLIProvider } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

const ReasoningEffortSchema = z.string().refine(isReasoningEffort);
const boundedDisplayText = (maxLength: number) =>
  z.string().transform((value) => value.slice(0, maxLength));
const ReasoningOptionSchema = z.object({
  value: ReasoningEffortSchema,
  label: boundedDisplayText(120).optional(),
  description: boundedDisplayText(500).optional(),
}).strict();
const ReasoningControlSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("effort"),
    options: z.array(ReasoningOptionSchema).min(1).max(100),
    defaultValue: ReasoningEffortSchema.optional(),
  }).strict(),
  z.object({ kind: z.literal("provider_default") }).strict(),
]);
const ProviderModelDefinitionSchema = z.object({
  modelId: z.string().min(1).max(240),
  label: boundedDisplayText(240),
  description: boundedDisplayText(2_000),
  supportsReasoning: z.boolean(),
  reasoningControl: ReasoningControlSchema,
  group: boundedDisplayText(240).optional(),
  upstreamProvider: boundedDisplayText(120).optional(),
  supportedReasoningEfforts: z.array(ReasoningEffortSchema).max(100).optional(),
  defaultReasoningEffort: ReasoningEffortSchema.optional(),
  isDefault: z.boolean().optional(),
}).strict().superRefine((model, context) => {
  const efforts = model.supportedReasoningEfforts ?? [];
  const controlEfforts = model.reasoningControl.kind === "effort"
    ? model.reasoningControl.options.map(({ value }) => value)
    : [];
  if (efforts.join("\0") !== controlEfforts.join("\0")) {
    context.addIssue({
      code: "custom",
      message: "Compatibility efforts must match the reasoning control",
      path: ["supportedReasoningEfforts"],
    });
  }
  if (model.reasoningControl.kind === "effort" &&
      model.reasoningControl.defaultValue !== model.defaultReasoningEffort) {
    context.addIssue({
      code: "custom",
      message: "Compatibility default must match the reasoning control",
      path: ["defaultReasoningEffort"],
    });
  }
  if (model.reasoningControl.kind === "provider_default" &&
      (efforts.length > 0 || model.defaultReasoningEffort)) {
    context.addIssue({
      code: "custom",
      message: "Provider-default models cannot advertise effort compatibility fields",
      path: ["reasoningControl"],
    });
  }
});

const StoredCatalogSchema = z.object({
  fetchedAt: z.number().int().nonnegative(),
  models: z.array(ProviderModelDefinitionSchema).max(1_000),
}).strict();

interface StoredLocalCLICatalog {
  fetchedAt: number;
  models: ProviderModelDefinition[];
}

export function validateLocalCLIModelCatalog(
  models: ProviderModelDefinition[]
): ProviderModelDefinition[] {
  return z.array(ProviderModelDefinitionSchema).max(1_000).parse(models);
}

function settingKey(provider: LocalCLIProvider): string {
  return `local_cli_model_catalog:${provider}`;
}

export function createLocalCLICatalogCache(database: typeof db) {
  return {
    async load(
      provider: LocalCLIProvider,
      options: { allowExpired?: boolean } = {}
    ): Promise<StoredLocalCLICatalog | null> {
      const row = await database.select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, settingKey(provider)))
        .limit(1);
      if (!row[0]?.value) return null;

      try {
        const catalog = StoredCatalogSchema.parse(JSON.parse(row[0].value));
        if (!options.allowExpired && catalog.fetchedAt + CLI_MODEL_CACHE_TTL_MS <= Date.now()) {
          return null;
        }
        return catalog;
      } catch {
        return null;
      }
    },

    async save(
      provider: LocalCLIProvider,
      models: ProviderModelDefinition[],
      fetchedAt = Date.now()
    ): Promise<void> {
      const validatedModels = validateLocalCLIModelCatalog(models);
      const value = JSON.stringify(StoredCatalogSchema.parse({
        fetchedAt,
        models: validatedModels,
      }));
      await database.insert(settings).values({
        key: settingKey(provider),
        value,
        updatedAt: new Date(fetchedAt),
      }).onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date(fetchedAt) },
      });
    },

    async delete(provider: LocalCLIProvider): Promise<void> {
      await database.delete(settings).where(eq(settings.key, settingKey(provider)));
    },
  };
}

const localCLICatalogCache = createLocalCLICatalogCache(db);

export const loadStoredLocalCLICatalog = localCLICatalogCache.load;
export const saveStoredLocalCLICatalog = localCLICatalogCache.save;
export const deleteStoredLocalCLICatalog = localCLICatalogCache.delete;
