import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

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

async function initializeBuildDatabase() {
  const stateDirectory = path.join(
    buildStateDirectory,
    "data",
    "production"
  );
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const database = new Database(path.join(stateDirectory, "switchy.db"));
  try {
    database.pragma("busy_timeout = 5000");
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
  } finally {
    database.close();
  }
}

try {
  await initializeBuildDatabase();
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
  // Instrumentation tracing can copy previous release outputs into standalone
  // builds. They are not part of the application.
  await rm(path.join(projectDirectory, ".next", "standalone", "dist"), {
    recursive: true,
    force: true,
  });
} finally {
  await rm(buildStateDirectory, { recursive: true, force: true });
}
