import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { cp, mkdir, open, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { syncDirectory } from "./lifecycle-state.js";
import { readJsonFile, writeJsonFileAtomic } from "./files.js";
import type { SwitchyPaths } from "./types.js";

async function run(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = Buffer.alloc(0);
    const collect = (chunk: Buffer) => { output = Buffer.concat([output, chunk]).subarray(-64 * 1024); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10 * 60_000);
    child.once("error", () => clearTimeout(timeout));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) { reject(new Error(`${path.basename(executable)} timed out after 10 minutes`)); return; }
      if (code === 0) {
        resolve();
        return;
      }
      const message = output.toString("utf8").trim();
      if (message) console.error(message);
      reject(new Error(`${path.basename(executable)} exited with code ${code}`));
    });
  });
}

export async function ensurePlaywrightBrowser(
  runtimeDirectory: string,
  paths: SwitchyPaths
): Promise<void> {
  if (process.env.SWITCHY_SKIP_BROWSER_INSTALL === "1") return;
  const cliPath = path.join(
    runtimeDirectory,
    "node_modules",
    "playwright",
    "cli.js"
  );
  if (!(await stat(cliPath).catch(() => null))?.isFile()) {
    throw new Error("The packaged runtime is missing the Playwright installer");
  }
  const metadata = await readJsonFile<{ browserMode?: string }>(path.join(runtimeDirectory, "switchy-runtime.json"));
  const args = [cliPath, "install", "chromium"];
  if (metadata?.browserMode === "headless-shell") args.push("--only-shell");
  await run(process.execPath, args, {
    cwd: runtimeDirectory,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: paths.playwright,
    },
  });
}

export async function runDatabaseMigration(
  runtimeDirectory: string,
  paths: SwitchyPaths
): Promise<void> {
  await run(
    process.execPath,
    [path.join(runtimeDirectory, "bin", "migrate.cjs")],
    {
      cwd: runtimeDirectory,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SWITCHY_HOME: paths.root,
        SWITCHY_MIGRATION_PARENT_PID: String(process.pid),
      },
    }
  );
}

export async function createUpdateSnapshot(
  paths: SwitchyPaths,
  fromVersion: string,
  toVersion: string
): Promise<string | null> {
  if (!(await stat(paths.productionData).catch(() => null))?.isDirectory()) {
    return null;
  }
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const snapshotDirectory = path.join(
    paths.updateSnapshots,
    `update-${fromVersion}-to-${toVersion}-${timestamp}`
  );
  await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
  await cp(paths.productionData, path.join(snapshotDirectory, "production"), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
  await syncTree(path.join(snapshotDirectory, "production"));
  await writeJsonFileAtomic(path.join(snapshotDirectory, "update.json"), {
    fromVersion, toVersion, createdAt: new Date().toISOString(),
  });
  await syncDirectory(paths.updateSnapshots);
  return snapshotDirectory;
}

export async function syncTree(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await syncTree(file);
    else if (entry.isFile()) {
      const handle = await open(file, "r");
      try { await handle.sync(); } finally { await handle.close(); }
    }
  }
  await syncDirectory(directory);
}
