"use client";

import { useCallback, useMemo } from "react";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  isLocalCLIProvider,
  type LocalCLIProvider
} from "@/lib/ai/providers/types";
import {
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
      return provider;
    });
  }, [localCLIProviders, localCLIStatusQueries, providerRecords]);

  const providerModelsQueries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: queryKeys.providers.model(provider.id),
      queryFn: async () => fetchProviderModels(provider.id),
      enabled: Boolean(provider.id) && (provider.kind === "api_key" || provider.selectable),
      staleTime: PROVIDER_MODELS_STALE_TIME_MS,
      retry: 1,
    })),
  });

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
      toast.success("Model list refreshed");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to refresh model list"));
    }
  };

  const saveCLIExecutablePaths = useCallback(async (paths: { codex: string; opencode: string }) => {
    await patchSettings({
        codex_cli_executable: paths.codex,
        opencode_cli_executable: paths.opencode,
      });
    await cacheOwnership.providerMutation(queryClient);
  }, [queryClient]);


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
    onSuccess: () => {
      void cacheOwnership.providerMutation(queryClient);
      toast.success("Provider deleted successfully");
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

  return { providersQuery, providers, providerModelsById, refreshProviderModels, saveCLIExecutablePaths, addProviderMutation, deleteProviderMutation, updateProviderApiKeyMutation, updateProviderMutation };
}
