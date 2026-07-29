import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AIRunSummary } from "@/lib/ai/observability";
import { cn } from "@/lib/utils";
import { formatDurationMs } from "@/lib/utils/format";

interface LabeledAIRun {
  label: string;
  run: AIRunSummary | null | undefined;
}

interface AIRunTelemetryProps {
  runs: LabeledAIRun[];
  className?: string;
  variant?: "card" | "inline";
}

function formatNumber(value: number | null): string {
  return value === null ? "Not reported" : new Intl.NumberFormat("en-US").format(value);
}

function statusVariant(status: string): "destructive" | "outline" {
  if (status === "failed") return "destructive";
  return "outline";
}

function AIRunTelemetryItem({ label, run }: { label: string; run: AIRunSummary }) {
  const metrics = [
    { label: "Attempts", value: formatNumber(run.attempts) },
    { label: "Total tokens", value: formatNumber(run.totalTokens) },
    { label: "Input tokens", value: formatNumber(run.inputTokens) },
    { label: "Output tokens", value: formatNumber(run.outputTokens) },
    {
      label: "Duration",
      value: run.durationMs === null ? "—" : formatDurationMs(run.durationMs),
    },
  ];

  return (
    <div className="flex min-w-[32rem] flex-1 flex-col gap-2.5 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {run.status !== "succeeded" ? (
          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
        ) : null}
      </div>

      <dl className="grid grid-cols-5 text-xs">
        {metrics.map((metric) => (
          <InlineTelemetryMetric
            key={metric.label}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </dl>
    </div>
  );
}

function InlineTelemetryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function InlineAIRunTelemetryItem({ run }: { run: AIRunSummary }) {
  const metrics = [
    { label: "Total tokens", value: formatNumber(run.totalTokens) },
    { label: "Input tokens", value: formatNumber(run.inputTokens) },
    { label: "Output tokens", value: formatNumber(run.outputTokens) },
    ...(run.outputReasoningTokens !== null
      ? [{ label: "Reasoning tokens", value: formatNumber(run.outputReasoningTokens) }]
      : []),
    {
      label: "Duration",
      value: run.durationMs === null ? "—" : formatDurationMs(run.durationMs),
    },
  ];

  return (
    <div className="w-full overflow-x-auto px-4 pb-3">
      <dl
        data-inline-telemetry-metrics
        className="grid min-w-[32rem] text-xs"
        style={{
          gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
        }}
      >
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={cn("min-w-0 px-3", index === 0 && "pl-0")}
          >
            <InlineTelemetryMetric label={metric.label} value={metric.value} />
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AIRunTelemetry({
  runs,
  className,
  variant = "card",
}: AIRunTelemetryProps) {
  const availableRuns = runs.filter(
    (entry): entry is { label: string; run: AIRunSummary } => Boolean(entry.run)
  );
  if (availableRuns.length === 0) return null;

  return (
    <details className={cn("group border-t border-border bg-muted/10", className)}>
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        AI telemetry · {availableRuns.length} run{availableRuns.length === 1 ? "" : "s"}
      </summary>
      {variant === "inline" ? (
        <div className="flex w-full flex-col">
          {availableRuns.map(({ label, run }) => (
            <InlineAIRunTelemetryItem
              key={`${label}:${run.id}`}
              run={run}
            />
          ))}
        </div>
      ) : (
        <div
          data-matching-telemetry-runs
          className="flex w-full overflow-x-auto"
        >
          {availableRuns.map(({ label, run }, index) => (
            <div key={`${label}:${run.id}`} className="flex min-w-0 flex-1">
              {index > 0 ? <Separator orientation="vertical" /> : null}
              <AIRunTelemetryItem label={label} run={run} />
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
