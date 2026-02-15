import type { AIProvider } from "@/lib/ai/providers/types";

export interface Provider {
  id: string;
  provider: AIProvider | string;
  name: string;
}

export interface ProviderWithDetails {
  id: string;
  provider: string;
  hasApiKey: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export { AIProvider };
