export type Platform =
  | "greenhouse"
  | "smartrecruiters"
  | "lever"
  | "ashby"
  | "eightfold"
  | "workday"
  | "servicenow"
  | "turbohire"
  | "mynexthire"
  | "uber"
  | "google"
  | "atlassian"
  | "rippling"
  | "visa"
  | "nutanix";

export type TriggerSource = "manual" | "scheduler" | "scheduler_recovery" | "company_refresh";

export type LocationType = "remote" | "hybrid" | "onsite";

export type DescriptionFormat = "markdown" | "plain" | "html";

export type EmploymentType = "full-time" | "part-time" | "contract" | "intern" | "temporary";

export type SeniorityLevel = "entry" | "mid" | "senior" | "lead" | "manager";

export type ScrapeLogStatus = "success" | "error" | "partial";

export type SessionStatus = "in_progress" | "completed" | "partial" | "failed" | "skipped";

export type MatcherStatus = "pending" | "in_progress" | "completed" | "failed";

export const PLATFORMS = [
  "greenhouse",
  "smartrecruiters",
  "lever",
  "ashby",
  "eightfold",
  "workday",
  "servicenow",
  "turbohire",
  "mynexthire",
  "uber",
  "google",
  "atlassian",
  "rippling",
  "visa",
  "nutanix",
] as const satisfies readonly Platform[];

const TRIGGER_SOURCES: readonly TriggerSource[] = [
  "manual",
  "scheduler",
  "scheduler_recovery",
  "company_refresh",
] as const;

const EMPLOYMENT_TYPES: readonly EmploymentType[] = [
  "full-time",
  "part-time",
  "contract",
  "intern",
  "temporary",
] as const;

export function isPlatform(value: string): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

export function isTriggerSource(value: string): value is TriggerSource {
  return TRIGGER_SOURCES.includes(value as TriggerSource);
}

function isEmploymentType(value: string): value is EmploymentType {
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
