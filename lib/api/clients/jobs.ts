import { jobUpdateResponseSchema, jobsResponseSchema } from "@/lib/api/contracts/jobs";

import { apiGet, apiRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

export const getJobs = (query = "") =>
  apiGet(`/api/jobs${query ? `?${query.replace(/^\?/, "")}` : ""}`, jobsResponseSchema, "Failed to fetch jobs");

export const updateJob = (body: Record<string, unknown>) =>
  apiRequest(
    "/api/jobs",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
      body: JSON.stringify(body),
    },
    jobUpdateResponseSchema,
    "Failed to update job"
  );
