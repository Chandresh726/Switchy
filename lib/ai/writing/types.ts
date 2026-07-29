import type { AIContentType } from "@/lib/ai/contracts";
import type { AIRunSummary } from "@/lib/ai/observability";

export interface HistoryVariant {
  id: number;
  variant: string;
  userPrompt: string | null;
  parentVariantId: number | null;
  aiRunId: string | null;
  aiRun?: AIRunSummary | null;
  source: "generated" | "manual_edit";
  selectedAt: string | null;
  copiedAt: string | null;
  discardedAt: string | null;
  editDistance: number | null;
  editDistanceRatio: number | null;
  createdAt: string | null;
}

export interface GeneratedContent {
  id: number;
  jobId: number;
  type: AIContentType;
  content: string;
  currentVariantId: number | null;
  createdAt: string;
  updatedAt: string;
  history: HistoryVariant[];
  jobTitle?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
}

export interface ContentResponse {
  id: number;
  jobId: number;
  type: AIContentType;
  content: string;
  currentVariantId: number | null;
  settingsSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  history: HistoryVariant[];
  jobTitle?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
}
