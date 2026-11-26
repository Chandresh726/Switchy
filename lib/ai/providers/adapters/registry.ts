import type { AIGenerationBackend } from "@/lib/ai/runtime/backend";
import { AISDKGenerationBackend } from "@/lib/ai/runtime/ai-sdk-backend";
import type { ResolvedModelSnapshot } from "@/lib/ai/runtime/types";
import { getLocalCLIExecutionTarget } from "@/lib/ai/local-cli/service";
import { AIError } from "@/lib/ai/shared/errors";

import { getCachedProviderModelDefinition } from "../catalog/service";
import type { ResolvedProviderCatalogRecord } from "../catalog/types";
import { providerRegistry } from "../index";
import { getAllProviderMetadata } from "../metadata";
import type { ProviderReasoningControl } from "../reasoning-controls";
import { isLocalCLIProvider, type ModelConfig, type AIProvider } from "../types";

interface BackendTarget {
  backend: AIGenerationBackend;
  backendKind: ResolvedModelSnapshot["backendKind"];
  reasoningEffort?: string;
  cliVersion?: string;
  upstreamProvider?: string;
}

interface ProviderAdapter {
  resolveBackend(record: ResolvedProviderCatalogRecord, modelId: string, reasoningEffort?: string): Promise<BackendTarget>;
}

function resolveAdvertisedReasoningEffort(
  requested: string | undefined,
  control: ProviderReasoningControl | undefined,
  modelId: string
): string | undefined {
  if (!requested) {
    return undefined;
  }
  if (!control) {
    throw new AIError({
      type: "reasoning_not_supported",
      message: `Reasoning capabilities are unavailable for model "${modelId}"; refresh models before using the configured value`,
      retryable: false,
    });
  }
  if (control.kind === "provider_default") return undefined;
  if (!control.options.some(({ value }) => value === requested)) {
    throw new AIError({
      type: "reasoning_not_supported",
      message: `Configured reasoning effort "${requested}" is unavailable for model "${modelId}"; refresh models and choose an advertised value`,
      retryable: false,
    });
  }
  return requested;
}

const cliAdapter: ProviderAdapter = {
  async resolveBackend(record, modelId, requestedEffort) {
    if (!isLocalCLIProvider(record.provider)) throw new AIError({ type: "provider_not_found", message: "Not a CLI provider" });
    const target = await getLocalCLIExecutionTarget(record.provider, modelId);
    return {
      ...target,
      backendKind: record.provider,
      reasoningEffort: resolveAdvertisedReasoningEffort(requestedEffort, target.reasoningControl, modelId),
    };
  },
};

const sdkAdapter: ProviderAdapter = {
  async resolveBackend(record, modelId, requestedEffort) {
    const provider = providerRegistry.get(record.provider);
    if (!provider) throw new AIError({ type: "provider_not_found", message: `Provider "${record.provider}" is not registered` });
    if (provider.requiresApiKey && !record.apiKey) throw new AIError({ type: "missing_api_key", message: `API key is required for provider "${record.provider}"` });
    const cached = await getCachedProviderModelDefinition(record.id, modelId);
    const reasoningEffort = resolveAdvertisedReasoningEffort(requestedEffort, cached?.reasoningControl, modelId);
    const config: ModelConfig = { modelId, ...(reasoningEffort ? { reasoningEffort } : {}) };
    const providerConfig = record.customConnection ? {
      apiKey: record.customConnection.apiKey,
      baseUrl: record.customConnection.baseUrl,
      apiFormat: record.customConnection.apiFormat,
      headers: record.customConnection.headers,
    } : { apiKey: record.apiKey };
    const model = provider.createModel({ config, providerConfig });
    return {
      backend: new AISDKGenerationBackend(model, provider.getGenerationOptions(config, providerConfig)),
      backendKind: "ai_sdk",
      reasoningEffort,
    };
  },
};

// Metadata stays browser-safe; adapters contain server-only connection behavior.
const adapters = new Map<AIProvider, ProviderAdapter>(
  getAllProviderMetadata().map(({ id, kind }) => [id, kind === "local_cli" ? cliAdapter : sdkAdapter])
);

export async function resolveProviderBackend(record: ResolvedProviderCatalogRecord, modelId: string, reasoningEffort?: string): Promise<BackendTarget> {
  const adapter = adapters.get(record.provider);
  if (!adapter) throw new AIError({ type: "provider_not_found", message: "Provider adapter is unavailable" });
  return adapter.resolveBackend(record, modelId, reasoningEffort);
}
