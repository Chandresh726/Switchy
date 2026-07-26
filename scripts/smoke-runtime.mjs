import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const projectDirectory = process.cwd();
const target = process.env.SWITCHY_TARGET
  ?? `${process.platform}-${process.arch}`;
const runtimeArchive = path.join(
  projectDirectory,
  "dist",
  "release-assets",
  `switchy-${JSON.parse(
    await readFile(path.join(projectDirectory, "package.json"), "utf8")
  ).version}-${target}.tar.gz`
);
const cli = path.join(projectDirectory, "packages", "cli", "dist", "cli.js");
const switchyHome = await mkdtemp(path.join(os.tmpdir(), "switchy-smoke-"));
const runtimeDirectory = path.join(switchyHome, "runtime-source");
const openCodeExecutable = path.join(
  projectDirectory,
  "tests",
  "fixtures",
  "ai",
  "fake-opencode-cli.mjs"
);
const openCodePidPath = path.join(switchyHome, "opencode.pid");
await mkdir(runtimeDirectory, { recursive: true });
await execute(
  "tar",
  ["-xzf", runtimeArchive, "-C", runtimeDirectory],
  { timeout: 120_000 }
);

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to allocate a smoke-test port");
  }
  const { port } = address;
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
  return port;
}

const port = await availablePort();
const environment = {
  ...process.env,
  SWITCHY_HOME: switchyHome,
  SWITCHY_RUNTIME_SOURCE: runtimeDirectory,
  SWITCHY_SKIP_BROWSER_INSTALL: "1",
  SWITCHY_OPENCODE_CLI_PATH: openCodeExecutable,
  SWITCHY_FAKE_OPENCODE_PID_PATH: openCodePidPath,
};

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitForProcessExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (processIsAlive(pid)) {
    throw new Error(`OpenCode helper ${pid} did not stop with Switchy`);
  }
}

try {
  await execute(
    process.execPath,
    [cli, "start", "--port", String(port)],
    { env: environment, timeout: 120_000 }
  );
  const status = await execute(
    process.execPath,
    [cli, "status"],
    { env: environment, timeout: 30_000 }
  );
  if (!status.stdout.includes("is running")) {
    throw new Error(`Unexpected status output: ${status.stdout}`);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
  if (!response.ok) {
    throw new Error(`Readiness returned ${response.status}`);
  }
  const openCodeResponse = await fetch(
    `http://127.0.0.1:${port}/api/providers/local-cli/status?provider=opencode_cli`
  );
  if (!openCodeResponse.ok) {
    throw new Error(`OpenCode status returned ${openCodeResponse.status}`);
  }
  const openCodeStatus = await openCodeResponse.json();
  if (
    openCodeStatus.status !== "ready"
    || openCodeStatus.cliVersion !== "8.8.8"
  ) {
    throw new Error(
      `Unexpected OpenCode status: ${JSON.stringify(openCodeStatus)}`
    );
  }
  const openCodePid = Number((await readFile(openCodePidPath, "utf8")).trim());
  await execute(
    process.execPath,
    [cli, "stop"],
    { env: environment, timeout: 30_000 }
  );
  await waitForProcessExit(openCodePid);
  const stopped = await execute(
    process.execPath,
    [cli, "status"],
    { env: environment, timeout: 30_000 }
  );
  if (!stopped.stdout.includes("is stopped")) {
    throw new Error(`Unexpected stopped output: ${stopped.stdout}`);
  }
} catch (error) {
  const logPath = path.join(switchyHome, "logs", "switchy.log");
  const log = await readFile(logPath, "utf8").catch(() => "");
  if (log) console.error(log.slice(-10_000));
  throw error;
} finally {
  await execute(
    process.execPath,
    [cli, "stop", "--force"],
    { env: environment, timeout: 30_000 }
  ).catch(() => undefined);
  await rm(switchyHome, { recursive: true, force: true });
}
