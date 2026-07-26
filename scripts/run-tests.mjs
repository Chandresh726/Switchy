import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectDirectory = process.cwd();
const testStateDirectory = await mkdtemp(
  path.join(os.tmpdir(), "switchy-vitest-")
);
const vitestCli = path.join(
  projectDirectory,
  "node_modules",
  "vitest",
  "vitest.mjs"
);

try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitestCli, ...process.argv.slice(2)], {
      cwd: projectDirectory,
      env: {
        ...process.env,
        SWITCHY_HOME: testStateDirectory,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else if (signal) reject(new Error(`vitest exited with signal ${signal}`));
      else reject(new Error(`vitest exited with code ${code}`));
    });
  });
} finally {
  await rm(testStateDirectory, { recursive: true, force: true });
}
