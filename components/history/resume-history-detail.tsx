"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  DatabaseZap,
  GraduationCap,
  Loader2,
  Sparkles,
  Timer,
} from "lucide-react";

import {
  RESUME_HISTORY_POLL_INTERVAL_MS,
  RESUME_PARSE_STATE_CONFIG,
} from "@/components/history/resume-history-state";
import { AIRunTelemetry } from "@/components/history/shared/ai-run-telemetry";
import {
  MetaLine,
  SessionStat,
  StatusPill,
  StatusRail,
} from "@/components/history/shared/session-primitives";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getResumeHistoryDetail } from "@/lib/api/clients/history";
import type { ResumeHistoryDetailResponse } from "@/lib/api/contracts/history";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  formatDate,
  formatDurationMs,
  formatFileSize,
  formatTime,
} from "@/lib/utils/format";

type ParsedResume = NonNullable<ResumeHistoryDetailResponse["parsedData"]>;

interface ResumeHistoryDetailProps {
  entryId: string;
}

function ResumeHistoryBackButton() {
  return (
    <Button variant="ghost" asChild className="self-start">
      <Link href="/history/ai/resume">
        <ArrowLeft data-icon="inline-start" />
        Back to Resume History
      </Link>
    </Button>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

function dateRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  return `${start ?? "Unknown"} – ${end ?? "Present"}`;
}

function ParsedResumeDetails({ resume }: { resume: ParsedResume }) {
  const profileFields = [
    ["Name", resume.name],
    ["Email", resume.email],
    ["Phone", resume.phone],
    ["Location", resume.location],
    ["LinkedIn", resume.linkedinUrl],
    ["GitHub", resume.githubUrl],
    ["Portfolio", resume.portfolioUrl],
  ] as const;
  const hasProfileFields = profileFields.some(([, value]) => Boolean(value));

  return (
    <Card className="rounded-xl border-border">
      <CardHeader>
        <CardTitle>
          <h2>Extracted resume data</h2>
        </CardTitle>
        <CardDescription>
          The complete structured information saved from this upload.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {hasProfileFields ? (
          <section aria-labelledby="resume-profile-heading">
            <h3 id="resume-profile-heading" className="text-sm font-medium text-foreground">
              Profile
            </h3>
            <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profileFields.map(([label, value]) => (
                <DetailField key={label} label={label} value={value} />
              ))}
            </dl>
          </section>
        ) : null}

        {resume.summary ? (
          <>
            {hasProfileFields ? <Separator /> : null}
            <section aria-labelledby="resume-summary-heading">
              <h3 id="resume-summary-heading" className="text-sm font-medium text-foreground">
                Summary
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {resume.summary}
              </p>
            </section>
          </>
        ) : null}

        {resume.skills.length > 0 ? (
          <>
            {hasProfileFields || resume.summary ? <Separator /> : null}
            <section aria-labelledby="resume-skills-heading">
              <h3 id="resume-skills-heading" className="text-sm font-medium text-foreground">
                Skills
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {resume.skills.map((skill, index) => (
                  <Badge key={`${skill.name}:${skill.category ?? ""}:${index}`} variant="secondary">
                    {skill.name}{skill.category ? ` · ${skill.category}` : ""}
                  </Badge>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {resume.experience.length > 0 ? (
          <>
            {hasProfileFields || resume.summary || resume.skills.length > 0 ? <Separator /> : null}
            <section aria-labelledby="resume-experience-heading">
              <h3 id="resume-experience-heading" className="text-sm font-medium text-foreground">
                Experience
              </h3>
              <div className="mt-3 flex flex-col gap-3">
                {resume.experience.map((role, index) => (
                  <Card key={`${role.company}:${role.title}:${index}`} size="sm" className="rounded-lg">
                    <CardHeader>
                      <CardTitle>{role.title || "Untitled role"}</CardTitle>
                      <CardDescription>
                        {[role.company, role.location, dateRange(role.startDate, role.endDate)]
                          .filter(Boolean)
                          .join(" · ")}
                      </CardDescription>
                    </CardHeader>
                    {role.description || (role.highlights?.length ?? 0) > 0 ? (
                      <CardContent className="flex flex-col gap-3">
                        {role.description ? (
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                            {role.description}
                          </p>
                        ) : null}
                        {role.highlights && role.highlights.length > 0 ? (
                          <ul className="list-disc pl-5 text-sm text-muted-foreground">
                            {role.highlights.map((highlight, highlightIndex) => (
                              <li key={`${highlight}:${highlightIndex}`}>{highlight}</li>
                            ))}
                          </ul>
                        ) : null}
                      </CardContent>
                    ) : null}
                  </Card>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {(resume.education?.length ?? 0) > 0 ? (
          <>
            {hasProfileFields || resume.summary || resume.skills.length > 0 || resume.experience.length > 0
              ? <Separator />
              : null}
            <section aria-labelledby="resume-education-heading">
              <h3 id="resume-education-heading" className="text-sm font-medium text-foreground">
                Education
              </h3>
              <div className="mt-3 flex flex-col gap-3">
                {resume.education?.map((school, index) => (
                  <Card key={`${school.institution}:${school.degree}:${index}`} size="sm" className="rounded-lg">
                    <CardHeader>
                      <CardTitle>{school.degree || "Degree"}</CardTitle>
                      <CardDescription>
                        {[school.institution, school.field, dateRange(school.startDate, school.endDate)]
                          .filter(Boolean)
                          .join(" · ")}
                      </CardDescription>
                    </CardHeader>
                    {school.gpa || school.honors ? (
                      <CardContent>
                        <MetaLine items={[
                          school.gpa && `GPA ${school.gpa}`,
                          school.honors,
                        ]} />
                      </CardContent>
                    ) : null}
                  </Card>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ResumeHistoryDetail({ entryId }: ResumeHistoryDetailProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.resumeHistory.detail(entryId),
    queryFn: () => getResumeHistoryDetail(entryId),
    refetchInterval: (query) => (
      query.state.data?.entry.parseState === "running"
        ? RESUME_HISTORY_POLL_INTERVAL_MS
        : false
    ),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-3">
        <ApiErrorState
          error={error}
          fallbackMessage="Resume parse details could not be loaded."
          onRetry={() => void refetch()}
        />
        <ResumeHistoryBackButton />
      </div>
    );
  }

  const { entry, parsedData } = data;
  const config = RESUME_PARSE_STATE_CONFIG[entry.parseState];
  const StateIcon = config.icon;
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : null;
  const summary = entry.parsedSummary;

  return (
    <div className="flex flex-col gap-6">
      <ResumeHistoryBackButton />

      <Card className="relative gap-0 overflow-hidden rounded-xl border-border py-0">
        <StatusRail className={config.railColor} />
        <CardHeader className="flex flex-row items-start justify-between gap-4 py-5 pl-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg",
              config.bgColor
            )}>
              <StateIcon className={cn("size-5", config.color, config.spin && "animate-spin")} />
            </div>
            <div className="min-w-0">
              <CardTitle>
                <h1 className="truncate text-lg">{entry.fileName ?? "Unnamed upload"}</h1>
              </CardTitle>
              <MetaLine
                className="mt-1"
                items={[
                  createdAt && `${formatDate(createdAt)} at ${formatTime(createdAt)}`,
                  entry.fileType?.toUpperCase(),
                  entry.fileSizeBytes === null ? null : formatFileSize(entry.fileSizeBytes),
                  entry.version === null ? null : `Version ${entry.version}`,
                  entry.parserVersion && `Parser ${entry.parserVersion}`,
                  entry.aiRun && `${entry.aiRun.provider} · ${entry.aiRun.modelId}`,
                  config.hint,
                ]}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {entry.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                {entry.storageState && entry.storageState !== "ready" ? (
                  <Badge variant="outline">{entry.storageState}</Badge>
                ) : null}
              </div>
            </div>
          </div>
          <StatusPill
            label={config.label}
            className={cn("border-transparent", config.color, config.bgColor)}
          />
        </CardHeader>

        {summary || entry.warnings.length > 0 || entry.aiRun ? (
          <CardContent className="flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-border/60 py-4 pl-6">
            {summary ? (
              <>
                <SessionStat size="md" value={summary.skillCount} label="skills" icon={Sparkles} />
                <SessionStat size="md" value={summary.experienceCount} label="roles" icon={Briefcase} />
                <SessionStat size="md" value={summary.educationCount} label="education" icon={GraduationCap} />
              </>
            ) : null}
            {entry.warnings.length > 0 ? (
              <SessionStat
                size="md"
                value={entry.warnings.length}
                label="warnings"
                icon={AlertTriangle}
              />
            ) : null}
            {entry.aiRun?.totalTokens ? (
              <SessionStat
                size="md"
                value={entry.aiRun.totalTokens}
                label="tokens"
                icon={DatabaseZap}
              />
            ) : null}
            {entry.aiRun?.durationMs ? (
              <SessionStat
                size="md"
                value={formatDurationMs(entry.aiRun.durationMs)}
                label="duration"
                icon={Timer}
              />
            ) : null}
          </CardContent>
        ) : null}

        <AIRunTelemetry
          runs={[{ label: "Resume parse", run: entry.aiRun }]}
          variant="inline"
        />
      </Card>

      {parsedData ? <ParsedResumeDetails resume={parsedData} /> : null}

      {entry.warnings.length > 0 ? (
        <Card className="rounded-xl border-border">
          <CardHeader>
            <CardTitle>
              <h2>Field warnings</h2>
            </CardTitle>
            <CardDescription>
              Values that should be reviewed before using the extracted profile data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {entry.warnings.map((warning, index) => (
                <li key={`${warning.code}:${warning.path}:${index}`} className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline">{warning.path}</Badge>
                  <span className="text-sm text-foreground">{warning.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
