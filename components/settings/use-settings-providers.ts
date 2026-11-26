"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  isLocalCLIProvider,
  type LocalCLIProvider
} from "@/lib/ai/providers/types";
import {
  checkProviderConnection,
  createProvider,
  deleteProvider,
  getLocalCLIStatus,
  getProviderModels,
  getProviders,
  updateProvider,
  updateProviderApiKey,
} from "@/lib/api/clients/providers";
import { patchSettings } from "@/lib/api/clients/settings";
import type {
  ProviderCreateBody,
  ProviderPatchBody,
} from "@/lib/api/contracts/providers";
import type {
  ProviderModelsResponse,
  ProviderSettingsListItem
} from "@/lib/api/contracts/settings";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import type {
  ProviderModelsState
} from "@/lib/settings/types";

const PROVIDER_MODELS_STALE_TIME_MS = 15 * 60 * 1000;
const LOCAL_CLI_STATUS_STALE_TIME_MS = 30_000;

export function useSettingsProviders() {
  const queryClient = useQueryClient();
  const fetchProviderModels = async (
    providerId: string,
    forceRefresh = false
  ): Promise<ProviderModelsResponse> => {
    return getProviderModels(providerId, forceRefresh ? { refresh: "1" } : {});
  };

  const providersQuery = useQuery<ProviderSettingsListItem[]>({
    queryKey: queryKeys.providers.list(),
    queryFn: getProviders,
  });
  const providerRecords = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
  const localCLIProviders = useMemo(
    () => providerRecords.filter(
      (provider): provider is ProviderSettingsListItem & {
        kind: "local_cli";
        provider: LocalCLIProvider;
      } => provider.kind === "local_cli" && isLocalCLIProvider(provider.provider)
    ),
    [providerRecords]
  );
  const localCLIStatusQueries = useQueries({
    queries: localCLIProviders.map((provider) => ({
      queryKey: queryKeys.providers.status(provider.id),
      queryFn: () => getLocalCLIStatus(provider.provider),
      initialData: provider.connectionStatus && provider.lastCheckedAt ? {
        status: provider.connectionStatus,
        selectable: provider.selectable,
        cliVersion: provider.cliVersion,
        statusMessage: provider.statusMessage ?? "Saved connection",
        lastCheckedAt: provider.lastCheckedAt,
        isStale: provider.statusIsStale,
      } : undefined,
      initialDataUpdatedAt: provider.lastCheckedAt ? Date.parse(provider.lastCheckedAt) : undefined,
      staleTime: LOCAL_CLI_STATUS_STALE_TIME_MS,
      retry: 1,
    })),
  });
  const providers = useMemo(() => {
    const statusQueriesByProviderId = new Map(
      localCLIProviders.map((provider, index) => [
        provider.id,
        localCLIStatusQueries[index],
      ])
    );

    return providerRecords.map((provider) => {
      if (provider.kind !== "local_cli") return provider;

      const statusQuery = statusQueriesByProviderId.get(provider.id);
      const connection = statusQuery?.data;
      if (connection) {
        return {
          ...provider,
          connectionStatus: connection.status,
          selectable: connection.selectable,
          cliVersion: connection.cliVersion,
          statusMessage: connection.statusMessage,
          lastCheckedAt: connection.lastCheckedAt,
          statusIsStale: connection.isStale,
          checking: statusQuery?.isFetching,
        };
      }
      if (statusQuery?.isError) {
        return {
          ...provider,
          connectionStatus: "error" as const,
          selectable: false,
          statusMessage: getApiErrorMessage(statusQuery.error, "Failed to check local CLI"),
        };
      }
      return { ...provider, checking: statusQuery?.isFetching };
    });
  }, [localCLIProviders, localCLIStatusQueries, providerRecords]);

  const providerModelsQueries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: queryKeys.providers.model(provider.id),
      queryFn: async () => fetchProviderModels(provider.id),
      enabled: Boolean(provider.id) && provider.isActive,
      staleTime: PROVIDER_MODELS_STALE_TIME_MS,
      retry: 1,
    })),
  });

  const attemptedCatalogRefreshes = useRef(new Set<string>());
  const observedCatalogs = useRef(new Set<string>());
  useEffect(() => {
    providers.forEach((provider, index) => {
      const catalog = providerModelsQueries[index]?.data;
      if (catalog && provider.kind !== "local_cli" && catalog.source === "live" && !catalog.isStale
          && Date.parse(catalog.fetchedAt) > Date.parse(provider.lastCheckedAt ?? "1970-01-01")) {
        const observation = `${provider.id}:${catalog.fetchedAt}`;
        if (!observedCatalogs.current.has(observation)) {
          observedCatalogs.current.add(observation);
          void queryClient.invalidateQueries({ queryKey: queryKeys.providers.list() });
        }
      }
      if (!catalog?.isStale || catalog.warning) return;
      const key = `${provider.id}:${catalog.fetchedAt}`;
      if (attemptedCatalogRefreshes.current.has(key)) return;
      attemptedCatalogRefreshes.current.add(key);
      void queryClient.fetchQuery({
        queryKey: queryKeys.providers.model(provider.id),
        queryFn: () => getProviderModels(provider.id, { refresh: "1" }),
        staleTime: 0,
      }).catch(() => undefined);
    });
  }, [providers, providerModelsQueries, queryClient]);

  const providerModelsById = useMemo<Record<string, ProviderModelsState>>(() => {
    const state: Record<string, ProviderModelsState> = {};

    providers.forEach((provider, index) => {
      const query = providerModelsQueries[index];
      const data = query?.data;
      const queryError = query?.error
        ? getApiErrorMessage(query.error, "Failed to load provider models")
        : undefined;
      const warning = data?.warning;

      state[provider.id] = {
        models: data?.models ?? [],
        loading: Boolean(query?.isFetching && !data),
        isRefreshing: Boolean(query?.isFetching && data),
        isStale: data?.isStale ?? false,
        error: queryError ?? warning ?? (
          provider.kind === "local_cli" && !provider.selectable
            ? provider.statusMessage
            : undefined
        ),
      };
    });

    return state;
  }, [providerModelsQueries, providers]);

  const refreshProviderModels = async (providerId: string): Promise<void> => {
    try {
      const models = await fetchProviderModels(providerId, true);
      queryClient.setQueryData(queryKeys.providers.model(providerId), models);
      if (models.isStale) toast.warning(models.warning ?? "Could not refresh models. Showing the saved list.");
      else toast.success("Model list refreshed");
      await queryClient.invalidateQueries({ queryKey: queryKeys.providers.list() });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to refresh model list"));
    }
  };

  const saveCLIExecutablePaths = useCallback(async (paths: Partial<{ codex: string; opencode: string }>) => {
    const settings = await patchSettings({
        ...(paths.codex !== undefined ? { codex_cli_executable: paths.codex } : {}),
        ...(paths.opencode !== undefined ? { opencode_cli_executable: paths.opencode } : {}),
      });
    queryClient.setQueryData(queryKeys.settings.detail(), settings);
    await cacheOwnership.providerMutation(queryClient);
  }, [queryClient]);


  const checkConnection = async (id: string): Promise<void> => {
    try {
      await checkProviderConnection(id);
      toast.success("Connection checked");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not check connection"));
    } finally {
      await cacheOwnership.providerMutation(queryClient);
    }
  };

  const addProviderMutation = useMutation({
    mutationFn: async (input: ProviderCreateBody) => {
      return createProvider(input);
    },
    onSuccess: (data) => {
      void cacheOwnership.providerMutation(queryClient);

      if (data.autoConfiguredWarning) {
        toast.warning(data.autoConfiguredWarning);
      } else if (data.autoConfiguredDefaults) {
        toast.success(
          data.autoConfiguredModelId
            ? `Provider added. Default model set to ${data.autoConfiguredModelId}`
            : "Provider added and defaults auto-configured"
        );
      } else {
        toast.success("Provider added successfully");
      }
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to add provider")),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: (result) => {
      void cacheOwnership.providerMutation(queryClient);
      const detail = result.updatedFeatures.length > 0
        ? result.fallbackModelId ? ` Features now use ${result.fallbackModelId}.` : " Affected features need a provider."
        : "";
      toast.success(`Provider removed.${detail}${result.disabledFallbacks.length ? " Affected matching fallbacks were disabled." : ""}`);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete provider")),
  });

  const updateProviderApiKeyMutation = useMutation({
    mutationFn: ({ id, apiKey }: { id: string; apiKey?: string | null }) =>
      updateProviderApiKey(id, { apiKey }),
    onSuccess: () => {
      void cacheOwnership.providerMutation(queryClient);
      toast.success("Provider API key updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to update provider API key")),
  });

  const updateProviderMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProviderPatchBody }) =>
      updateProvider(id, input),
    onSuccess: () => {
      void cacheOwnership.providerMutation(queryClient);
      toast.success("Provider connection updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to update provider connection")),
  });

  return { checkConnection, providersQuery, providers, providerModelsById, refreshProviderModels, saveCLIExecutablePaths, addProviderMutation, deleteProviderMutation, updateProviderApiKeyMutation, updateProviderMutation };
}
