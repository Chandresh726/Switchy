import { execFile, spawn } from "node:child_process";
import { chmod, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { lifecycleFiles } from "./lifecycle-state.js";
import type { SwitchyPaths } from "./types.js";

const execute = promisify(execFile);
const LABEL = "com.switchy.lifecycle";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function startupPlist(paths: SwitchyPaths): string {
  const host = lifecycleFiles(paths).host;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${escapeXml(path.join(host, "node"))}</string><string>${escapeXml(path.join(host, "supervisor.cjs"))}</string><string>--login</string></array>
<key>EnvironmentVariables</key><dict><key>SWITCHY_HOME</key><string>${escapeXml(paths.root)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${escapeXml(path.join(paths.logs, "lifecycle.log"))}</string>
<key>StandardErrorPath</key><string>${escapeXml(path.join(paths.logs, "lifecycle.log"))}</string>
</dict></plist>\n`;
}

// The supervisor has no package dependencies. Each tick loads code from the
// selected runtime so upgrading Switchy also upgrades the lifecycle manager.
const SUPERVISOR = `const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.env.SWITCHY_HOME;
const bootTime = (() => { try { return Date.now() - require('node:os').uptime() * 1000; } catch { return 0; } })();
const lock = path.join(root, 'runtime/supervisor.lock');
fs.mkdirSync(path.dirname(lock), { recursive: true });
try { fs.mkdirSync(lock); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
    try {
      if (!owner.startedAt || owner.startedAt >= bootTime - 10000) {
        process.kill(owner.pid, 0); process.exit(0);
      }
    }
    catch (error) { if (error.code !== 'ESRCH') process.exit(0); }
  } catch {
    if (Date.now() - fs.statSync(lock).mtimeMs < 30000) process.exit(0);
  }
  fs.rmSync(lock, { recursive: true, force: true });
  try { fs.mkdirSync(lock); } catch { process.exit(0); }
}
fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
process.once('exit', () => fs.rmSync(lock, { recursive: true, force: true }));
process.once('SIGTERM', () => process.exit(0));
process.once('SIGINT', () => process.exit(0));
let login = process.argv.includes('--login');
function tick() {
  try {
    const current = JSON.parse(fs.readFileSync(path.join(root, 'app/current.json'), 'utf8'));
    if (!/^\\d+\\.\\d+\\.\\d+$/.test(current.version)) throw Error('Invalid installed version');
    const worker = path.join(root, 'app/versions', current.version, 'bin/lifecycle.cjs');
    const result = spawnSync(process.execPath, [worker, login ? 'login' : 'tick'], {
      env: { ...process.env, SWITCHY_HOME: root }, stdio: 'inherit'
    });
    if (result.status === 20) process.exit(0);
    if (result.status === 0) login = false;
  } catch (error) { console.error('Switchy lifecycle:', error.message); }
  setTimeout(tick, 30000);
}
tick();
`;

export async function installHost(paths: SwitchyPaths, runtimeDirectory: string): Promise<boolean> {
  if (!(await stat(path.join(runtimeDirectory, "bin/lifecycle.cjs")).catch(() => null))?.isFile()) return false;
  const host = lifecycleFiles(paths).host;
  await mkdir(host, { recursive: true, mode: 0o700 });
  const node = path.join(host, process.platform === "win32" ? "node.exe" : "node");
  if (!(await stat(node).catch(() => null))?.isFile()) {
    await copyFile(process.execPath, `${node}.tmp`);
    await chmod(`${node}.tmp`, 0o700);
    await rename(`${node}.tmp`, node);
  }
  await writeFile(path.join(host, "supervisor.cjs"), SUPERVISOR, { mode: 0o600 });
  return true;
}

export async function startHost(paths: SwitchyPaths): Promise<void> {
  const host = lifecycleFiles(paths).host;
  const log = await open(path.join(paths.logs, "lifecycle.log"), "a", 0o600);
  const child = spawn(path.join(host, process.platform === "win32" ? "node.exe" : "node"),
    [path.join(host, "supervisor.cjs")], {
      detached: true, stdio: ["ignore", log.fd, log.fd], windowsHide: true,
      env: { ...process.env, SWITCHY_HOME: paths.root },
    });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  }).finally(() => log.close());
  child.unref();
}

export async function setStartupRegistration(paths: SwitchyPaths, enabled: boolean): Promise<void> {
  if (process.platform !== "darwin") {
    if (enabled) throw new Error("Start at sign-in is currently supported on macOS");
    return;
  }
  const file = path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const existingRegistration = await readFile(file, "utf8").catch(() => "");
  if (existingRegistration && !existingRegistration.includes(escapeXml(paths.root))) {
    throw new Error("Another Switchy installation owns the startup item");
  }
  if (enabled) {
    await writeFile(file, startupPlist(paths), { mode: 0o600 });
    // Register for the next login. The existing supervisor owns this session;
    // bootstrapping another here would start a second supervisor.
  } else {
    await rm(file, { force: true });
    // Leave this session running, but prevent launchd from respawning it later.
    const uid = process.getuid?.();
    if (uid !== undefined) {
      await execute("/bin/launchctl", ["disable", `gui/${uid}/${LABEL}`]).catch(() => undefined);
    }
  }
  if (enabled) {
    const uid = process.getuid?.();
    if (uid !== undefined) await execute("/bin/launchctl", ["enable", `gui/${uid}/${LABEL}`]);
  }
}
