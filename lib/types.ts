import type { AIProvider } from "@/lib/ai/providers/types";
import type { ProviderModelDefinition, ProviderModelsResponse } from "@/lib/ai/providers/model-catalog";

export interface Provider {
  id: string;
  provider: AIProvider | string;
  name: string;
}

export type {  ProviderModelDefinition as ProviderModelOption, ProviderModelsResponse };
