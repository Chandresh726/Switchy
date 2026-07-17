import type { AIExecutionUsage } from "@/lib/ai/runtime/types";

type LocalCLIConnectionStatus =
  | "ready"
  | "not_installed"
  | "not_authenticated"
  | "no_models"
  | "incompatible"
  | "error";

export interface LocalCLIStatus {
  status: LocalCLIConnectionStatus;
  selectable: boolean;
  cliVersion?: string;
  statusMessage: string;
  lastCheckedAt: string;
}

export interface BackendResult<T> {
  output: T;
  usage: AIExecutionUsage;
  finishReason?: string;
  warningCodes: string[];
}

export interface BackendTextInput {
  instructions: string;
  prompt: string;
  modelId: string;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface BackendStreamingInput extends BackendTextInput {
  onDelta: (delta: string) => void | Promise<void>;
}

export interface BackendStructuredInput<T> extends BackendTextInput {
  jsonSchema: Record<string, unknown>;
  validate: (value: unknown) => T;
}

export interface AIGenerationBackend {
  generateText(input: BackendTextInput): Promise<BackendResult<string>>;
  streamText(input: BackendStreamingInput): Promise<BackendResult<string>>;
  generateStructured<T>(input: BackendStructuredInput<T>): Promise<BackendResult<T>>;
}
