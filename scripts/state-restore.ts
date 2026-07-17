import { parseArgs } from "node:util";

import { z } from "zod";

import { getStatePaths } from "@/lib/state/environment-paths";
import { stateCliArguments } from "@/lib/state/cli-arguments";
import { restoreState } from "@/lib/state/restore";

const environmentSchema = z.enum(["production", "development"]);

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: stateCliArguments(),
    options: {
      environment: { type: "string" },
      from: { type: "string" },
      replace: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const environment = environmentSchema.parse(values.environment);
  if (!values.from) throw new Error("Missing required --from snapshot directory");

  const result = await restoreState({
    statePaths: getStatePaths(environment),
    snapshotDirectory: values.from,
    replace: values.replace,
  });
  console.log(`Restored ${environment} state at ${result.stateDirectory}`);
  if (result.rollbackSnapshotDirectory) {
    console.log(`Automatic rollback snapshot: ${result.rollbackSnapshotDirectory}`);
  }
  if (result.retainedPreviousStateDirectory) {
    console.warn(
      `Previous state could not be removed and remains at ${result.retainedPreviousStateDirectory}`
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "State restore failed");
  process.exitCode = 1;
});
