"use client";

import { useMutation,useQueryClient } from "@tanstack/react-query";
import { useEffect,useRef } from "react";
import { toast } from "sonner";

import { resolveFeatureModel } from "@/components/settings/feature-model-settings";
import { patchSettings } from "@/lib/api/clients/settings";
import type { Settings } from "@/lib/api/contracts/settings";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import { cacheOwnership } from "@/lib/query-keys";
import { AI_MODEL_FEATURES } from "@/lib/settings/ai-features";
import type { ProviderModelsState } from "@/lib/settings/types";

interface ModelReconciliationOptions {
  settings: Settings | undefined;
  providerCount: number;
  featureModels: Record<keyof typeof AI_MODEL_FEATURES, ReturnType<typeof resolveFeatureModel>>;
  providerModelsById: Record<string, ProviderModelsState>;
}

export function useModelReconciliation({ settings, providerCount, featureModels, providerModelsById }: ModelReconciliationOptions) {
  const queryClient = useQueryClient();
  const lastModelReconciliationRef = useRef<string | null>(null);
  const failedModelReconciliationRef = useRef<string | null>(null);

  const reconcileModelsMutation = useMutation({
    mutationFn: ({ updates }: { updates: Record<string, string>; features: string[]; signature: string }) =>
      patchSettings(updates),
    onSuccess: (_data, variables) => {
      lastModelReconciliationRef.current = null;
      failedModelReconciliationRef.current = null;
      const updatedFeatures = Array.from(new Set(variables.features));
      if (updatedFeatures.length > 0) {
        toast.warning(`Updated invalid AI model settings for ${updatedFeatures.join(", ")}.`);
      }
      void cacheOwnership.settingsMutation(queryClient);
    },
    onError: (error, variables) => {
      lastModelReconciliationRef.current = null;
      failedModelReconciliationRef.current = variables.signature;
      toast.error(getApiErrorMessage(error, "Failed to auto-fix invalid model settings"), {
        action: {
          label: "Retry",
          onClick: () => {
            failedModelReconciliationRef.current = null;
            lastModelReconciliationRef.current = variables.signature;
            reconcileModelsMutation.mutate(variables);
          },
        },
      });
    },
  });

  useEffect(() => {
    if (!settings || providerCount === 0 || reconcileModelsMutation.isPending) {
      return;
    }

    const updates: Record<string, string> = {};
    const features: string[] = [];

    for (const feature of Object.keys(AI_MODEL_FEATURES) as Array<keyof typeof AI_MODEL_FEATURES>) {
      const keys = AI_MODEL_FEATURES[feature];
      const resolved = featureModels[feature];
      const catalog = providerModelsById[resolved.providerId];
      if (!catalog || catalog.loading || catalog.models.length === 0 || resolved.localProviderEdited || resolved.localModelEdited || !resolved.providerId || !resolved.modelId) continue;
      if ((settings[keys.provider] || "") !== resolved.providerId) updates[keys.provider] = resolved.providerId;
      if ((settings[keys.model] || "") !== resolved.modelId) updates[keys.model] = resolved.modelId;
      if (updates[keys.provider] || updates[keys.model]) features.push(keys.label);
    }

    if (Object.keys(updates).length === 0) {
      lastModelReconciliationRef.current = null;
      failedModelReconciliationRef.current = null;
      return;
    }

    const signature = JSON.stringify(updates);
    if (
      lastModelReconciliationRef.current === signature ||
      failedModelReconciliationRef.current === signature
    ) {
      return;
    }

    lastModelReconciliationRef.current = signature;
    reconcileModelsMutation.mutate({ updates, features, signature });
  }, [settings, providerCount, featureModels, providerModelsById, reconcileModelsMutation]);

}
