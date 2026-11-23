"use client";

import { useEffect } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Power } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getLifecycleStatus, patchLifecyclePreferences } from "@/lib/api/clients/lifecycle";
import { queryKeys } from "@/lib/query-keys";

interface ApplicationSettingsProps {
  keepDeviceAwake: boolean;
  onKeepDeviceAwakeChange: (value: boolean) => void;
}

export const ApplicationSettings = ({ keepDeviceAwake, onKeepDeviceAwakeChange }: ApplicationSettingsProps) => {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: queryKeys.runtime.lifecycle(),
    queryFn: getLifecycleStatus,
    refetchInterval: 5000,
  });
  const save = useMutation({
    mutationFn: patchLifecyclePreferences,
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.runtime.lifecycle() }); },
    onError: (error: Error) => toast.error(error.message),
  });
  useEffect(() => {
    if (error) toast.error("Could not load app settings.", { id: "app-settings-error" });
  }, [error]);

  const disabled = !data?.supported || save.isPending;
  const preferences = data?.preferences;
  const rows = [
    {
      id: "keep-device-awake", label: "Keep awake while scraping or matching",
      checked: keepDeviceAwake, disabled: false,
      onChange: onKeepDeviceAwakeChange,
      description: "Display can sleep. Closing the lid still sleeps.",
      macOSOnly: true,
    },
    {
      id: "start-at-login", label: "Start Switchy on startup",
      description: "Run after restarting your laptop.",
      checked: preferences?.startAtLogin ?? false, disabled: disabled || !data?.startupSupported,
      onChange: (startAtLogin: boolean) => save.mutate({ startAtLogin }),
    },
    {
      id: "open-at-login", label: "Open Switchy on startup",
      description: "Open your browser when Switchy starts automatically.",
      checked: preferences?.openAtLogin ?? false, disabled: disabled || !preferences?.startAtLogin,
      onChange: (openAtLogin: boolean) => save.mutate({ openAtLogin }),
    },
    {
      id: "automatic-updates", label: "Install updates automatically",
      description: "Update when work finishes and Switchy tabs are closed.",
      checked: preferences?.automaticUpdates ?? false, disabled,
      onChange: (automaticUpdates: boolean) => save.mutate({ automaticUpdates }),
    },
  ];

  return (
    <Card className="rounded-xl border-border bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base">Startup, power &amp; updates</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => {
          const disabledReason = !row.disabled ? undefined
            : !data ? "Loading settings…"
              : !data.supported ? "Requires a packaged production build."
                : !data.startupSupported ? "Automatic startup is supported on macOS."
                  : row.id === "open-at-login" && !preferences?.startAtLogin
                    ? "Enable Start Switchy on startup first." : undefined;
          return (
            <div key={row.id} className="flex items-center justify-between gap-6" title={disabledReason}>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={row.id} className="text-sm leading-5">{row.label}</Label>
                  {row.macOSOnly && <Badge variant="secondary">macOS</Badge>}
                </div>
                <p id={`${row.id}-description`} className="text-xs text-muted-foreground">
                  {row.description}
                </p>
              </div>
              <Switch
                id={row.id}
                checked={row.checked}
                disabled={row.disabled}
                onCheckedChange={row.onChange}
                aria-describedby={`${row.id}-description`}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
