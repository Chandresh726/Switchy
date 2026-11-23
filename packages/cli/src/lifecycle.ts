import { serveLifecycle } from "./lifecycle-daemon.js";
import { configureLifecycle, lifecycleTick } from "./lifecycle-manager.js";
import { readPreferences, readUpdateState } from "./lifecycle-state.js";
import type { LifecyclePreferences } from "./lifecycle-state.js";
import { ensureSwitchyDirectories, getSwitchyPaths } from "./paths.js";
import { installHost, setStartupRegistration, startHost } from "./startup.js";
import type { SwitchyPaths } from "./types.js";

export async function prepareLifecycleHost(paths: SwitchyPaths, runtimeDirectory: string): Promise<void> {
  if (process.env.SWITCHY_DISABLE_LIFECYCLE === "1") return;
  if (!await installHost(paths, runtimeDirectory)) return;
  const preferences = await readPreferences(paths);
  if (preferences.startAtLogin) await setStartupRegistration(paths, true);
  await startHost(paths);
}

export async function lifecycleCommand(action: string): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  if (action === "serve" || action === "serve-login") {
    process.exitCode = await serveLifecycle(action === "serve-login");
  } else if (action === "tick" || action === "login") {
    if (!await lifecycleTick(action === "login")) process.exitCode = 20;
  } else if (action === "enable" || action === "disable") {
    await configureLifecycle(paths, { startAtLogin: action === "enable" });
    console.log(`Start at sign-in ${action === "enable" ? "enabled" : "disabled"}.`);
  } else if (action === "status") {
    console.log(JSON.stringify({ preferences: await readPreferences(paths), update: await readUpdateState(paths) }, null, 2));
  } else if (action === "configure") {
    const input = JSON.parse(process.argv[3] ?? "{}") as Partial<LifecyclePreferences>;
    // This entrypoint is used only by the local app; never accept arbitrary paths.
    const allowed = ["startAtLogin", "openAtLogin", "automaticUpdates"];
    if (Object.entries(input).some(([key, value]) => !allowed.includes(key) || typeof value !== "boolean")) {
      throw new Error("Invalid lifecycle preferences");
    }
    await configureLifecycle(paths, input);
  } else {
    throw new Error("Use startup enable, disable, or status");
  }
}
