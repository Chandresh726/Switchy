import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectDirectory = process.cwd();
const buildStateDirectory = await mkdtemp(
  path.join(os.tmpdir(), "switchy-next-build-")
);
const nextCli = path.join(
  projectDirectory,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextCli, "build"], {
      cwd: projectDirectory,
      env: {
        ...process.env,
        SWITCHY_HOME: buildStateDirectory,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`next build exited with code ${code}`));
    });
  });
} finally {
  await rm(buildStateDirectory, { recursive: true, force: true });
}
