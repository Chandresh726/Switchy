import type { AIProvider } from "@/lib/ai/providers/types";

export interface Provider {
  id: string;
  provider: AIProvider | string;
  name: string;
}
