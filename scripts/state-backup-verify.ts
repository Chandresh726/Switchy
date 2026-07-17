import { parseArgs } from "node:util";

import { verifyStateSnapshot } from "@/lib/state/backup";
import { stateCliArguments } from "@/lib/state/cli-arguments";

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: stateCliArguments(),
    options: { from: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  if (!values.from) throw new Error("Missing required --from snapshot directory");

  const snapshot = await verifyStateSnapshot(values.from);
  console.log(
    `Snapshot verified: ${snapshot.manifest.environment}, created ${snapshot.manifest.createdAt}, ${snapshot.manifest.artifacts.length} artifacts`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Snapshot verification failed");
  process.exitCode = 1;
});
