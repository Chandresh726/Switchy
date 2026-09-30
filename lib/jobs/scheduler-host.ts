import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getSwitchyRootDirectory } from "@/lib/state/layout";

export const SCHEDULER_SERVER_AGENT_LABEL = "com.switchy.app";
export const SCHEDULER_TICK_AGENT_LABEL = "com.switchy.scheduler-tick";
export const SCHEDULER_TICK_INTERVAL_SECONDS = 300;
export const SCHEDULER_SERVER_PORT = 6767;

export type SchedulerHostSyncResult = "installed" | "removed" | "skipped" | "failed";

export interface SchedulerHostStatus {
  platform: NodeJS.Platform;
  supported: boolean;
  serverAgentSupported: boolean;
  serverAgentInstalled: boolean;
  tickAgentInstalled: boolean;
  serverAgentLoaded: boolean | null;
  tickAgentLoaded: boolean | null;
  schedulerEnabled: boolean;
}

const execFileAsync = promisify(execFile);

function launchAgentsDirectory(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, "Library", "LaunchAgents");
}

function plistPath(label: string, homeDirectory = os.homedir()): string {
  return path.join(launchAgentsDirectory(homeDirectory), `${label}.plist`);
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(`"`, "&quot;");
}

function logDirectory(): string {
  return path.join(getSwitchyRootDirectory(), "logs");
}

/**
 * The `switchy` CLI owns the lifecycle of packaged runtimes, which have no
 * pnpm scripts; a launchd server agent there could only crash-loop or fight
 * the CLI-managed server for the port and database.
 */
function isPackagedRuntime(appDirectory: string): boolean {
  return existsSync(path.join(appDirectory, "switchy-runtime.json"));
}

function serverAgentPlist(appDirectory: string): string {
  const logs = logDirectory();
  const command = `cd ${shellSingleQuote(appDirectory)} && exec pnpm start`;
  const searchPath = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SCHEDULER_SERVER_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(appDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(searchPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logs, "switchy-server.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logs, "switchy-server.err.log"))}</string>
</dict>
</plist>
`;
}

function tickAgentPlist(port: number): string {
  const logs = logDirectory();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SCHEDULER_TICK_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/curl</string>
    <string>-sS</string>
    <string>-m</string>
    <string>60</string>
    <string>-X</string>
    <string>POST</string>
    <string>${xmlEscape(`http://127.0.0.1:${port}/api/scheduler/recover`)}</string>
    <string>-H</string>
    <string>${xmlEscape("X-Switchy-Request: true")}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${SCHEDULER_TICK_INTERVAL_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logs, "switchy-scheduler-tick.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logs, "switchy-scheduler-tick.err.log"))}</string>
</dict>
</plist>
`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function bootstrapAgent(label: string): Promise<void> {
  const uid = process.getuid?.() ?? null;
  if (uid === null) return;
  const target = `gui/${uid}`;
  const plist = plistPath(label);
  try {
    await execFileAsync("/bin/launchctl", ["bootout", target, plist]);
  } catch {
    // Not loaded yet; continue to bootstrap.
  }
  await execFileAsync("/bin/launchctl", ["bootstrap", target, plist]);
}

async function bootoutAgent(label: string): Promise<void> {
  const uid = process.getuid?.() ?? null;
  if (uid === null) return;
  try {
    await execFileAsync("/bin/launchctl", [
      "bootout",
      `gui/${uid}`,
      plistPath(label),
    ]);
  } catch {
    // Already unloaded; removal of the plist is what matters.
  }
}

/**
 * Whether launchd currently has the agent loaded. Returns null when the
 * loaded state cannot be determined (non-macOS, no UID, launchctl missing),
 * so callers can fall back to plist existence instead of misreporting.
 */
async function isAgentLoaded(label: string): Promise<boolean | null> {
  const uid = process.getuid?.() ?? null;
  if (uid === null || process.platform !== "darwin") return null;
  try {
    await execFileAsync("/bin/launchctl", ["print", `gui/${uid}/${label}`]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such process|could not find|no such file/i.test(message)) return false;
    return null;
  }
}

/** Best-effort load; returns the loaded state afterwards. */
async function ensureAgentLoaded(label: string): Promise<boolean> {
  if (await isAgentLoaded(label)) return true;
  try {
    await bootstrapAgent(label);
  } catch (error) {
    console.warn(`[SchedulerHost] Failed to bootstrap ${label}:`, error);
    return false;
  }
  return (await isAgentLoaded(label)) ?? true;
}

/** Writes the plist when it changed and reloads it so launchd sees the update. */
async function ensureAgent(label: string, contents: string): Promise<boolean> {
  const plist = plistPath(label);
  const current = await readFile(plist, "utf8").catch(() => null);
  if (current !== contents) {
    await writeFile(plist, contents, { mode: 0o600 });
    // Booting out the agent this process runs under would kill the server;
    // launchd picks up the rewritten plist on its next load instead.
    if (current !== null && process.env.XPC_SERVICE_NAME !== label) {
      await bootoutAgent(label);
    }
  }
  return ensureAgentLoaded(label);
}

async function removeAgent(label: string): Promise<void> {
  if (!await pathExists(plistPath(label))) return;
  await bootoutAgent(label);
  await rm(plistPath(label), { force: true });
}

async function readSchedulerEnabled(): Promise<boolean> {
  try {
    const rows = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "scheduler_enabled"))
      .limit(1);
    const value = rows[0]?.value;
    return value === null || value === undefined ? true : value !== "false";
  } catch (error) {
    console.warn("[SchedulerHost] Failed to read scheduler_enabled setting:", error);
    return true;
  }
}

export async function getSchedulerHostStatus(
  appDirectory = process.cwd()
): Promise<SchedulerHostStatus> {
  const [
    serverPlistInstalled,
    tickPlistInstalled,
    serverAgentLoaded,
    tickAgentLoaded,
    schedulerEnabled,
  ] = await Promise.all([
    pathExists(plistPath(SCHEDULER_SERVER_AGENT_LABEL)),
    pathExists(plistPath(SCHEDULER_TICK_AGENT_LABEL)),
    isAgentLoaded(SCHEDULER_SERVER_AGENT_LABEL),
    isAgentLoaded(SCHEDULER_TICK_AGENT_LABEL),
    readSchedulerEnabled(),
  ]);
  const supported = process.platform === "darwin";
  // A plist without a loaded agent is a failed install, not a working
  // background service: report it as missing so sync retries the load.
  return {
    platform: process.platform,
    supported,
    serverAgentSupported: supported && !isPackagedRuntime(appDirectory),
    serverAgentInstalled: serverPlistInstalled && serverAgentLoaded !== false,
    tickAgentInstalled: tickPlistInstalled && tickAgentLoaded !== false,
    serverAgentLoaded,
    tickAgentLoaded,
    schedulerEnabled,
  };
}

export async function installSchedulerHost(
  appDirectory = process.cwd(),
  port = SCHEDULER_SERVER_PORT
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Scheduler host agents are only supported on macOS");
  }
  mkdirSync(logDirectory(), { recursive: true, mode: 0o700 });
  await mkdir(launchAgentsDirectory(), { recursive: true, mode: 0o700 });
  const failed: string[] = [];
  if (isPackagedRuntime(appDirectory)) {
    await removeAgent(SCHEDULER_SERVER_AGENT_LABEL);
  } else if (
    !await ensureAgent(SCHEDULER_SERVER_AGENT_LABEL, serverAgentPlist(appDirectory))
  ) {
    failed.push(SCHEDULER_SERVER_AGENT_LABEL);
  }
  if (!await ensureAgent(SCHEDULER_TICK_AGENT_LABEL, tickAgentPlist(port))) {
    failed.push(SCHEDULER_TICK_AGENT_LABEL);
  }
  if (failed.length > 0) {
    throw new Error(
      `Scheduler host plists were written but launchd did not load: ${failed.join(", ")}`
    );
  }
}

/**
 * Removes only the scheduler tick agent. Disabling auto-scrape must never
 * stop the app server itself, which may be running under the server agent.
 */
async function removeSchedulerTickAgent(): Promise<void> {
  if (process.platform !== "darwin") return;
  await bootoutAgent(SCHEDULER_TICK_AGENT_LABEL);
  await rm(plistPath(SCHEDULER_TICK_AGENT_LABEL), { force: true });
}

export async function uninstallSchedulerHost(): Promise<void> {
  if (process.platform !== "darwin") return;
  await bootoutAgent(SCHEDULER_SERVER_AGENT_LABEL);
  await bootoutAgent(SCHEDULER_TICK_AGENT_LABEL);
  await rm(plistPath(SCHEDULER_SERVER_AGENT_LABEL), { force: true });
  await rm(plistPath(SCHEDULER_TICK_AGENT_LABEL), { force: true });
}

/**
 * Keeps the OS-level host in sync with the `scheduler_enabled` setting.
 * The frontend only flips settings; this best-effort sync owns persistence.
 * Disabling removes the tick poke but deliberately leaves the app server
 * agent alone. Never throws: failures are logged so settings saves always
 * succeed.
 */
export async function syncSchedulerHost(
  appDirectory = process.cwd()
): Promise<SchedulerHostSyncResult> {
  if (process.platform !== "darwin") return "skipped";
  try {
    const enabled = await readSchedulerEnabled();
    if (!enabled) {
      await removeSchedulerTickAgent();
      return "removed";
    }
    await installSchedulerHost(appDirectory);
    const verified = await getSchedulerHostStatus(appDirectory);
    return verified.tickAgentInstalled
      && (!verified.serverAgentSupported || verified.serverAgentInstalled)
      ? "installed"
      : "failed";
  } catch (error) {
    console.warn("[SchedulerHost] Failed to sync scheduler host agents:", error);
    return "failed";
  }
}
