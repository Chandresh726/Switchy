import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export type SwitchyEnvironment = "development" | "production";

const SWITCHY_LAYOUT_VERSION = 1;

const DATA_DIRECTORY = "data";
const PRODUCTION_DIRECTORY = "production";
const DEVELOPMENT_DIRECTORY = "development";
const RUNTIME_DIRECTORY = "runtime";
const LAYOUT_FILE = "layout.json";
const MIGRATION_RECORD_FILE = "layout-migration.json";
const LAYOUT_LOCK_DIRECTORY = "layout.lock";
const LAYOUT_LOCK_OWNER_FILE = "owner.json";
const INVALID_LAYOUT_LOCK_GRACE_MS = 30_000;
const LAYOUT_LOCK_TIMEOUT_MS = 60_000;
const LEGACY_COORDINATION_SUFFIX = ".coordination";
const DATA_ARTIFACTS = [
  "switchy.db",
  "switchy.db-shm",
  "switchy.db-wal",
  "uploads",
  "encryption.secret",
] as const;

interface LayoutMigrationRecord {
  version: 1;
  startedAt: string;
  snapshotDirectory: string;
  environments: SwitchyEnvironment[];
}

interface LayoutLockOwner {
  pid: number;
  token: string;
}

function joinRuntimePath(...segments: string[]): string {
  return path.join(/* turbopackIgnore: true */ ...segments);
}

function writeJsonFileAtomicSync(filePath: string, value: unknown): void {
  const temporaryPath = joinRuntimePath(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function assertRegularDirectory(directoryPath: string, label: string): void {
  if (!existsSync(directoryPath)) return;
  const stats = lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory`);
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function assertLegacyRuntimeStopped(rootDirectory: string): void {
  const coordinationDirectory = `${rootDirectory}${LEGACY_COORDINATION_SUFFIX}`;
  if (!existsSync(coordinationDirectory)) return;
  assertRegularDirectory(coordinationDirectory, "Legacy coordination path");

  for (const name of readdirSync(coordinationDirectory)) {
    if (!name.startsWith(".switchy-runtime-") || !name.endsWith(".json")) continue;
    const lockPath = joinRuntimePath(coordinationDirectory, name);
    let value: { pid?: unknown };
    try {
      value = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    } catch {
      throw new Error(
        `Cannot verify legacy runtime lock ${name}. Remove it only after confirming Switchy is stopped.`
      );
    }
    if (
      typeof value.pid !== "number"
      || !Number.isInteger(value.pid)
      || value.pid <= 0
    ) {
      throw new Error(
        `Cannot verify legacy runtime lock ${name}. Remove it only after confirming Switchy is stopped.`
      );
    }
    if (processIsAlive(value.pid)) {
      throw new Error(
        "Switchy is still running from the legacy data layout. Stop it before upgrading."
      );
    }
  }
}

export function getSwitchyRootDirectory(
  homeDirectory = os.homedir(),
  configuredRoot = process.env.SWITCHY_HOME
): string {
  const override = configuredRoot?.trim();
  if (!override) {
    return joinRuntimePath(homeDirectory, ".switchy");
  }
  if (!path.isAbsolute(override)) {
    throw new Error("SWITCHY_HOME must be an absolute path");
  }
  return path.normalize(override);
}

export function getEnvironmentDataDirectory(
  environment: SwitchyEnvironment,
  rootDirectory = getSwitchyRootDirectory()
): string {
  return joinRuntimePath(
    rootDirectory,
    DATA_DIRECTORY,
    environment === "production" ? PRODUCTION_DIRECTORY : DEVELOPMENT_DIRECTORY
  );
}

export function getRuntimeDirectory(
  rootDirectory = getSwitchyRootDirectory()
): string {
  return joinRuntimePath(
    rootDirectory,
    RUNTIME_DIRECTORY
  );
}

function legacyEnvironmentDirectory(
  environment: SwitchyEnvironment,
  rootDirectory: string
): string {
  return environment === "production"
    ? rootDirectory
    : joinRuntimePath(rootDirectory, "dev");
}

function legacyArtifacts(
  environment: SwitchyEnvironment,
  rootDirectory: string
): string[] {
  const legacyDirectory = legacyEnvironmentDirectory(environment, rootDirectory);
  const artifacts = DATA_ARTIFACTS
    .map((name) => joinRuntimePath(legacyDirectory, name))
    .filter((artifactPath) => existsSync(artifactPath));
  for (const artifactPath of artifacts) {
    const stats = lstatSync(artifactPath);
    const isUploads = path.basename(artifactPath) === "uploads";
    if (
      stats.isSymbolicLink()
      || (isUploads ? !stats.isDirectory() : !stats.isFile())
    ) {
      throw new Error(
        `Legacy Switchy data must use regular files and directories: ${artifactPath}`
      );
    }
  }
  return artifacts;
}

function snapshotLegacyArtifacts(
  rootDirectory: string,
  environments: SwitchyEnvironment[]
): LayoutMigrationRecord {
  const migrationRecordPath = joinRuntimePath(
    getRuntimeDirectory(rootDirectory),
    MIGRATION_RECORD_FILE
  );
  if (existsSync(migrationRecordPath)) {
    const existing = JSON.parse(
      readFileSync(migrationRecordPath, "utf8")
    ) as Partial<LayoutMigrationRecord>;
    if (
      existing.version !== 1
      || typeof existing.startedAt !== "string"
      || !Number.isFinite(Date.parse(existing.startedAt))
      || typeof existing.snapshotDirectory !== "string"
      || !path.isAbsolute(existing.snapshotDirectory)
      || !Array.isArray(existing.environments)
      || existing.environments.some(
        (environment) =>
          environment !== "production" && environment !== "development"
      )
    ) {
      throw new Error("Switchy layout migration record is invalid");
    }
    assertRegularDirectory(
      existing.snapshotDirectory,
      "Switchy layout migration snapshot"
    );
    if (!existsSync(existing.snapshotDirectory)) {
      throw new Error("Switchy layout migration snapshot is missing");
    }
    return existing as LayoutMigrationRecord;
  }

  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const snapshotDirectory = joinRuntimePath(
    rootDirectory,
    "update-snapshots",
    `layout-v1-${timestamp}`
  );

  for (const environment of environments) {
    const destinationDirectory = joinRuntimePath(snapshotDirectory, environment);
    mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
    for (const sourcePath of legacyArtifacts(environment, rootDirectory)) {
      cpSync(sourcePath, joinRuntimePath(destinationDirectory, path.basename(sourcePath)), {
        errorOnExist: true,
        force: false,
        recursive: true,
      });
    }
  }

  const record: LayoutMigrationRecord = {
    version: 1,
    startedAt: new Date().toISOString(),
    snapshotDirectory,
    environments,
  };
  writeJsonFileAtomicSync(migrationRecordPath, record);
  return record;
}

function migrateEnvironment(
  environment: SwitchyEnvironment,
  rootDirectory: string
): void {
  const destinationDirectory = getEnvironmentDataDirectory(environment, rootDirectory);
  mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });

  for (const sourcePath of legacyArtifacts(environment, rootDirectory)) {
    const destinationPath = joinRuntimePath(
      destinationDirectory,
      path.basename(sourcePath)
    );
    if (existsSync(destinationPath)) {
      throw new Error(
        `Cannot merge legacy and current Switchy data at ${destinationPath}`
      );
    }
    renameSync(sourcePath, destinationPath);
  }

  if (environment === "development") {
    const legacyDevelopmentDirectory = legacyEnvironmentDirectory(
      environment,
      rootDirectory
    );
    if (
      existsSync(legacyDevelopmentDirectory)
      && readdirSync(legacyDevelopmentDirectory).length === 0
    ) {
      rmdirSync(legacyDevelopmentDirectory);
    }
  }
}

function migrateLegacyCoordination(rootDirectory: string): void {
  const legacyCoordination = `${rootDirectory}${LEGACY_COORDINATION_SUFFIX}`;
  if (!existsSync(legacyCoordination)) return;
  const coordinationDirectory = joinRuntimePath(
    getRuntimeDirectory(rootDirectory),
    "coordination"
  );
  if (existsSync(coordinationDirectory)) {
    if (readdirSync(legacyCoordination).length > 0) {
      throw new Error(
        "Cannot merge legacy and current Switchy runtime coordination data"
      );
    }
    rmSync(legacyCoordination, { recursive: true });
    return;
  }
  renameSync(legacyCoordination, coordinationDirectory);
}

function readLayoutLockOwner(lockDirectory: string): LayoutLockOwner | null {
  try {
    const value = JSON.parse(
      readFileSync(
        joinRuntimePath(lockDirectory, LAYOUT_LOCK_OWNER_FILE),
        "utf8"
      )
    ) as Partial<LayoutLockOwner>;
    if (
      !Number.isInteger(value.pid)
      || (value.pid ?? 0) <= 0
      || typeof value.token !== "string"
      || value.token.length === 0
    ) {
      return null;
    }
    return value as LayoutLockOwner;
  } catch {
    return null;
  }
}

function acquireLayoutLock(
  rootDirectory: string,
  timeoutMs: number
): () => void {
  const lockDirectory = joinRuntimePath(
    getRuntimeDirectory(rootDirectory),
    LAYOUT_LOCK_DIRECTORY
  );
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
      writeJsonFileAtomicSync(
        joinRuntimePath(lockDirectory, LAYOUT_LOCK_OWNER_FILE),
        { pid: process.pid, token }
      );
      return () => {
        if (readLayoutLockOwner(lockDirectory)?.token === token) {
          rmSync(lockDirectory, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readLayoutLockOwner(lockDirectory);
      let lockAgeMs: number;
      try {
        lockAgeMs = Date.now() - lstatSync(lockDirectory).mtimeMs;
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw lockError;
      }
      if (
        (owner && !processIsAlive(owner.pid))
        || (!owner && lockAgeMs > INVALID_LAYOUT_LOCK_GRACE_MS)
      ) {
        rmSync(lockDirectory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for Switchy layout initialization");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

export function ensureSwitchyLayoutSync(
  rootDirectory = getSwitchyRootDirectory(),
  lockTimeoutMs = LAYOUT_LOCK_TIMEOUT_MS
): void {
  assertRegularDirectory(rootDirectory, "Switchy home");
  mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  const runtimeDirectory = getRuntimeDirectory(rootDirectory);
  assertRegularDirectory(runtimeDirectory, "Switchy layout path");
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const releaseLayoutLock = acquireLayoutLock(rootDirectory, lockTimeoutMs);
  try {
    for (const directory of [
      joinRuntimePath(rootDirectory, DATA_DIRECTORY),
      getEnvironmentDataDirectory("production", rootDirectory),
      getEnvironmentDataDirectory("development", rootDirectory),
      joinRuntimePath(rootDirectory, "app"),
      joinRuntimePath(rootDirectory, "app", "versions"),
      joinRuntimePath(rootDirectory, "logs"),
      joinRuntimePath(rootDirectory, "cache"),
      joinRuntimePath(rootDirectory, "cache", "downloads"),
      joinRuntimePath(rootDirectory, "cache", "playwright"),
      joinRuntimePath(rootDirectory, "update-snapshots"),
    ]) {
      assertRegularDirectory(directory, "Switchy layout path");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }

    const environments = (["production", "development"] as const)
      .filter(
        (environment) =>
          legacyArtifacts(environment, rootDirectory).length > 0
      );
    if (environments.length > 0) {
      assertLegacyRuntimeStopped(rootDirectory);
      snapshotLegacyArtifacts(rootDirectory, environments);
      for (const environment of environments) {
        migrateEnvironment(environment, rootDirectory);
      }
    }

    migrateLegacyCoordination(rootDirectory);
    writeJsonFileAtomicSync(
      joinRuntimePath(rootDirectory, LAYOUT_FILE),
      { version: SWITCHY_LAYOUT_VERSION }
    );
  } finally {
    releaseLayoutLock();
  }
}
