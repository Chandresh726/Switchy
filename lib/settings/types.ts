import type { ReasoningEffort } from "@/lib/ai/providers/types";
import type {
  ProviderModelsResponse,
} from "@/lib/api/contracts/settings";

export interface ProviderModelsState {
  models: ProviderModelsResponse["models"];
  loading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  error?: string;
}

export type { ReasoningEffort };
