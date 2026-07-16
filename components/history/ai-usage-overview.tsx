"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Activity, DatabaseZap, Gauge, Loader2, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AIUsageSummary } from "@/lib/ai/observability";
import { getAIUsage } from "@/lib/api/clients/ai";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

function formatLatency(value: number): string {
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function capabilityLabel(value: string): string {
  return value.split("_").map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(" ");
}

export function AIUsageOverview() {
  const [days, setDays] = useState<7 | 30>(7);
  const { data, isError, isLoading, refetch } = useQuery<AIUsageSummary>({
    queryKey: ["ai-usage", days],
    queryFn: async () => {
      return getAIUsage(days);
    },
  });

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Local AI usage</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Provider calls, tokens, latency, full match reuse, and failures. Currency is not estimated.
          </p>
        </div>
        <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
          {([7, 30] as const).map((period) => (
            <Button
              key={period}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={days === period}
              className="h-7 rounded-md px-2.5 text-xs aria-pressed:bg-muted aria-pressed:text-foreground"
              onClick={() => setDays(period)}
            >
              {period} days
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center">
          <p role="alert" className="text-sm text-muted-foreground">
            AI usage could not be loaded.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            {[
              { label: "Provider calls", value: formatNumber(data.calls), icon: Activity },
              { label: "Success rate", value: `${data.successRate}%`, icon: Gauge },
              { label: "Total tokens", value: formatNumber(data.totalTokens), icon: DatabaseZap },
              { label: "Average latency", value: formatLatency(data.averageLatencyMs), icon: Timer },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 border-t border-border px-4 py-3 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Capabilities
              </p>
              {data.capabilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI calls in this period.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.capabilities.map((capability) => (
                    <span
                      key={capability.capability}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                    >
                      {capabilityLabel(capability.capability)} · {capability.calls}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end gap-5 text-xs text-muted-foreground">
              <span>
                Full match reuse <strong className="font-medium text-foreground">{data.fullMatchCacheReuses}</strong>
              </span>
              <span>
                Failures <strong className="font-medium text-foreground">{data.failed}</strong>
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
