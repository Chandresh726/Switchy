import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, link, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { readJsonFile, withDirectoryLock, writeFileAtomic, writeJsonFileAtomic } from "./files.js";
import { saveStartupEnvironment, runtimeEnvironment } from "./startup-environment.js";
import { compareVersions, lifecycleFiles } from "./lifecycle-state.js";
import type { SwitchyPaths } from "./types.js";

const execute = promisify(execFile);
const LABEL = "com.switchy.lifecycle";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function startupPlist(paths: SwitchyPaths, executable = path.join(lifecycleFiles(paths).host, "node")): string {
  const host = lifecycleFiles(paths).host;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${escapeXml(executable)}</string><string>${escapeXml(path.join(host, "supervisor.cjs"))}</string><string>--login</string></array>
<key>EnvironmentVariables</key><dict><key>SWITCHY_HOME</key><string>${escapeXml(paths.root)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${escapeXml(path.join(paths.logs, "lifecycle.log"))}</string>
<key>StandardErrorPath</key><string>${escapeXml(path.join(paths.logs, "lifecycle.log"))}</string>
</dict></plist>\n`;
}

// The bootstrap stays dependency-free. One worker owns the manager lock and
// remains alive between checks; exit 21 loads the newly committed runtime.
const SUPERVISOR = `const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = process.env.SWITCHY_HOME;
let login = process.argv.includes('--login');
let child;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopping = true;
  if (child) child.kill('SIGTERM'); else process.exit(0);
});
function start() {
  let current;
  try { current = JSON.parse(fs.readFileSync(path.join(root, 'app/current.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!/^\\d+\\.\\d+\\.\\d+$/.test(current.version)) throw Error('Invalid installed version');
  const worker = path.join(root, 'app/versions', current.version, 'bin/lifecycle.cjs');
  if (!fs.existsSync(worker)) return;
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'app/host/node.json'), 'utf8'));
  child = spawn(path.join(root, 'app/host', metadata.file), [worker, login ? 'serve-login' : 'serve'], {
    env: { ...process.env, SWITCHY_HOME: root }, stdio: 'inherit', windowsHide: true
  });
  child.once('error', error => { console.error('Switchy lifecycle:', error.message); process.exitCode = 1; });
  child.once('exit', code => {
    child = undefined;
    if (stopping || code === 20) return;
    login = false;
    if (code === 21) start();
    else setTimeout(start, 30000);
  });
}
start();
`;

interface HostNode { file: string; version: string }

async function hostNode(paths: SwitchyPaths): Promise<HostNode> {
  const metadata = await readJsonFile<HostNode>(path.join(lifecycleFiles(paths).host, "node.json"));
  if (!metadata || !/^node-24\.\d+\.\d+(?:\.exe)?$/u.test(metadata.file)) throw new Error("Switchy manager Node metadata is invalid");
  return metadata;
}

export async function installHost(paths: SwitchyPaths, runtimeDirectory: string): Promise<boolean> {
  if (!(await stat(path.join(runtimeDirectory, "bin/lifecycle.cjs")).catch(() => null))?.isFile()) return false;
  return withDirectoryLock(lifecycleFiles(paths).hostLock, async () => {
    const host = lifecycleFiles(paths).host;
    await mkdir(host, { recursive: true, mode: 0o700 });
    const previous = await readJsonFile<HostNode>(path.join(host, "node.json"));
    const version = previous && compareVersions(previous.version, process.versions.node) > 0 ? previous.version : process.versions.node;
    const file = `node-${version}${process.platform === "win32" ? ".exe" : ""}`;
    const node = path.join(host, file);
    if (!(await stat(node).catch(() => null))?.isFile()) {
      if (version !== process.versions.node) throw new Error("The managed Node executable is missing. Start with the newer Node 24 version to restore it.");
      const temporary = `${node}.${randomUUID()}.tmp`;
      try {
        await copyFile(process.execPath, temporary);
        await chmod(temporary, 0o700);
        const handle = await open(temporary, "r");
        try { await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, node);
      } finally { await rm(temporary, { force: true }); }
    }
    const alias = path.join(host, process.platform === "win32" ? "node.exe" : "node");
    if (previous?.file !== file || !(await stat(alias).catch(() => null))) {
      const temporary = `${alias}.${randomUUID()}.tmp`;
      try {
        await link(node, temporary);
        await rename(temporary, alias);
      } catch (error) {
        if (!["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "") || !(await stat(alias).catch(() => null))) throw error;
      } finally { await rm(temporary, { force: true }); }
    }
    await writeJsonFileAtomic(path.join(host, "node.json"), { file, version });
    // Publish executable source atomically too. Running workers may configure
    // preferences at the same time that a terminal refreshes the host.
    await writeFileAtomic(path.join(host, "supervisor.cjs"), SUPERVISOR);
    await saveStartupEnvironment(paths);
    return true;
  });
}

export async function startHost(paths: SwitchyPaths): Promise<void> {
  const host = lifecycleFiles(paths).host;
  const log = await open(path.join(paths.logs, "lifecycle.log"), "a", 0o600);
  const node = await hostNode(paths);
  const child = spawn(path.join(host, node.file),
    [path.join(host, "supervisor.cjs")], {
      detached: true, stdio: ["ignore", log.fd, log.fd], windowsHide: true,
      env: { ...await runtimeEnvironment(paths), SWITCHY_HOME: paths.root },
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
  if (existingRegistration && !existingRegistration.includes(`<string>${escapeXml(paths.root)}</string>`)) {
    throw new Error("Another Switchy installation owns the startup item");
  }
  if (enabled) {
    const node = await hostNode(paths);
    await writeFileAtomic(file, startupPlist(paths, path.join(lifecycleFiles(paths).host, node.file)));
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
