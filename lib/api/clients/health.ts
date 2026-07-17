import {
  readinessResponseSchema,
  runtimeHealthResponseSchema,
} from "@/lib/api/contracts/health";

import { apiGet, apiRequestAcceptingStatuses } from "../client";

export const getReadiness = () => apiRequestAcceptingStatuses(
  "/api/health/ready",
  { method: "GET" },
  readinessResponseSchema,
  [503],
  "Failed to read application readiness"
);

export const getRuntimeHealth = () => apiGet(
  "/api/health/runtime",
  runtimeHealthResponseSchema,
  "Failed to read runtime health"
);
