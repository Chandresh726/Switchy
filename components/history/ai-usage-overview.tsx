"use client";

import { Fragment, useState } from "react";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  Cpu,
  DatabaseZap,
  Gauge,
  Layers3,
  Loader2,
  Timer,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { AIUsagePeriod, AIUsageSummary } from "@/lib/ai/observability";
import type { AICapabilityGroup } from "@/lib/ai/runtime/capability-groups";
import { getAIUsage } from "@/lib/api/clients/ai";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

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

const WRITING_CAPABILITY_LABELS: Record<string, string> = {
  writing_cover_letter: "Cover letter",
  writing_referral: "Referral",
  writing_recruiter_follow_up: "Follow-up",
};

function capabilityBreakdownLabel(
  value: string,
  group: "matching" | "writing"
): string {
  return group === "writing"
    ? WRITING_CAPABILITY_LABELS[value] ?? capabilityLabel(value)
    : capabilityLabel(value);
}

const GROUP_COPY: Record<AICapabilityGroup | "all", { title: string; description: string }> = {
  all: {
    title: "Local AI usage",
    description:
      "Provider calls, tokens, latency, and failures across every capability. Currency is not estimated.",
  },
  matching: {
    title: "Matching AI usage",
    description:
      "Provider calls, tokens, latency, full match reuse, and failures for job analysis and match scoring. Currency is not estimated.",
  },
  writing: {
    title: "Writing AI usage",
    description:
      "Provider calls, tokens, latency, and failures for generated cover letters, referrals, and follow-ups. Currency is not estimated.",
  },
  profile: {
    title: "Profile AI usage",
    description:
      "Provider calls, tokens, latency, and failures for resume parsing. Currency is not estimated.",
  },
};

interface AIUsageOverviewProps {
  /** Scopes the ledger to one product area. Omit to report every capability. */
  group?: AICapabilityGroup;
}

interface UsagePeriodSelectorProps {
  period: AIUsagePeriod;
  onChange: (period: AIUsagePeriod) => void;
}

function UsagePeriodSelector({ period, onChange }: UsagePeriodSelectorProps) {
  return (
    <Select
      value={String(period)}
      onValueChange={(value) => onChange(
        value === "all" ? value : Number(value) as 7 | 30
      )}
    >
      <SelectTrigger size="sm" className="w-28" aria-label="Usage period">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="end"
        className="w-28 min-w-28"
      >
        <SelectGroup>
          <SelectItem value="7">7 days</SelectItem>
          <SelectItem value="30">30 days</SelectItem>
          <SelectItem value="all">All time</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function UsagePeriodButtons({ period, onChange }: UsagePeriodSelectorProps) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
      {([7, 30] as const).map((days) => (
        <Button
          key={days}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={period === days}
          className="h-7 rounded-md px-2.5 text-xs aria-pressed:bg-muted aria-pressed:text-foreground"
          onClick={() => onChange(days)}
        >
          {days} days
        </Button>
      ))}
    </div>
  );
}

interface DetailedUsageOverviewProps {
  group: "matching" | "writing";
  data: AIUsageSummary | undefined;
  period: AIUsagePeriod;
  detailsOpen: boolean;
  isError: boolean;
  isLoading: boolean;
  onPeriodChange: (period: AIUsagePeriod) => void;
  onDetailsChange: () => void;
  onRetry: () => void;
}

function DetailedUsageOverview({
  group,
  data,
  period,
  detailsOpen,
  isError,
  isLoading,
  onPeriodChange,
  onDetailsChange,
  onRetry,
}: DetailedUsageOverviewProps) {
  const isMatching = group === "matching";
  const title = isMatching ? "Matching AI usage" : "Writing AI usage";
  const description = isMatching
    ? "Job analysis and match scoring telemetry."
    : "Cover letters, referrals, and follow-up telemetry.";
  const retries = data ? Math.max(0, data.calls - data.executions) : 0;
  const runMetrics = data
    ? [
        { label: "Executions", value: data.executions },
        { label: "Succeeded", value: data.succeeded },
        { label: "Retries", value: retries },
        ...(data.failed > 0
          ? [{ label: "Failed", value: data.failed }]
          : []),
        ...(data.cancelled > 0
          ? [{ label: "Cancelled", value: data.cancelled }]
          : []),
        ...(data.abandoned > 0
          ? [{ label: "Interrupted", value: data.abandoned }]
          : []),
      ]
    : [];
  const tokenMetrics = data
    ? [
        { label: "Input", value: data.inputTokens },
        { label: "Cache read", value: data.inputCacheReadTokens },
        { label: "Output", value: data.outputTokens },
        { label: "Reasoning", value: data.outputReasoningTokens },
      ]
    : [];
  const detailsId = `${group}-ai-usage-details`;
  const sectionId = (section: string) => `${group}-usage-${section}`;

  return (
    <Card
      size="sm"
      className="gap-0 rounded-xl border-border bg-card/70 py-0 data-[size=sm]:py-0"
    >
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b py-3">
        <div className="min-w-0">
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <UsagePeriodSelector period={period} onChange={onPeriodChange} />
      </CardHeader>

      {isLoading ? (
        <CardContent className="grid grid-cols-2 p-0 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className={cn(
                "flex flex-col gap-2 border-border px-3 py-3",
                index < 2 && "border-b lg:border-b-0",
                index % 2 === 0 && "border-r",
                index !== 3 && "lg:border-r"
              )}
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </CardContent>
      ) : isError || !data ? (
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <p role="alert" className="text-sm text-muted-foreground">
            {title} could not be loaded.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </CardContent>
      ) : (
        <>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Provider calls",
                  value: formatNumber(data.calls),
                  detail: `${formatNumber(data.executions)} executions`,
                  icon: Activity,
                  accent: "text-blue-400",
                },
                {
                  label: "Success rate",
                  value: `${data.successRate}%`,
                  detail: `${formatNumber(data.succeeded)} succeeded · ${formatNumber(data.failed)} failed`,
                  icon: Gauge,
                  accent: "text-emerald-400",
                },
                {
                  label: "Total tokens",
                  value: formatNumber(data.totalTokens),
                  detail: `${formatNumber(data.inputTokens)} input · ${formatNumber(data.outputTokens)} output`,
                  icon: DatabaseZap,
                  accent: "text-purple-400",
                },
                {
                  label: "Average latency",
                  value: formatLatency(data.averageLatencyMs),
                  detail: "Per provider call",
                  icon: Timer,
                  accent: "text-amber-400",
                },
              ].map(({ label, value, detail, icon: Icon, accent }, index) => (
                <div
                  key={label}
                  className={cn(
                    "min-w-0 border-border px-3 py-3",
                    index < 2 && "border-b lg:border-b-0",
                    index % 2 === 0 && "border-r",
                    index !== 3 && "lg:border-r"
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    <Icon className={cn("size-3.5 shrink-0", accent)} />
                    <span className="truncate">{label}</span>
                  </div>
                  <p className="mt-1.5 text-xl font-semibold leading-none tabular-nums text-foreground">
                    {value}
                  </p>
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">{detail}</p>
                </div>
              ))}
            </div>
          </CardContent>

          <CardFooter
            className={cn(
              "flex-wrap justify-between gap-2 py-1",
              detailsOpen && "border-b"
            )}
          >
            <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
              <span>
                <strong className="font-medium text-foreground">
                  {formatNumber(data.executions)}
                </strong>{" "}
                executions
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-medium text-foreground">
                  {formatNumber(retries)}
                </strong>{" "}
                retries
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-medium text-foreground">
                  {formatNumber(data.succeeded)}
                </strong>{" "}
                succeeded
              </span>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={onDetailsChange}
            >
              {detailsOpen ? "Hide details" : "View details"}
              <ChevronDown
                data-icon="inline-end"
                className={cn("transition-transform", detailsOpen && "rotate-180")}
              />
            </Button>
          </CardFooter>

          {detailsOpen ? (
            <div
              id={detailsId}
              className="contents"
            >
              <CardContent
                data-overview-split
                className="overflow-x-auto p-0"
              >
                <div
                  data-overview-grid
                  className="grid min-w-[48rem]"
                  style={{
                    gridTemplateColumns:
                      `minmax(0, ${runMetrics.length}fr) auto minmax(0, ${tokenMetrics.length}fr)`,
                  }}
                >
                  <section
                    role="region"
                    className="flex min-w-0 flex-col gap-1.5 px-3 py-2"
                    aria-labelledby={sectionId("run-overview")}
                  >
                    <div className="flex items-center gap-1.5">
                      <Activity className="size-3.5 text-blue-400" />
                      <p
                        id={sectionId("run-overview")}
                        className="text-xs font-medium text-foreground"
                      >
                        Run overview
                      </p>
                    </div>
                    <dl
                      className="grid gap-x-4"
                      style={{
                        gridTemplateColumns:
                          `repeat(${runMetrics.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {runMetrics.map(({ label, value }) => (
                        <div key={label} className="min-w-0">
                          <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                          <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                            {formatNumber(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <Separator orientation="vertical" />

                  <section
                    role="region"
                    className="flex min-w-0 flex-col gap-1.5 px-3 py-2"
                    aria-labelledby={sectionId("tokens")}
                  >
                    <div className="flex items-center gap-1.5">
                      <DatabaseZap className="size-3.5 text-purple-400" />
                      <p
                        id={sectionId("tokens")}
                        className="text-xs font-medium text-foreground"
                      >
                        Token usage
                      </p>
                    </div>
                    <dl
                      className="grid gap-x-4"
                      style={{
                        gridTemplateColumns:
                          `repeat(${tokenMetrics.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {tokenMetrics.map(({ label, value }) => (
                        <div key={label} className="min-w-0">
                          <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                          <dd className="mt-0.5 font-medium tabular-nums text-foreground">
                            {formatNumber(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                </div>
              </CardContent>

              <Separator />

              <CardContent
                role="region"
                className="flex min-w-0 flex-col gap-2 py-1.5"
                aria-labelledby={sectionId("providers")}
              >
                  <div className="flex items-center gap-1.5">
                    <Cpu className="size-3.5 text-amber-400" />
                    <p
                      id={sectionId("providers")}
                      className="text-xs font-medium text-foreground"
                    >
                      Providers and models
                    </p>
                  </div>
                  {data.providers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No provider calls recorded.
                    </p>
                  ) : (
                    <Card
                      size="sm"
                      data-detail-list-card
                      className="gap-0 rounded-md bg-background/60 py-0 data-[size=sm]:py-0"
                    >
                      <CardContent className="flex flex-col divide-y divide-border">
                        {data.providers.map((provider) => (
                          <div
                            key={`${provider.provider}:${provider.modelId}`}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">
                                {provider.modelId}
                              </p>
                              <p className="truncate text-muted-foreground">
                                {provider.provider} · {formatNumber(provider.executions)} executions
                              </p>
                            </div>
                            <div className="text-right tabular-nums">
                              <p className="font-medium text-foreground">
                                {formatNumber(provider.calls)} calls ·{" "}
                                {formatNumber(provider.totalTokens)} tokens
                              </p>
                              <p className="text-muted-foreground">
                                {provider.succeeded} succeeded · {provider.failed} failed
                                {provider.abandoned > 0
                                  ? ` · ${provider.abandoned} interrupted`
                                  : ""}
                              </p>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
              </CardContent>

              <Separator />

              <CardContent
                role="region"
                className="flex min-w-0 flex-col gap-2 py-1.5"
                aria-labelledby={sectionId("capabilities")}
              >
                  <div className="flex items-center gap-1.5">
                    <Layers3 className="size-3.5 text-emerald-400" />
                    <p
                      id={sectionId("capabilities")}
                      className="text-xs font-medium text-foreground"
                    >
                      Capability breakdown
                    </p>
                  </div>
                  {data.capabilities.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No {group} calls in this period.
                    </p>
                  ) : (
                    <div
                      data-capability-strip
                      className="overflow-x-auto"
                    >
                      <div
                        data-capability-grid
                        className="grid w-full"
                        style={{
                          gridTemplateColumns: data.capabilities
                            .map((_, index) => (
                              index === 0
                                ? "minmax(0, 1fr)"
                                : "auto minmax(0, 1fr)"
                            ))
                            .join(" "),
                          minWidth: `${data.capabilities.length * 16}rem`,
                        }}
                      >
                        {data.capabilities.map((capability, index) => (
                          <Fragment key={capability.capability}>
                            {index > 0 ? <Separator orientation="vertical" /> : null}
                            <section
                              data-capability-item
                              className={cn(
                                "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 text-xs",
                                index === 0 && "pl-0",
                                index === data.capabilities.length - 1 && "pr-0"
                              )}
                              aria-label={capabilityBreakdownLabel(
                                capability.capability,
                                group
                              )}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {capabilityBreakdownLabel(
                                    capability.capability,
                                    group
                                  )}
                                </p>
                                <p className="truncate text-muted-foreground">
                                  {formatNumber(capability.executions)} executions
                                </p>
                              </div>
                              <div className="text-right tabular-nums">
                                <p className="font-medium text-foreground">
                                  {formatNumber(capability.calls)} calls
                                </p>
                                <p className="text-muted-foreground">
                                  {formatNumber(capability.totalTokens)} tokens ·{" "}
                                  {formatLatency(capability.averageLatencyMs)}
                                </p>
                              </div>
                            </section>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  )}
              </CardContent>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function AIUsageOverview({ group }: AIUsageOverviewProps = {}) {
  const [period, setPeriod] = useState<AIUsagePeriod>(7);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data, isError, isLoading, refetch } = useQuery<AIUsageSummary>({
    queryKey: queryKeys.ai.usage(period, group ?? "all"),
    queryFn: async () => {
      return getAIUsage(period, group);
    },
    placeholderData: group === "matching" || group === "writing"
      ? keepPreviousData
      : undefined,
  });
  const copy = GROUP_COPY[group ?? "all"];
  const retries = data ? Math.max(0, data.calls - data.executions) : 0;

  if (group === "matching" || group === "writing") {
    return (
      <DetailedUsageOverview
        group={group}
        data={data}
        period={period}
        detailsOpen={detailsOpen}
        isError={isError}
        isLoading={isLoading}
        onPeriodChange={setPeriod}
        onDetailsChange={() => setDetailsOpen((open) => !open)}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{copy.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <UsagePeriodButtons period={period} onChange={setPeriod} />
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
          <dl className="grid grid-cols-2 border-t border-border sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Executions", value: formatNumber(data.executions) },
              { label: "Retries", value: formatNumber(retries) },
              { label: "Cache hits", value: formatNumber(data.cacheHits) },
              { label: "Token coverage", value: `${data.tokenCoveragePercent}%` },
              { label: "Running", value: formatNumber(data.running) },
              { label: "Interrupted", value: formatNumber(data.abandoned) },
            ].map(({ label, value }) => (
              <div key={label} className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r last:border-r-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="border-t border-border px-4 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Capabilities
            </p>
            {data.capabilities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI calls in this period.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.capabilities.map((capability) => (
                  <Badge key={capability.capability} variant="outline">
                    {capabilityLabel(capability.capability)} · {capability.calls} calls
                    {capability.cacheHits > 0 ? ` · ${capability.cacheHits} cached` : ""}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid border-t border-border lg:grid-cols-3 lg:divide-x lg:divide-border">
            <section className="flex flex-col gap-2 px-4 py-3" aria-labelledby={`providers-${group ?? "all"}`}>
              <p
                id={`providers-${group ?? "all"}`}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Providers and models
              </p>
              {data.providers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No provider calls recorded.</p>
              ) : data.providers.map((provider) => (
                <div
                  key={`${provider.provider}:${provider.modelId}`}
                  className="flex items-start justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{provider.modelId}</p>
                    <p className="truncate text-muted-foreground">{provider.provider}</p>
                  </div>
                  <div className="shrink-0 text-right tabular-nums text-muted-foreground">
                    <p>{provider.calls} calls · {formatNumber(provider.totalTokens)} tokens</p>
                    <p>
                      {provider.succeeded} succeeded · {provider.failed} failed
                      {provider.abandoned > 0 ? ` · ${provider.abandoned} interrupted` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2 border-t border-border px-4 py-3 lg:border-t-0" aria-labelledby={`tokens-${group ?? "all"}`}>
              <p
                id={`tokens-${group ?? "all"}`}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Token accounting
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {[
                  ["Input", data.inputTokens],
                  ["Uncached input", data.inputNoCacheTokens],
                  ["Cache read", data.inputCacheReadTokens],
                  ["Cache write", data.inputCacheWriteTokens],
                  ["Output", data.outputTokens],
                  ["Text output", data.outputTextTokens],
                  ["Reasoning output", data.outputReasoningTokens],
                ].map(([label, value]) => (
                  <div key={String(label)} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right tabular-nums text-foreground">
                      {formatNumber(Number(value))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="flex flex-col gap-2 border-t border-border px-4 py-3 lg:border-t-0" aria-labelledby={`outcomes-${group ?? "all"}`}>
              <p
                id={`outcomes-${group ?? "all"}`}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Outcomes
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{data.succeeded} succeeded</Badge>
                {data.failed > 0 ? (
                  <Badge variant="destructive">{data.failed} failed</Badge>
                ) : null}
                {data.cancelled > 0 ? (
                  <Badge variant="outline">{data.cancelled} cancelled</Badge>
                ) : null}
                {data.abandoned > 0 ? (
                  <Badge variant="outline">{data.abandoned} interrupted</Badge>
                ) : null}
              </div>
              {data.failures.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {data.failures.map((failure) => (
                    <Badge key={failure.code} variant="outline">
                      {capabilityLabel(failure.code)} · {failure.count}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No failures recorded.</p>
              )}
              {data.fullMatchCacheReuses !== undefined ? (
                <p className="text-xs text-muted-foreground">
                  Full match reuse{" "}
                  <strong className="font-medium text-foreground">
                    {data.fullMatchCacheReuses}
                  </strong>
                </p>
              ) : null}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
