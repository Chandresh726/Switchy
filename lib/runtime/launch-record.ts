import path from "node:path";

import { getSwitchyRootDirectory } from "@/lib/state/layout";

import { readJsonFile } from "./atomic-file";

/** A detached candidate must not open SQLite after its launcher died before publication. */
export async function verifyLaunchRecord(): Promise<void> {
  const instanceId = process.env.SWITCHY_INSTANCE_ID;
  if (!instanceId) return;
  const file = path.join(getSwitchyRootDirectory(), "runtime/process.json");
  for (let attempt = 0; attempt < 40; attempt++) {
    const record = await readJsonFile<{ pid: number; instanceId: string }>(file);
    if (record?.pid === process.pid && record.instanceId === instanceId) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The launcher did not publish this Switchy instance; startup was stopped");
}
