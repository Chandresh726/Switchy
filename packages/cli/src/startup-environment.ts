import os from "node:os";
import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./files.js";
import { lifecycleFiles } from "./lifecycle-state.js";
import type { SwitchyPaths } from "./types.js";

const EXECUTABLE_VARIABLES = ["SWITCHY_CODEX_CLI_PATH", "SWITCHY_OPENCODE_CLI_PATH"] as const;
type ExecutableVariable = typeof EXECUTABLE_VARIABLES[number];
interface SavedEnvironment {
  path: string;
  cliExecutables?: Partial<Record<ExecutableVariable, string>>;
}

function searchPath(paths: SwitchyPaths, saved?: string): string {
  const home = os.homedir();
  return [...new Set([
    lifecycleFiles(paths).host,
    path.dirname(process.execPath),
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...(saved ?? "").split(path.delimiter),
    ...(process.platform === "win32" ? [] : [
      path.join(home, ".local/bin"), path.join(home, ".opencode/bin"),
      "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    ]),
  ].filter((value) => value && path.isAbsolute(value)))].join(path.delimiter);
}

export async function saveStartupEnvironment(paths: SwitchyPaths): Promise<void> {
  const file = path.join(lifecycleFiles(paths).host, "environment.json");
  const saved = await readJsonFile<SavedEnvironment>(file);
  const cliExecutables = { ...saved?.cliExecutables };
  for (const name of EXECUTABLE_VARIABLES) {
    const value = process.env[name]?.trim();
    if (value && path.isAbsolute(value)) cliExecutables[name] = value;
  }
  // Save only executable discovery settings, never shell credentials.
  await writeJsonFileAtomic(file, { path: searchPath(paths, saved?.path), cliExecutables });
}

export async function runtimeEnvironment(paths: SwitchyPaths): Promise<NodeJS.ProcessEnv> {
  const saved = await readJsonFile<SavedEnvironment>(path.join(lifecycleFiles(paths).host, "environment.json"));
  return { ...saved?.cliExecutables, ...process.env, PATH: searchPath(paths, saved?.path) };
}
