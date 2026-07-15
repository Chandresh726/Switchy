import { z } from "zod";

export const MatchResultSchema = z.object({
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type MatchResult = z.infer<typeof MatchResultSchema>;

export interface MatcherConfig {
  model: string;
  reasoningEffort?: string;
  batchSize: number;
  maxRetries: number;
  concurrencyLimit: number;
  timeoutMs: number;
  backoffBaseDelay: number;
  backoffMaxDelay: number;
  autoMatchAfterScrape: boolean;
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  model: "",
  reasoningEffort: "",
  batchSize: 2,
  maxRetries: 3,
  concurrencyLimit: 3,
  timeoutMs: 30000,
  backoffBaseDelay: 2000,
  backoffMaxDelay: 32000,
  autoMatchAfterScrape: true,
};

export type MatchResultMap = Map<number, MatchResult | Error>;

export type StrategyProgressCallback = (
  completed: number,
  total: number,
  succeeded: number,
  failed: number
) => void;

export interface ProfileData {
  profile: {
    id: number;
    summary: string | null;
    preferredCountry: string | null;
    preferredCity: string | null;
  };
  skills: Array<{
    name: string;
    category: string | null;
  }>;
  experience: Array<{
    title: string;
    company: string;
    description: string | null;
    location: string | null;
    startDate: string;
    endDate: string | null;
    highlights: string | null;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field: string | null;
    startDate: string | null;
    endDate: string | null;
    gpa: string | null;
    honors: string | null;
  }>;
}

export interface JobData {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  locationType: string | null;
  salary: string | null;
  department: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
}
