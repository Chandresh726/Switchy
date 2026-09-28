import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
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
  serverAgentInstalled: boolean;
  tickAgentInstalled: boolean;
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

function serverAgentPlist(appDirectory: string): string {
  const logs = logDirectory();
  const command = `cd ${shellSingleQuote(appDirectory)} && exec pnpm start`;
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

export async function getSchedulerHostStatus(): Promise<SchedulerHostStatus> {
  const [serverAgentInstalled, tickAgentInstalled, schedulerEnabled] = await Promise.all([
    pathExists(plistPath(SCHEDULER_SERVER_AGENT_LABEL)),
    pathExists(plistPath(SCHEDULER_TICK_AGENT_LABEL)),
    readSchedulerEnabled(),
  ]);
  const supported = process.platform === "darwin";
  return {
    platform: process.platform,
    supported,
    serverAgentInstalled,
    tickAgentInstalled,
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
  await writeFile(plistPath(SCHEDULER_SERVER_AGENT_LABEL), serverAgentPlist(appDirectory), {
    mode: 0o600,
  });
  await writeFile(plistPath(SCHEDULER_TICK_AGENT_LABEL), tickAgentPlist(port), {
    mode: 0o600,
  });
  try {
    await bootstrapAgent(SCHEDULER_SERVER_AGENT_LABEL);
  } catch (error) {
    console.warn("[SchedulerHost] Failed to bootstrap server agent (plist still installed):", error);
  }
  try {
    await bootstrapAgent(SCHEDULER_TICK_AGENT_LABEL);
  } catch (error) {
    console.warn("[SchedulerHost] Failed to bootstrap tick agent (plist still installed):", error);
  }
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
 * Never throws: failures are logged so settings saves always succeed.
 */
export async function syncSchedulerHost(
  appDirectory = process.cwd()
): Promise<SchedulerHostSyncResult> {
  if (process.platform !== "darwin") return "skipped";
  try {
    const enabled = await readSchedulerEnabled();
    if (!enabled) {
      await uninstallSchedulerHost();
      return "removed";
    }
    const status = await getSchedulerHostStatus();
    if (status.serverAgentInstalled && status.tickAgentInstalled) {
      return "installed";
    }
    await installSchedulerHost(appDirectory);
    return "installed";
  } catch (error) {
    console.warn("[SchedulerHost] Failed to sync scheduler host agents:", error);
    return "failed";
  }
}
