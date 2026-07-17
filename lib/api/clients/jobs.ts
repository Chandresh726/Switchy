import {
  jobSchema,
  jobUpdateResponseSchema,
  jobsResponseSchema,
} from "@/lib/api/contracts/jobs";
import { successSchema } from "@/lib/api/contracts/common";

import { apiGet, apiRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

export const getJobs = (query = "") =>
  apiGet(`/api/jobs${query ? `?${query.replace(/^\?/, "")}` : ""}`, jobsResponseSchema, "Failed to fetch jobs");

export const getJob = (id: number) =>
  apiGet(`/api/jobs/${id}`, jobSchema, "Failed to fetch job");

export const updateJob = (id: number, body: Record<string, unknown>) =>
  apiRequest(
    `/api/jobs/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
      body: JSON.stringify(body),
    },
    jobUpdateResponseSchema,
    "Failed to update job"
  );

export const clearJobs = () => apiRequest(
  "/api/maintenance/jobs/clear",
  { method: "POST", headers: APP_REQUEST_HEADERS },
  successSchema,
  "Failed to clear jobs"
);
