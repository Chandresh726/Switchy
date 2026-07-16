import { z } from "zod";

export const statsResponseSchema = z.object({
  totalJobs: z.number().int().nonnegative(),
  totalCompanies: z.number().int().nonnegative(),
  highMatchJobs: z.number().int().nonnegative(),
  appliedJobs: z.number().int().nonnegative(),
  newJobs: z.number().int().nonnegative(),
  viewedJobs: z.number().int().nonnegative(),
  savedJobs: z.number().int().nonnegative(),
  jobsWithScore: z.number().int().nonnegative(),
  lastScan: z.object({
    id: z.string(),
    triggerSource: z.string(),
    status: z.string(),
    companiesTotal: z.number().int().nonnegative(),
    companiesCompleted: z.number().int().nonnegative(),
    totalJobsFound: z.number().int().nonnegative(),
    totalJobsAdded: z.number().int().nonnegative(),
    scheduledForAt: z.string().nullable().optional(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
  }).passthrough().nullable(),
  totalPeople: z.number().int().nonnegative(),
  starredPeople: z.number().int().nonnegative(),
  mappedPeople: z.number().int().nonnegative(),
  unmatchedCompanyCount: z.number().int().nonnegative(),
  unmatchedPeopleCount: z.number().int().nonnegative(),
});
