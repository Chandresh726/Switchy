import {
  jobResourceUpdateBodySchema,
  jobIdParamsSchema,
  jobSchema,
  jobUpdateResponseSchema,
  jobsQuerySchema,
  jobsResponseSchema,
} from "@/lib/api/contracts/jobs";
import { successSchema } from "@/lib/api/contracts/common";
import { clearMatchDataResponseSchema } from "@/lib/api/contracts/settings";
import type { z } from "zod";

import { appendQuery, apiCommand, apiGet, apiJsonMutation, serializePathParam, serializeQuery } from "../client";

const jobPath = (id: number) => serializePathParam(jobIdParamsSchema, { id });
export type JobsQueryInput = Partial<z.output<typeof jobsQuerySchema>>;

export const getJobs = (params: JobsQueryInput = {}) => {
  const query = serializeQuery(jobsQuerySchema, params);
  return apiGet(appendQuery("/api/jobs", query), jobsResponseSchema, "Failed to fetch jobs");
};

export const getJob = (id: number) =>
  apiGet(`/api/jobs/${jobPath(id)}`, jobSchema, "Failed to fetch job");

export const updateJob = (
  id: number,
  body: z.output<typeof jobResourceUpdateBodySchema>
) =>
  apiJsonMutation(
    `/api/jobs/${jobPath(id)}`,
    "PATCH",
    jobResourceUpdateBodySchema,
    body,
    jobUpdateResponseSchema,
    "Failed to update job"
  );

export const clearJobs = () => apiCommand(
  "/api/maintenance/jobs/clear",
  "POST",
  successSchema,
  "Failed to clear jobs"
);

export const clearJobMatchData = () => apiCommand(
  "/api/jobs/match-data",
  "DELETE",
  clearMatchDataResponseSchema,
  "Failed to clear match data"
);
