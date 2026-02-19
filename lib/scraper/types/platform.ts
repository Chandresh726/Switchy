export type Platform = "greenhouse" | "lever" | "ashby" | "eightfold" | "workday" | "uber";

export type TriggerSource = "manual" | "scheduler" | "company_refresh";

export type JobStatus = "new" | "viewed" | "interested" | "applied" | "rejected" | "archived";

export type LocationType = "remote" | "hybrid" | "onsite";

export type DescriptionFormat = "markdown" | "plain" | "html";

export type EmploymentType = "full-time" | "part-time" | "contract" | "intern" | "temporary";

export type SeniorityLevel = "entry" | "mid" | "senior" | "lead" | "manager";

export type ScrapeLogStatus = "success" | "error" | "partial";

export type SessionStatus = "in_progress" | "completed" | "failed";

export type MatcherStatus = "pending" | "in_progress" | "completed" | "failed";

export type MatcherErrorType = "network" | "validation" | "rate_limit" | "json_parse" | "unknown";

export const PLATFORMS: readonly Platform[] = [
  "greenhouse",
  "lever",
  "ashby",
  "eightfold",
  "workday",
  "uber",
] as const;

export const TRIGGER_SOURCES: readonly TriggerSource[] = [
  "manual",
  "scheduler",
  "company_refresh",
] as const;

export const JOB_STATUSES: readonly JobStatus[] = [
  "new",
  "viewed",
  "interested",
  "applied",
  "rejected",
  "archived",
] as const;

export const LOCATION_TYPES: readonly LocationType[] = [
  "remote",
  "hybrid",
  "onsite",
] as const;

export const DESCRIPTION_FORMATS: readonly DescriptionFormat[] = [
  "markdown",
  "plain",
  "html",
] as const;

export const EMPLOYMENT_TYPES: readonly EmploymentType[] = [
  "full-time",
  "part-time",
  "contract",
  "intern",
  "temporary",
] as const;

export const SENIORITY_LEVELS: readonly SeniorityLevel[] = [
  "entry",
  "mid",
  "senior",
  "lead",
  "manager",
] as const;

export function isPlatform(value: string): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

export function isTriggerSource(value: string): value is TriggerSource {
  return TRIGGER_SOURCES.includes(value as TriggerSource);
}

export function isJobStatus(value: string): value is JobStatus {
  return JOB_STATUSES.includes(value as JobStatus);
}

export function isLocationType(value: string): value is LocationType {
  return LOCATION_TYPES.includes(value as LocationType);
}

export function isDescriptionFormat(value: string): value is DescriptionFormat {
  return DESCRIPTION_FORMATS.includes(value as DescriptionFormat);
}

export function isEmploymentType(value: string): value is EmploymentType {
  return EMPLOYMENT_TYPES.includes(value as EmploymentType);
}

export function parseEmploymentType(value: string | undefined): EmploymentType | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/[_\s]/g, "-");
  if (isEmploymentType(normalized)) return normalized;
  const mapping: Record<string, EmploymentType> = {
    fulltime: "full-time",
    "full time": "full-time",
    parttime: "part-time",
    "part time": "part-time",
  };
  return mapping[normalized];
}
