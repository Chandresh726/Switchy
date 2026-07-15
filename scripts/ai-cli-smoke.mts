import {
  getLocalCLIModels,
  getLocalCLIStatus,
  shutdownLocalCLIBackends,
} from "@/lib/ai/local-cli/service";
import type { LocalCLIProvider } from "@/lib/ai/providers/types";

async function main(): Promise<void> {
  const providers: LocalCLIProvider[] = ["codex_cli", "opencode_cli"];

  for (const provider of providers) {
    const connection = await getLocalCLIStatus(provider, { forceRefresh: true });
    const summary: Record<string, unknown> = {
      provider,
      status: connection.status,
      version: connection.cliVersion,
      message: connection.statusMessage,
    };
    if (connection.selectable) {
      const models = await getLocalCLIModels(provider);
      summary.models = models.map((model) => model.modelId);
    }
    console.log(JSON.stringify(summary, null, 2));
  }
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "CLI smoke check failed");
    process.exitCode = 1;
  })
  .finally(() => shutdownLocalCLIBackends());
