import {
  CLI_MODEL_CACHE_TTL_MS,
  CLI_STATUS_CACHE_TTL_MS,
} from "@/lib/ai/local-cli/constants";
import { resolveCLIExecutable } from "@/lib/ai/local-cli/executable";
import type {
  AIGenerationBackend,
  LocalCLIStatus,
} from "@/lib/ai/local-cli/types";
import type { ProviderModelDefinition } from "@/lib/ai/providers/model-catalog";
import type { LocalCLIProvider } from "@/lib/ai/providers/types";
import { AIError } from "@/lib/ai/shared/errors";

import { CodexCLIBackend } from "./codex-backend";
import { OpenCodeCLIBackend } from "./opencode-backend";
import {
  deleteStoredLocalCLICatalog,
  loadStoredLocalCLICatalog,
  saveStoredLocalCLICatalog,
  validateLocalCLIModelCatalog,
} from "./catalog-cache";

interface BackendEntry {
  executable: string;
  backend: CodexCLIBackend | OpenCodeCLIBackend;
}

interface StatusEntry {
  expiresAt: number;
  value: LocalCLIStatus;
}

interface ModelEntry {
  expiresAt: number;
  models: ProviderModelDefinition[];
}

const backendCache = new Map<LocalCLIProvider, BackendEntry>();
const statusCache = new Map<LocalCLIProvider, StatusEntry>();
const modelCache = new Map<LocalCLIProvider, ModelEntry>();
const modelFlights = new Map<string, Promise<ProviderModelDefinition[]>>();

export async function warmLocalCLIStatuses(
  providers: readonly LocalCLIProvider[] = ["codex_cli", "opencode_cli"]
): Promise<void> {
  await Promise.allSettled(
    providers.map((provider) =>
      getLocalCLIStatus(provider, { forceRefresh: true })
    )
  );
}

export function getCachedLocalCLIStatus(
  provider: LocalCLIProvider
): LocalCLIStatus | undefined {
  const cached = statusCache.get(provider);
  return cached && cached.expiresAt > Date.now() ? cached.value : undefined;
}

async function getBackendEntry(provider: LocalCLIProvider): Promise<BackendEntry | null> {
  const executable = await resolveCLIExecutable(provider);
  const cached = backendCache.get(provider);
  if (!executable) {
    cached?.backend.retire();
    backendCache.delete(provider);
    return null;
  }
  if (cached?.executable === executable) return cached;
  cached?.backend.retire();

  const backend = provider === "codex_cli"
    ? new CodexCLIBackend(executable)
    : new OpenCodeCLIBackend(executable);
  const entry = { executable, backend };
  backendCache.set(provider, entry);
  return entry;
}

function status(
  connectionStatus: LocalCLIStatus["status"],
  message: string,
  cliVersion?: string
): LocalCLIStatus {
  return {
    status: connectionStatus,
    selectable: connectionStatus === "ready",
    cliVersion,
    statusMessage: message,
    lastCheckedAt: new Date().toISOString(),
  };
}

export async function getLocalCLIStatus(
  provider: LocalCLIProvider,
  options: { forceRefresh?: boolean } = {}
): Promise<LocalCLIStatus> {
  const cached = statusCache.get(provider);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let value: LocalCLIStatus;
  const entry = await getBackendEntry(provider);
  if (!entry) {
    value = status("not_installed", `${provider === "codex_cli" ? "Codex" : "OpenCode"} CLI was not found.`);
  } else {
    try {
      const version = await entry.backend.getVersion();
      if (provider === "codex_cli") {
        const account = await (entry.backend as CodexCLIBackend).readAccount();
        if (!account.authenticated) {
          value = status("not_authenticated", "Codex CLI is installed but not logged in.", version);
        } else {
          const models = await getLocalCLIModels(provider, {
            forceRefresh: options.forceRefresh,
          });
          value = models.length > 0
            ? status("ready", `${models.length} text models available.`, version)
            : status("no_models", "Codex CLI did not advertise any usable text models.", version);
        }
      } else {
        const models = await getLocalCLIModels(provider, {
          forceRefresh: options.forceRefresh,
        });
        if (models.length > 0) {
          value = status("ready", `${models.length} text models available.`, version);
        } else if ((entry.backend as OpenCodeCLIBackend).hasAuthenticatedProviders()) {
          value = status("no_models", "OpenCode providers are authenticated but expose no usable text models.", version);
        } else {
          value = status("not_authenticated", "OpenCode has no authenticated providers.", version);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("unauthorized") || message.includes("auth")) {
        value = status("not_authenticated", "The CLI is installed but its authentication is unavailable.");
      } else if (message.includes("method") || message.includes("protocol")) {
        value = status("incompatible", "The installed CLI does not support the required integration protocol.");
      } else {
        value = status("error", "Switchy could not connect to the local CLI.");
      }
    }
  }

  statusCache.set(provider, {
    value,
    expiresAt: Date.now() + CLI_STATUS_CACHE_TTL_MS,
  });
  return value;
}

export async function getLocalCLIModels(
  provider: LocalCLIProvider,
  options: { forceRefresh?: boolean; expectedModelId?: string } = {}
): Promise<ProviderModelDefinition[]> {
  const cached = modelCache.get(provider);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }
  if (!options.forceRefresh) {
    const stored = await loadStoredLocalCLICatalog(provider);
    if (stored) {
      modelCache.set(provider, {
        models: stored.models,
        expiresAt: stored.fetchedAt + CLI_MODEL_CACHE_TTL_MS,
      });
      return stored.models;
    }
  }
  const flightKey = `${provider}:${options.expectedModelId ?? ""}`;
  const existingFlight = modelFlights.get(flightKey);
  if (existingFlight) return existingFlight;

  const flight = (async () => {
    const entry = await getBackendEntry(provider);
    if (!entry) return [];
    const discoveredModels = provider === "opencode_cli"
      ? await (entry.backend as OpenCodeCLIBackend).listModels({
        expectedModelId: options.expectedModelId,
      })
      : await entry.backend.listModels();
    const models = validateLocalCLIModelCatalog(discoveredModels);
    modelCache.set(provider, {
      models,
      expiresAt: Date.now() + CLI_MODEL_CACHE_TTL_MS,
    });
    await saveStoredLocalCLICatalog(provider, models);
    return models;
  })();
  modelFlights.set(flightKey, flight);
  try {
    return await flight;
  } finally {
    if (modelFlights.get(flightKey) === flight) modelFlights.delete(flightKey);
  }
}

async function refreshLocalCLIModelForExecution(
  provider: LocalCLIProvider,
  modelId: string
): Promise<{ refreshed: boolean; model?: ProviderModelDefinition }> {
  // Background workers (e.g. post-scrape auto-match) may run with a stale or
  // empty model catalog — for example after a restart dropped the in-memory
  // cache while the durable catalog predates the configured model. Attempt a
  // single live refresh so execution self-heals instead of failing or running
  // on obsolete capability metadata until someone manually refreshes in
  // Settings. The refresh also persists the catalog for future runs.
  // A failed refresh reports refreshed: false so the caller can fall back to
  // its cached entry; a successful refresh is authoritative, so a model that
  // is absent from it resolves to no model (invalid_model) rather than a
  // stale entry for something the CLI no longer exposes.
  try {
    const liveModels = await getLocalCLIModels(provider, {
      forceRefresh: true,
      expectedModelId: modelId,
    });
    const filtered = liveModels.find((model) => model.modelId === modelId);
    if (filtered) return { refreshed: true, model: filtered };
    return {
      refreshed: true,
      model: modelCache.get(provider)?.models.find((model) => model.modelId === modelId),
    };
  } catch {
    return { refreshed: false };
  }
}

export async function getLocalCLIExecutionTarget(
  provider: LocalCLIProvider,
  modelId: string
): Promise<{
  backend: AIGenerationBackend;
  cliVersion?: string;
  upstreamProvider?: string;
  reasoningControl: ProviderModelDefinition["reasoningControl"];
}> {
  const entry = await getBackendEntry(provider);
  if (!entry) {
    throw new AIError({
      type: "provider_not_found",
      message: "The configured local CLI executable is unavailable",
    });
  }
  const memoryEntry = modelCache.get(provider);
  const storedCatalog = memoryEntry
    ? null
    : await loadStoredLocalCLICatalog(provider, { allowExpired: true });
  const cachedModels = memoryEntry?.models ?? storedCatalog?.models;
  const catalogIsFresh = memoryEntry
    ? memoryEntry.expiresAt > Date.now()
    : storedCatalog !== null
      && storedCatalog.fetchedAt + CLI_MODEL_CACHE_TTL_MS > Date.now();
  let selectedModel = cachedModels?.find((model) => model.modelId === modelId);
  if (!selectedModel || !catalogIsFresh) {
    const refresh = await refreshLocalCLIModelForExecution(provider, modelId);
    if (refresh.refreshed) selectedModel = refresh.model;
  }
  if (!selectedModel) {
    throw new AIError({
      type: "invalid_model",
      message: "The configured local CLI model has no cached capability metadata; refresh models in Settings",
      retryable: false,
    });
  }
  entry.backend.setModelReasoningEfforts(
    modelId,
    selectedModel.supportedReasoningEfforts ?? []
  );
  return {
    backend: entry.backend,
    cliVersion: await entry.backend.getVersion(),
    upstreamProvider: provider === "opencode_cli"
      ? modelId.split("/", 1)[0] || undefined
      : undefined,
    reasoningControl: selectedModel.reasoningControl,
  };
}

export function clearLocalCLICaches(provider?: LocalCLIProvider): void {
  if (provider) {
    statusCache.delete(provider);
    modelCache.delete(provider);
    return;
  }
  statusCache.clear();
  modelCache.clear();
}

export async function retireLocalCLIProvider(provider: LocalCLIProvider): Promise<void> {
  const flights = Array.from(modelFlights.entries())
    .filter(([key]) => key.startsWith(`${provider}:`));
  await Promise.all(flights.map(([, flight]) => flight.catch(() => undefined)));
  backendCache.get(provider)?.backend.retire();
  backendCache.delete(provider);
  statusCache.delete(provider);
  modelCache.delete(provider);
  for (const [key] of flights) modelFlights.delete(key);
}

export async function resetLocalCLIProvider(provider: LocalCLIProvider): Promise<void> {
  await retireLocalCLIProvider(provider);
  await deleteStoredLocalCLICatalog(provider);
}

export function shutdownLocalCLIBackends(): void {
  for (const entry of backendCache.values()) entry.backend.retire();
  backendCache.clear();
}
