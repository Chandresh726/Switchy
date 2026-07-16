import { parseArgs } from "node:util";

import { z } from "zod";

import { createStateSnapshot } from "@/lib/state/backup";
import { stateCliArguments } from "@/lib/state/cli-arguments";
import { getStatePaths } from "@/lib/state/environment-paths";

const environmentSchema = z.enum(["production", "development"]);

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: stateCliArguments(),
    options: {
      environment: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const environment = environmentSchema.parse(values.environment);
  if (!values.output) throw new Error("Missing required --output directory");

  const snapshot = await createStateSnapshot({
    statePaths: getStatePaths(environment),
    outputDirectory: values.output,
  });
  console.log(`Verified ${environment} snapshot created at ${snapshot.snapshotDirectory}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "State backup failed");
  process.exitCode = 1;
});
