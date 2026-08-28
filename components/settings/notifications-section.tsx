"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, ChevronDown, CircleAlert, Send, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  getNativeNotificationPermission,
  openNativeNotificationSettings,
  requestNativeNotificationPermission,
  sendTestNotification,
  stopNativeNotifications,
} from "@/lib/api/clients/notifications";
import { patchSettings } from "@/lib/api/clients/settings";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import type { NativeNotificationPermission } from "@/lib/api/contracts/notifications";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

const MATCH_THRESHOLDS = [60, 70, 75, 80, 85, 90] as const;

interface NotificationsSectionProps {
  enabled: boolean;
  threshold: number;
}

export function NotificationsSection({ enabled, threshold }: NotificationsSectionProps) {
  const queryClient = useQueryClient();
  const [selectedThreshold, setSelectedThreshold] = useState(String(threshold));
  const [syncedThreshold, setSyncedThreshold] = useState(threshold);
  if (syncedThreshold !== threshold) {
    setSyncedThreshold(threshold);
    setSelectedThreshold(String(threshold));
  }

  const permissionQuery = useQuery({
    queryKey: queryKeys.notifications.permission(),
    queryFn: getNativeNotificationPermission,
    enabled,
    staleTime: 10_000,
  });
  const permission = permissionQuery.data?.permission;

  const toggleMutation = useMutation({
    mutationFn: async (nextEnabled: boolean): Promise<NativeNotificationPermission | null> => {
      if (!nextEnabled) {
        await patchSettings({ notifications_enabled: false });
        try {
          await stopNativeNotifications();
        } catch {
          // Delivery is disabled in settings even if the helper is already stopped.
        }
        return null;
      }

      const { permission: granted } = await requestNativeNotificationPermission();
      queryClient.setQueryData(
        queryKeys.notifications.permission(),
        { success: true, permission: granted }
      );
      if (granted !== "granted") return granted;

      await patchSettings({ notifications_enabled: true });
      return granted;
    },
    onSuccess: async (granted) => {
      await cacheOwnership.settingsMutation(queryClient);
      if (granted === null) {
        toast.success("Job match notifications disabled");
        return;
      }
      if (granted === "granted") {
        toast.success("Job match notifications enabled");
        return;
      }
      toast.error(granted === "denied"
        ? "Switchy is blocked from showing notifications. Allow it in System Settings."
        : "Switchy could not access native notifications on this device.");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to update notifications")),
  });

  const openSettingsMutation = useMutation({
    mutationFn: openNativeNotificationSettings,
    onError: (error) => toast.error(
      getApiErrorMessage(error, "Failed to open notification settings")
    ),
  });

  const permissionBlocked = permission === "denied";
  const permissionUnavailable = permission === "unavailable";
  const permissionNeedsRequest = enabled && permission === "not_determined";

  const thresholdMutation = useMutation({
    mutationFn: (value: string) => patchSettings({ notifications_match_score_threshold: Number(value) }),
    onSuccess: async () => {
      await cacheOwnership.settingsMutation(queryClient);
      toast.success("Notification threshold updated");
    },
    onError: (error) => {
      setSelectedThreshold(String(threshold));
      toast.error(getApiErrorMessage(error, "Failed to update notification threshold"));
    },
  });

  const testMutation = useMutation({
    mutationFn: sendTestNotification,
    onSuccess: ({ message }) => toast.success(message),
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to send test notification")),
  });

  return (
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BellRing className="size-4 text-emerald-500" aria-hidden="true" />
          <CardTitle className="text-base">Notifications</CardTitle>
        </div>
        <CardDescription className="truncate text-xs">
          Automatic scrape alerts for strong matches.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            <div className="flex-1">
              <FieldLabel htmlFor="job-match-notifications">Job match alerts</FieldLabel>
            </div>
            <Switch
              id="job-match-notifications"
              checked={enabled}
              disabled={toggleMutation.isPending}
              onCheckedChange={(checked) => toggleMutation.mutate(checked)}
              aria-label="Enable job match notifications"
            />
          </Field>

          {permissionBlocked || permissionUnavailable || permissionNeedsRequest ? (
            <div
              className="border-amber-500/25 bg-amber-500/5 flex items-start gap-3 rounded-lg border px-3 py-2.5"
              aria-live="polite"
            >
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-amber-500"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {permissionBlocked
                    ? "Notifications are blocked"
                    : permissionUnavailable
                      ? "Native notifications could not start"
                      : "Finish notification setup"}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {permissionBlocked
                    ? "Allow Switchy in macOS Notification Settings."
                    : permissionUnavailable
                      ? "Restart Switchy, then check permission again."
                      : "Allow Switchy to show alerts on this device."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  openSettingsMutation.isPending
                  || permissionQuery.isFetching
                  || toggleMutation.isPending
                }
                onClick={() => {
                  if (permissionBlocked) openSettingsMutation.mutate();
                  else if (permissionUnavailable) void permissionQuery.refetch();
                  else toggleMutation.mutate(true);
                }}
              >
                <Settings2 data-icon="inline-start" aria-hidden="true" />
                {permissionBlocked
                  ? "Open Settings"
                  : permissionUnavailable
                    ? "Check again"
                    : "Allow"}
              </Button>
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="notification-threshold">Minimum match score</FieldLabel>
            <Select
              value={selectedThreshold}
              disabled={thresholdMutation.isPending}
              onValueChange={(value) => {
                setSelectedThreshold(value);
                thresholdMutation.mutate(value);
              }}
            >
              <SelectTrigger id="notification-threshold" className="w-full">
                <SelectValue placeholder="Select a score" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MATCH_THRESHOLDS.map((score) => (
                    <SelectItem key={score} value={String(score)}>{score}% and above</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="block">
        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center justify-between text-xs font-medium">
            Advanced
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">Verify delivery on this device.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                !enabled
                || permission !== "granted"
                || testMutation.isPending
              }
              onClick={() => testMutation.mutate()}
            >
              <Send data-icon="inline-start" aria-hidden="true" />
              {testMutation.isPending ? "Sending…" : "Send test"}
            </Button>
          </div>
        </details>
      </CardFooter>
    </Card>
  );
}
