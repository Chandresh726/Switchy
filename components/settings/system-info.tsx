"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Database, Server } from "lucide-react";
import type {
  ReadinessResponse,
  RuntimeHealthResponse,
} from "@/lib/api/contracts/health";

interface SystemInfoProps {
  version: string;
  dbPath: string;
  readiness?: ReadinessResponse;
  runtimeHealth?: RuntimeHealthResponse;
  isReadinessLoading?: boolean;
  isReadinessUnavailable?: boolean;
  isRuntimeHealthLoading?: boolean;
  isRuntimeHealthUnavailable?: boolean;
}

function stateLabel(value: "pending" | "ready" | "failed" | undefined): string {
  if (!value) return "Unavailable";
  return value === "ready" ? "Ready" : value === "failed" ? "Failed" : "Initializing";
}

export function SystemInfo({
  version,
  dbPath,
  readiness,
  runtimeHealth,
  isReadinessLoading = false,
  isReadinessUnavailable = false,
  isRuntimeHealthLoading = false,
  isRuntimeHealthUnavailable = false,
}: SystemInfoProps) {
  const databaseAvailable = readiness?.databaseAvailable
    ?? (isRuntimeHealthUnavailable ? undefined : runtimeHealth?.databaseAvailable);
  const schedulerInitialization = readiness?.schedulerInitialization
    ?? (isRuntimeHealthUnavailable ? undefined : runtimeHealth?.schedulerInitialization);
  const queueRecovery = readiness?.queueRecovery
    ?? (isRuntimeHealthUnavailable ? undefined : runtimeHealth?.queueRecovery);
  const overallState = isReadinessLoading
    ? "Checking"
    : isReadinessUnavailable
      ? "Unavailable"
      : readiness?.ready
        ? "Ready"
        : readiness
          ? "Not ready"
          : "Unavailable";
  const runtimeFallbackLabel = isRuntimeHealthLoading ? "Checking" : "Unavailable";

  return (
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">System Info</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Version</Label>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-muted-foreground border-border">v{version}</Badge>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Database</Label>
          <div className="flex items-center gap-2 rounded-md bg-background/60 border border-border px-3 py-2">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <code className="text-xs text-muted-foreground">{dbPath}</code>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Runtime</Label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-border bg-background/60 px-3 py-2">
              <span className="text-muted-foreground">Application</span>
              <p className="mt-0.5 font-medium text-foreground">{overallState}</p>
            </div>
            <div className="rounded-md border border-border bg-background/60 px-3 py-2">
              <span className="text-muted-foreground">Database</span>
              <p className="mt-0.5 font-medium text-foreground">
                {databaseAvailable === undefined
                  ? runtimeFallbackLabel
                  : databaseAvailable
                    ? "Available"
                    : "Unavailable"}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background/60 px-3 py-2">
              <span className="text-muted-foreground">Scheduler</span>
              <p className="mt-0.5 font-medium text-foreground">
                {schedulerInitialization === undefined
                  ? runtimeFallbackLabel
                  : stateLabel(schedulerInitialization)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background/60 px-3 py-2">
              <span className="text-muted-foreground">Queue recovery</span>
              <p className="mt-0.5 font-medium text-foreground">
                {queueRecovery === undefined
                  ? runtimeFallbackLabel
                  : stateLabel(queueRecovery)}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Platforms</Label>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Greenhouse</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Lever</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Ashby</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Eightfold</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Workday</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
