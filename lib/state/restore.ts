import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import type { StatePaths } from "./environment-paths";
import {
  createStateSnapshot,
  type VerifiedStateSnapshot,
  verifyMaterializedState,
  verifyStateSnapshot,
} from "./backup";
import { acquireRestoreLock } from "./runtime-lock";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

interface RestoreStateOptions {
  statePaths: StatePaths;
  snapshotDirectory: string;
  replace: boolean;
}

interface RestoreStateOperations {
  afterStageBuilt?: (stagingDirectory: string) => Promise<void> | void;
  renamePath?: (source: string, destination: string) => Promise<void>;
  removePath?: (target: string) => Promise<void>;
}

interface RestoreStateResult {
  stateDirectory: string;
  rollbackSnapshotDirectory: string | null;
  retainedPreviousStateDirectory: string | null;
}

export class StateRestoreRecoveryError extends Error {
  constructor(
    readonly displacedStateDirectory: string,
    readonly rollbackSnapshotDirectory: string | null,
    readonly recoveryStagingDirectory: string,
    options: ErrorOptions
  ) {
    super(
      `Restore failed and automatic recovery could not reactivate local state. ` +
        `Previous state: ${displacedStateDirectory}. ` +
        `Rollback snapshot: ${rollbackSnapshotDirectory ?? "not available"}. ` +
        `Recovery staging: ${recoveryStagingDirectory}.`,
      options
    );
    this.name = "StateRestoreRecoveryError";
  }
}

export class StateRestoreCleanupError extends Error {
  constructor(
    readonly activeStateDirectory: string,
    readonly retainedDirectory: string,
    options: ErrorOptions
  ) {
    super(
      `Restore activation failed, but the prior state was recovered at ${activeStateDirectory}. ` +
        `Cleanup remains at ${retainedDirectory}.`,
      options
    );
    this.name = "StateRestoreCleanupError";
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function canonicalizeExistingOrFuturePath(filePath: string): Promise<string> {
  let existingAncestor = path.resolve(filePath);
  const missingSegments: string[] = [];
  while (!(await exists(existingAncestor))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error("Unable to resolve the local state path");
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  return path.join(await realpath(existingAncestor), ...missingSegments);
}

async function copySecureTree(source: string, destination: string): Promise<void> {
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) {
    throw new Error("Application state cannot contain symbolic links during restore");
  }
  if (sourceStat.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true, mode: DIRECTORY_MODE });
    await copyFile(source, destination);
    await chmod(destination, FILE_MODE);
    return;
  }
  if (!sourceStat.isDirectory()) {
    throw new Error("Application state can contain only regular files and directories");
  }

  await mkdir(destination, { recursive: true, mode: DIRECTORY_MODE });
  await chmod(destination, DIRECTORY_MODE);
  for (const entry of await readdir(source)) {
    await copySecureTree(path.join(source, entry), path.join(destination, entry));
  }
}

async function materializeSnapshot(
  snapshot: VerifiedStateSnapshot,
  stagingDirectory: string
): Promise<void> {
  await mkdir(stagingDirectory, { mode: DIRECTORY_MODE });
  for (const relativeDirectory of snapshot.manifest.uploadDirectories) {
    const destination = path.resolve(stagingDirectory, relativeDirectory);
    if (!isWithin(stagingDirectory, destination)) {
      throw new Error("Snapshot upload directory escapes the restore staging directory");
    }
    await mkdir(destination, { recursive: true, mode: DIRECTORY_MODE });
    await chmod(destination, DIRECTORY_MODE);
  }

  for (const artifact of snapshot.manifest.artifacts) {
    const source = path.resolve(snapshot.snapshotDirectory, artifact.path);
    const destination = path.resolve(stagingDirectory, artifact.path);
    if (
      !isWithin(snapshot.snapshotDirectory, source) ||
      !isWithin(stagingDirectory, destination)
    ) {
      throw new Error("Snapshot artifact escapes the restore staging directory");
    }
    await mkdir(path.dirname(destination), { recursive: true, mode: DIRECTORY_MODE });
    await copyFile(source, destination);
    await chmod(destination, FILE_MODE);
  }
}

async function preserveNestedDevelopmentState(
  statePaths: StatePaths,
  stagingDirectory: string
): Promise<void> {
  if (statePaths.environment !== "production") return;
  const developmentDirectory = path.join(statePaths.stateDirectory, "dev");
  if (!(await exists(developmentDirectory))) return;
  await copySecureTree(developmentDirectory, path.join(stagingDirectory, "dev"));
}

function rollbackSnapshotPath(statePaths: StatePaths): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  return path.join(
    path.dirname(statePaths.rootStateDirectory),
    `${path.basename(statePaths.rootStateDirectory)}.rollback-${statePaths.environment}-${timestamp}-${randomUUID()}`
  );
}

async function assertExistingStateIsRecoverable(
  statePaths: StatePaths,
  targetExists: boolean,
  currentDatabaseExists: boolean
): Promise<void> {
  if (!targetExists || currentDatabaseExists) return;
  const entries = await readdir(statePaths.stateDirectory);
  const allowedEntries = statePaths.environment === "production" ? new Set(["dev"]) : new Set();
  if (entries.some((entry) => !allowedEntries.has(entry))) {
    throw new Error(
      "Existing local state is incomplete and cannot be replaced without a rollback database"
    );
  }
}

async function buildRollbackRecoveryState(
  rollbackSnapshotDirectory: string,
  recoveryDirectory: string,
  statePaths: StatePaths,
  displacedDirectory: string
): Promise<void> {
  const rollback = await verifyStateSnapshot(rollbackSnapshotDirectory);
  await materializeSnapshot(rollback, recoveryDirectory);
  if (
    statePaths.environment === "production" &&
    await exists(path.join(displacedDirectory, "dev"))
  ) {
    await copySecureTree(
      path.join(displacedDirectory, "dev"),
      path.join(recoveryDirectory, "dev")
    );
  }
  await verifyMaterializedState(recoveryDirectory, rollback.manifest);
}

export async function restoreState(
  { statePaths, snapshotDirectory, replace }: RestoreStateOptions,
  operations: RestoreStateOperations = {}
): Promise<RestoreStateResult> {
  if (!replace) {
    throw new Error("State restore requires the explicit --replace flag");
  }

  const targetDirectory = path.resolve(statePaths.stateDirectory);
  const snapshot = await verifyStateSnapshot(snapshotDirectory);
  if (snapshot.manifest.environment !== statePaths.environment) {
    throw new Error("Snapshot environment does not match the requested restore environment");
  }

  const targetExists = await exists(targetDirectory);
  if (targetExists) {
    const targetStat = await lstat(targetDirectory);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
      throw new Error("Application state path must be a regular directory");
    }
  }
  const canonicalStateRoot = await canonicalizeExistingOrFuturePath(
    statePaths.rootStateDirectory
  );
  if (
    isWithin(canonicalStateRoot, snapshot.snapshotDirectory) ||
    isWithin(snapshot.snapshotDirectory, canonicalStateRoot)
  ) {
    throw new Error("Restore snapshot must be stored outside the top-level state directory");
  }

  const releaseRestoreLock = await acquireRestoreLock(statePaths.coordinationDirectory);
  try {
    return await restoreStateUnderLock(
      statePaths,
      targetDirectory,
      snapshot,
      operations
    );
  } finally {
    await releaseRestoreLock();
  }
}

async function restoreStateUnderLock(
  statePaths: StatePaths,
  targetDirectory: string,
  snapshot: VerifiedStateSnapshot,
  operations: RestoreStateOperations
): Promise<RestoreStateResult> {
  const targetExists = await exists(targetDirectory);
  const currentDatabaseExists = await exists(statePaths.databasePath);
  await assertExistingStateIsRecoverable(statePaths, targetExists, currentDatabaseExists);
  let rollbackSnapshotDirectory: string | null = null;
  if (currentDatabaseExists) {
    rollbackSnapshotDirectory = rollbackSnapshotPath(statePaths);
    await createStateSnapshot({
      statePaths,
      outputDirectory: rollbackSnapshotDirectory,
    });
  }

  await mkdir(path.dirname(targetDirectory), { recursive: true, mode: DIRECTORY_MODE });
  const stagingDirectory = path.join(
    path.dirname(targetDirectory),
    `.${path.basename(targetDirectory)}.restore-${randomUUID()}`
  );
  const displacedDirectory = path.join(
    path.dirname(targetDirectory),
    `.${path.basename(targetDirectory)}.displaced-${randomUUID()}`
  );
  const renamePath = operations.renamePath ?? rename;
  const removePath =
    operations.removePath ??
    ((target: string) => rm(target, { recursive: true, force: true }));

  try {
    await materializeSnapshot(snapshot, stagingDirectory);
    await preserveNestedDevelopmentState(statePaths, stagingDirectory);
    await operations.afterStageBuilt?.(stagingDirectory);
    await verifyMaterializedState(stagingDirectory, snapshot.manifest);

    let targetMoved = false;
    try {
      if (targetExists) {
        await renamePath(targetDirectory, displacedDirectory);
        targetMoved = true;
      }
      await renamePath(stagingDirectory, targetDirectory);
    } catch (switchError) {
      if (targetMoved) {
        try {
          await renamePath(displacedDirectory, targetDirectory);
        } catch {
          if (rollbackSnapshotDirectory === null) {
            try {
              await renamePath(displacedDirectory, targetDirectory);
            } catch (finalRollbackError) {
              throw new StateRestoreRecoveryError(
                displacedDirectory,
                null,
                stagingDirectory,
                { cause: finalRollbackError }
              );
            }
            throw switchError;
          }
          const recoveryDirectory = path.join(
            path.dirname(targetDirectory),
            `.${path.basename(targetDirectory)}.recovery-${randomUUID()}`
          );
          try {
            await buildRollbackRecoveryState(
              rollbackSnapshotDirectory,
              recoveryDirectory,
              statePaths,
              displacedDirectory
            );
            await renamePath(recoveryDirectory, targetDirectory);
          } catch {
            try {
              await renamePath(displacedDirectory, targetDirectory);
            } catch (finalRollbackError) {
              throw new StateRestoreRecoveryError(
                displacedDirectory,
                rollbackSnapshotDirectory,
                recoveryDirectory,
                { cause: finalRollbackError }
              );
            }
            const retainedRecoveryDirectory = await removePath(recoveryDirectory)
              .then(() => null)
              .catch(() => recoveryDirectory);
            if (retainedRecoveryDirectory) {
              throw new StateRestoreCleanupError(
                targetDirectory,
                retainedRecoveryDirectory,
                { cause: switchError }
              );
            }
            throw switchError;
          }

          const retainedDisplacedDirectory = await removePath(displacedDirectory)
            .then(() => null)
            .catch(() => displacedDirectory);
          if (retainedDisplacedDirectory) {
            throw new StateRestoreCleanupError(
              targetDirectory,
              retainedDisplacedDirectory,
              { cause: switchError }
            );
          }
        }
      }
      throw switchError;
    }

    const retainedPreviousStateDirectory = await removePath(displacedDirectory)
      .then(() => null)
      .catch(() => displacedDirectory);
    return {
      stateDirectory: targetDirectory,
      rollbackSnapshotDirectory,
      retainedPreviousStateDirectory,
    };
  } catch (error) {
    const mustPreserveStaging =
      error instanceof StateRestoreRecoveryError &&
      error.recoveryStagingDirectory === stagingDirectory;
    if (!mustPreserveStaging) {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
    throw error;
  }
}
