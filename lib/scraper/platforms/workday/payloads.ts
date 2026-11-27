import { z } from "zod";

import type { HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";

import type { WorkdayFacet } from "./country-filter";

export type WorkdayJobListItem = {
  title: string;
  externalPath: string;
  locationsText: string;
  postedOn: string;
  remoteType: string;
  bulletFields: string[];
  listingIdentity?: string;
};

export type WorkdayJobListResponse = {
  total: number;
  jobPostings: WorkdayJobListItem[];
  invalidCount: number;
  invalidFields: string[];
  facets: WorkdayFacet[];
};

export type WorkdayListFetchResult = {
  jobs: WorkdayJobListItem[];
  isComplete: boolean;
  advertisedCount: number;
  missingOffsets: number[];
  unidentifiedCount: number;
  invalidCount: number;
  invalidFields: string[];
  diagnostics: string[];
  resumed: boolean;
  scopeKey?: string;
  country?: string;
};

export type WorkdayListFetchStage = "bootstrap" | "list-page";


export type WorkdayJobDetailResponse = z.infer<typeof WorkdayJobDetailResponseSchema>;

export const WorkdayJobListItemSchema = z
  .object({
    title: z.string(),
    externalPath: z.string(),
    locationsText: z.string().nullish().transform((value) => value ?? ""),
    postedOn: z.string().nullish().transform((value) => value ?? ""),
    remoteType: z.string().nullish().transform((value) => value ?? ""),
    bulletFields: z.array(z.string()).nullish().transform((value) => value ?? []),
  })
  .passthrough();

export const WorkdayJobListEnvelopeSchema = z
  .object({
    total: z.number().int().nonnegative(),
    jobPostings: z.array(z.unknown()),
  })
  .passthrough();

export const WorkdayJobDetailResponseSchema = z
  .object({
    jobPostingInfo: z
      .object({
        jobDescription: z.string().default(""),
        timeType: z.string().default(""),
        externalUrl: z.string().default(""),
        startDate: z.string().nullish().catch(undefined),
        location: z.string().nullish().catch(undefined),
        country: z.object({ descriptor: z.string().optional() }).passthrough().nullish().catch(undefined),
        additionalLocations: z.array(z.union([z.string(), z.object({ descriptor: z.string() }).passthrough()])).nullish().catch(undefined),
      })
      .passthrough(),
  })
  .passthrough();

export type WorkdaySource = {
  baseUrl: string;
  tenant: string;
  board: string;
  searchText: string;
  appliedFacets: Record<string, string[]>;
};

export type WorkdaySession = WorkdaySource & {
  cookies: string;
  csrfToken: string;
};

export type WorkdaySessionController = {
  readonly session: WorkdaySession;
  readonly requestOptions: HttpRequestOptions;
  bootstrap(): Promise<WorkdaySession>;
};
