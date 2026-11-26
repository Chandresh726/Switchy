import type { CustomProviderConnection } from "../custom-config";
import type { ProviderModelDefinition } from "../model-contract";
import type { AIProvider } from "../types";

export interface ResolvedProviderCatalogRecord {
  id: string;
  provider: AIProvider;
  apiKey?: string;
  updatedAt: Date | null;
  customConnection?: CustomProviderConnection;
}

export interface ProviderModelsResponse {
  providerId: string;
  provider: AIProvider;
  models: ProviderModelDefinition[];
  fetchedAt: string;
  isStale: boolean;
  source: "live" | "cache";
  warning?: string;
}

export interface GetProviderModelsOptions {
  forceRefresh?: boolean;
  allowStaleOnError?: boolean;
  preferCache?: boolean;
}
