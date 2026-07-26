import { spawn } from "node:child_process";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SwitchyPaths } from "./types.js";

async function run(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    quiet?: boolean;
  }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.quiet ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited with code ${code}`));
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
  await run(process.execPath, [cliPath, "install", "chromium"], {
    cwd: runtimeDirectory,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: paths.playwright,
    },
    quiet: true,
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
  });
  await writeFile(
    path.join(snapshotDirectory, "update.json"),
    `${JSON.stringify({
      fromVersion,
      toVersion,
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 }
  );
  return snapshotDirectory;
}
