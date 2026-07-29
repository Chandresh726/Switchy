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
  Timer,
} from "lucide-react";

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

interface AIUsageOverviewProps {
  group: "matching" | "writing";
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

export function AIUsageOverview({ group }: AIUsageOverviewProps) {
  const [period, setPeriod] = useState<AIUsagePeriod>(7);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data, isError, isLoading, refetch } = useQuery<AIUsageSummary>({
    queryKey: queryKeys.ai.usage(period, group),
    queryFn: () => getAIUsage(period, group),
    placeholderData: keepPreviousData,
  });

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
