import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type { AIContentType } from "@/lib/ai/contracts";
import type { AIUsagePeriod } from "@/lib/ai/observability";
import type { AICapabilityGroup } from "@/lib/ai/runtime/capability-groups";
import type { JobsQueryInput } from "@/lib/api/clients/jobs";
import type {
  HistoryDetailQueryInput,
  HistoryQueryInput,
  ResumeHistoryQueryInput,
  ScrapeHistoryQueryInput,
} from "@/lib/api/clients/history";
import type {
  PeopleImportSessionsQueryInput,
  PeopleImportSessionDetailQueryInput,
  PeopleDuplicatesQueryInput,
  CompanyAliasesQueryInput,
  PeopleQueryInput,
  UnmatchedCompaniesQueryInput,
  UnmatchedCompanyPeopleQueryInput,
} from "@/lib/api/clients/people";
import {
  historyDetailQuerySchema,
  historyQuerySchema,
  resumeHistoryQuerySchema,
  scrapeHistoryQuerySchema,
} from "@/lib/api/contracts/history";
import { jobsQuerySchema } from "@/lib/api/contracts/jobs";
import {
  peopleImportSessionsQuerySchema,
  peopleImportSessionDetailQuerySchema,
  peopleDuplicatesQuerySchema,
  companyAliasesQuerySchema,
  peopleListQuerySchema,
  unmatchedCompaniesQuerySchema,
  unmatchedCompanyPeopleQuerySchema,
} from "@/lib/api/contracts/people";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)])
    );
  }
  return value;
}

export function canonicalQueryParams<TParams extends object>(params: TParams): TParams {
  return canonicalValue(params) as TParams;
}

function canonicalSchemaParams<TOutput extends object>(
  schema: {
    safeParse(input: unknown):
      | { success: true; data: TOutput }
      | { success: false };
  },
  params: object
): object {
  const result = schema.safeParse(params);
  return result.success
    ? canonicalQueryParams(result.data)
    : { invalid: canonicalQueryParams(params) };
}

export const queryKeys = {
  jobs: {
    all: ["jobs"] as const,
    lists: () => ["jobs", "list"] as const,
    list: (params: JobsQueryInput = {}) => [
      "jobs",
      "list",
      canonicalSchemaParams(jobsQuerySchema, params),
    ] as const,
    details: () => ["jobs", "detail"] as const,
    detail: (id: number) => ["jobs", "detail", id] as const,
  },
  stats: {
    all: ["stats"] as const,
    detail: () => ["stats", "detail"] as const,
  },
  companies: {
    all: ["companies"] as const,
    list: () => ["companies", "list"] as const,
    overviews: () => ["companies", "overview"] as const,
    overview: (id: number) => ["companies", "overview", id] as const,
    presets: () => ["assets", "preset-companies"] as const,
  },
  people: {
    all: ["people"] as const,
    lists: () => ["people", "list"] as const,
    list: (params: PeopleQueryInput = {}) => [
      "people",
      "list",
      canonicalSchemaParams(peopleListQuerySchema, params),
    ] as const,
    details: () => ["people", "detail"] as const,
    detail: (id: number) => ["people", "detail", id] as const,
    duplicates: (params: PeopleDuplicatesQueryInput = {}) => [
      "people",
      "duplicates",
      canonicalSchemaParams(peopleDuplicatesQuerySchema, params),
    ] as const,
    importSessions: (params: PeopleImportSessionsQueryInput = {}) => [
      "people",
      "import-sessions",
      canonicalSchemaParams(peopleImportSessionsQuerySchema, params),
    ] as const,
    importSession: (id: string, params: PeopleImportSessionDetailQueryInput = {}) => [
      "people",
      "import-session",
      id,
      canonicalSchemaParams(peopleImportSessionDetailQuerySchema, params),
    ] as const,
    companyAliases: (params: CompanyAliasesQueryInput = {}) => [
      "people",
      "company-aliases",
      canonicalSchemaParams(companyAliasesQuerySchema, params),
    ] as const,
    unmatchedCompanies: {
      all: () => ["people", "unmatched-companies"] as const,
      list: (params: UnmatchedCompaniesQueryInput = {}) => [
        "people",
        "unmatched-companies",
        "list",
        canonicalSchemaParams(unmatchedCompaniesQuerySchema, params),
      ] as const,
      ignored: (params: UnmatchedCompaniesQueryInput = {}) => [
        "people",
        "unmatched-companies",
        "ignored",
        canonicalSchemaParams(unmatchedCompaniesQuerySchema, params),
      ] as const,
      people: (params: UnmatchedCompanyPeopleQueryInput) => [
        "people",
        "unmatched-companies",
        "people",
        canonicalSchemaParams(unmatchedCompanyPeopleQuerySchema, params),
      ] as const,
    },
  },
  profile: {
    all: ["profile"] as const,
    detail: () => ["profile", "detail"] as const,
    skills: (profileId: number | null) => ["profile", "skills", profileId] as const,
    experience: (profileId: number | null) => ["profile", "experience", profileId] as const,
    education: (profileId: number | null) => ["profile", "education", profileId] as const,
  },
  settings: {
    all: ["settings"] as const,
    detail: () => ["settings", "detail"] as const,
  },
  notifications: {
    permission: () => ["notifications", "permission"] as const,
  },
  providers: {
    all: ["providers"] as const,
    list: () => ["providers", "list"] as const,
    status: (providerId: string) => ["providers", "status", providerId] as const,
    models: () => ["providers", "models"] as const,
    model: (providerId: string) => ["providers", "models", providerId] as const,
  },
  matchHistory: {
    all: ["history", "match"] as const,
    lists: () => ["history", "match", "list"] as const,
    list: (params: HistoryQueryInput = {}) => [
      "history",
      "match",
      "list",
      canonicalSchemaParams(historyQuerySchema, params),
    ] as const,
    details: () => ["history", "match", "detail"] as const,
    detailRoot: (id: string) => ["history", "match", "detail", id] as const,
    detail: (id: string, params: HistoryDetailQueryInput = {}) => [
      ...queryKeys.matchHistory.detailRoot(id),
      canonicalSchemaParams(historyDetailQuerySchema, params),
    ] as const,
  },
  scrapeHistory: {
    all: ["history", "scrape"] as const,
    lists: () => ["history", "scrape", "list"] as const,
    list: (params: ScrapeHistoryQueryInput = {}) => [
      "history",
      "scrape",
      "list",
      canonicalSchemaParams(scrapeHistoryQuerySchema, params),
    ] as const,
    details: () => ["history", "scrape", "detail"] as const,
    detailRoot: (id: string) => ["history", "scrape", "detail", id] as const,
    detail: (id: string, params: HistoryDetailQueryInput = {}) => [
      ...queryKeys.scrapeHistory.detailRoot(id),
      canonicalSchemaParams(historyDetailQuerySchema, params),
    ] as const,
  },
  resumeHistory: {
    all: ["history", "resume"] as const,
    lists: () => ["history", "resume", "list"] as const,
    list: (params: ResumeHistoryQueryInput = {}) => [
      "history",
      "resume",
      "list",
      canonicalSchemaParams(resumeHistoryQuerySchema, params),
    ] as const,
    details: () => ["history", "resume", "detail"] as const,
    detail: (id: string) => ["history", "resume", "detail", id] as const,
  },
  runtime: {
    scheduler: () => ["runtime", "scheduler"] as const,
    matchSessions: () => ["runtime", "match-session"] as const,
    matchSession: (id: string | null) => ["runtime", "match-session", id] as const,
    unmatchedJobs: () => ["runtime", "unmatched-jobs"] as const,
    unmatchedJobsCount: (days: number) => ["runtime", "unmatched-jobs", days] as const,
    health: () => ["runtime", "health"] as const,
    readiness: () => ["runtime", "health", "readiness"] as const,
    diagnostics: () => ["runtime", "health", "diagnostics"] as const,
  },
  ai: {
    all: ["ai"] as const,
    history: () => ["ai", "history"] as const,
    usages: () => ["ai", "usage"] as const,
    usage: (days: AIUsagePeriod, group: AICapabilityGroup | "all" = "all") =>
      ["ai", "usage", days, group] as const,
    contents: () => ["ai", "content"] as const,
    content: (jobId: number, type: AIContentType) => ["ai", "content", jobId, type] as const,
  },
} as const;

async function invalidateMany(queryClient: QueryClient, keys: QueryKey[]): Promise<void> {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export const cacheOwnership = {
  jobMutation(
    queryClient: QueryClient,
    context: { jobId?: number; companyId?: number } = {}
  ): Promise<void> {
    const keys: QueryKey[] = [
      queryKeys.jobs.lists(),
      queryKeys.stats.all,
    ];
    if (context.jobId !== undefined) keys.push(queryKeys.jobs.detail(context.jobId));
    if (context.companyId !== undefined) keys.push(queryKeys.companies.overview(context.companyId));
    return invalidateMany(queryClient, keys);
  },

  companyMutation(
    queryClient: QueryClient,
    context: {
      companyId?: number;
      affectsMappings?: boolean;
      affectsJobRecords?: boolean;
      affectsScrapeHistory?: boolean;
    } = {}
  ): Promise<void> {
    const keys: QueryKey[] = [
      queryKeys.companies.list(),
      queryKeys.jobs.all,
      queryKeys.stats.all,
      context.companyId === undefined
        ? queryKeys.companies.overviews()
        : queryKeys.companies.overview(context.companyId),
    ];
    if (context.affectsMappings) keys.push(queryKeys.people.all);
    if (context.affectsScrapeHistory) keys.push(queryKeys.scrapeHistory.all);
    if (context.affectsJobRecords) {
      keys.push(
        queryKeys.matchHistory.all,
        queryKeys.scrapeHistory.all,
        queryKeys.runtime.unmatchedJobs(),
        queryKeys.ai.history(),
        queryKeys.ai.usages(),
        queryKeys.ai.contents()
      );
    }
    return invalidateMany(queryClient, keys);
  },

  peopleMutation(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.people.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
    ]);
  },

  profileMutation(queryClient: QueryClient, childKey?: QueryKey): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.profile.detail(),
      ...(childKey ? [childKey] : []),
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.companies.overviews(),
      queryKeys.matchHistory.all,
      queryKeys.runtime.unmatchedJobs(),
    ]);
  },

  resumeMutation(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.profile.detail(),
      queryKeys.resumeHistory.all,
      queryKeys.ai.usages(),
    ]);
  },

  matchCompletion(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.companies.overviews(),
      queryKeys.matchHistory.all,
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.ai.usages(),
    ]);
  },

  settingsMutation(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [queryKeys.settings.all]);
  },

  schedulerSettingsMutation(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.settings.all,
      queryKeys.runtime.scheduler(),
    ]);
  },

  providerMutation(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.providers.all,
      queryKeys.settings.all,
    ]);
  },

  clearJobs(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.jobs.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.ai.history(),
      queryKeys.ai.usages(),
      queryKeys.ai.contents(),
    ]);
  },

  clearMatchHistory(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.ai.usages(),
    ]);
  },

  updateMatchHistoryStatus(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.ai.usages(),
    ]);
  },

  clearScrapeHistory(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.scrapeHistory.all,
      queryKeys.matchHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
      queryKeys.ai.usages(),
    ]);
  },

  updateScrapeHistoryStatus(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.jobs.all,
      queryKeys.scrapeHistory.all,
      queryKeys.matchHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
    ]);
  },

  clearMatchData(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.jobs.all,
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.stats.all,
      queryKeys.companies.overviews(),
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.ai.usages(),
    ]);
  },

  clearAIContent(queryClient: QueryClient): Promise<void> {
    return invalidateMany(queryClient, [
      queryKeys.ai.history(),
      queryKeys.ai.contents(),
    ]);
  },
};
