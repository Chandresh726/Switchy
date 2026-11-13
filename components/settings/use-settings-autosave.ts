"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { patchSettings } from "@/lib/api/clients/settings";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

interface SettingsAutosaveOptions<T> {
  edits: T;
  setEdits: Dispatch<SetStateAction<T>>;
  updates: Record<string, unknown>;
  enabled: boolean;
  delay: number;
  errorMessage: string;
  cache?: "settings" | "scheduler" | "invalidate";
}

export const useSettingsAutosave = <T extends object>({
  edits,
  setEdits,
  updates,
  enabled,
  delay,
  errorMessage,
  cache = "settings",
}: SettingsAutosaveOptions<T>) => {
  const queryClient = useQueryClient();
  const attempted = useRef<string | null>(null);
  const failed = useRef<string | null>(null);
  const { mutate, isPending } = useMutation({
    mutationFn: ({
      updates,
    }: {
      updates: Record<string, unknown>;
      snapshot: T;
      signature: string;
    }) => patchSettings(updates),
    onSuccess: (data, { snapshot }) => {
      attempted.current = failed.current = null;
      if (cache === "invalidate")
        void cacheOwnership.settingsMutation(queryClient);
      else queryClient.setQueryData(queryKeys.settings.detail(), data);
      if (cache === "scheduler")
        void queryClient.invalidateQueries({
          queryKey: queryKeys.runtime.scheduler(),
        });
      setEdits((current) => {
        const next = { ...current };
        for (const key of Object.keys(snapshot) as Array<keyof T>) {
          if (Object.is(current[key], snapshot[key])) delete next[key];
        }
        return next;
      });
    },
    onError: (error, variables) => {
      attempted.current = null;
      failed.current = variables.signature;
      toast.error(getApiErrorMessage(error, errorMessage), {
        action: {
          label: "Retry",
          onClick: () => {
            failed.current = null;
            attempted.current = variables.signature;
            mutate(variables);
          },
        },
      });
    },
  });
  // Settings are JSON values. Compare their contents so unrelated renders do not
  // restart the debounce while retaining the original edit references in snapshot.
  const updatesJson = JSON.stringify(updates);
  useEffect(() => {
    const signature = JSON.stringify(edits);
    if (
      !enabled ||
      isPending ||
      attempted.current === signature ||
      failed.current === signature
    )
      return;
    const timer = setTimeout(() => {
      attempted.current = signature;
      mutate({
        updates: JSON.parse(updatesJson) as Record<string, unknown>,
        snapshot: edits,
        signature,
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [edits, enabled, isPending, delay, mutate, updatesJson]);
};
