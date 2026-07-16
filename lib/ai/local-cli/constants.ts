import type { LocalCLIProvider } from "@/lib/ai/providers/types";

export const BUILTIN_CLI_PROVIDER_IDS: Record<LocalCLIProvider, string> = {
  codex_cli: "builtin:codex-cli",
  opencode_cli: "builtin:opencode-cli",
};

export const CLI_EXECUTABLE_CONFIG: Record<
  LocalCLIProvider,
  { command: string; environmentVariable: string; settingKey: string; setupCommand: string }
> = {
  codex_cli: {
    command: "codex",
    environmentVariable: "SWITCHY_CODEX_CLI_PATH",
    settingKey: "codex_cli_executable",
    setupCommand: "codex login",
  },
  opencode_cli: {
    command: "opencode",
    environmentVariable: "SWITCHY_OPENCODE_CLI_PATH",
    settingKey: "opencode_cli_executable",
    setupCommand: "opencode auth login",
  },
};

export const CLI_STATUS_CACHE_TTL_MS = 30_000;
export const CLI_MODEL_CACHE_TTL_MS = 15 * 60_000;
export const CLI_IDLE_SHUTDOWN_MS = 5 * 60_000;
