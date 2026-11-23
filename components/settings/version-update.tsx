"use client";

import { useEffect, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle, RefreshCw, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getLifecycleStatus, requestLifecycleUpdate } from "@/lib/api/clients/lifecycle";
import { queryKeys } from "@/lib/query-keys";

interface VersionUpdateProps {
  version: string;
}

type UpdateAction = "check" | "download" | "install";
const TOAST_ID = "switchy-update";

export const VersionUpdate = ({ version }: VersionUpdateProps) => {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: queryKeys.runtime.lifecycle(),
    queryFn: getLifecycleStatus,
    refetchInterval: (query) => query.state.data?.supported === false ? false : 5000,
  });
  const update = data?.update;
  const signature = JSON.stringify(update);
  const observed = useRef<string | undefined>(undefined);
  const [request, setRequest] = useState<{ action: UpdateAction; baseline: string | undefined } | null>(null);
  const available = Boolean(update?.latestVersion
    && update.latestVersion.localeCompare(version, undefined, { numeric: true }) > 0);
  const downloaded = available && update?.downloadedVersion === update?.latestVersion;

  const action = useMutation({
    mutationFn: requestLifecycleUpdate,
    onMutate: (action) => {
      setRequest({ action, baseline: signature });
      toast.loading(action === "check" ? "Checking for updates…"
        : action === "download" ? "Downloading update…" : "Restart requested…", { id: TOAST_ID });
    },
    onSuccess: (_, action) => {
      if (action === "install") window.sessionStorage.setItem("switchy-update-requested", "true");
      void client.invalidateQueries({ queryKey: queryKeys.runtime.lifecycle() });
    },
    onError: (error: Error) => {
      setRequest(null);
      toast.error(error.message, { id: TOAST_ID });
    },
  });

  useEffect(() => {
    if (error) toast.error("Could not check updates.", { id: TOAST_ID });
  }, [error]);

  useEffect(() => {
    if (!update || signature === observed.current) return;
    const first = observed.current === undefined;
    observed.current = signature;
    if (first) return;
    const options = { id: TOAST_ID };
    switch (update.phase) {
      case "checking": toast.loading("Checking for updates…", options); break;
      case "downloading": toast.loading("Downloading update…", options); break;
      case "ready": toast.success("Downloaded. Restart to update.", options); break;
      case "available": toast.info(`Version ${update.latestVersion} is available.`, options); break;
      case "waiting": toast.info("Update queued until Switchy is idle.", options); break;
      case "installing": toast.loading("Restarting Switchy…", options); break;
      case "failed": toast.error("Update failed. Try again.", options); break;
      case "idle": toast.success("You're up to date.", options); break;
    }
  }, [signature, update]);

  const awaitingRequest = request !== null && request.baseline === signature;
  const working = action.isPending || awaitingRequest
    || update?.phase === "checking" || update?.phase === "downloading" || update?.phase === "installing"
    || (request?.action === "install" && update?.phase === "waiting");
  const label = working ? "Updating Switchy"
    : downloaded ? "Restart to update" : available ? "Download update" : "Check for updates";
  const Icon = working ? LoaderCircle : downloaded ? RotateCw : available ? Download : RefreshCw;

  return (
    <span title={!data?.supported ? "Update checks, downloads, and restarts require a packaged production build." : label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="rounded-sm text-muted-foreground hover:text-foreground"
        aria-label={label}
        disabled={!data?.supported || working}
        onClick={() => action.mutate(downloaded ? "install" : available ? "download" : "check")}
      >
        <Icon className={working ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"} />
      </Button>
    </span>
  );
};
