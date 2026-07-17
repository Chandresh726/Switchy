import { z } from "zod";

export const statsQuerySchema = z.object({
  days: z.enum(["7", "30", "90"]).default("7").transform(
    (value) => Number(value) as 7 | 30 | 90
  ),
});

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
  period: z.object({
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  }),
  activeJobs: z.number().int().nonnegative(),
  activeHighMatchJobs: z.number().int().nonnegative(),
  statusCounts: z.object({
    new: z.number().int().nonnegative(),
    viewed: z.number().int().nonnegative(),
    interested: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
  }),
  recentActivity: z.object({
    discovered: z.number().int().nonnegative(),
    viewed: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
  }),
});

export type StatsResponse = z.infer<typeof statsResponseSchema>;
