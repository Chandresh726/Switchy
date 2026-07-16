import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { migrateLocalDatabase } from "@/lib/db/migrations";
import {
  createStateSnapshot,
  verifyStateSnapshot,
} from "@/lib/state/backup";
import { statePathsFromDirectory } from "@/lib/state/environment-paths";
import {
  restoreState,
  StateRestoreCleanupError,
  StateRestoreRecoveryError,
} from "@/lib/state/restore";
import { acquireRestoreLock, registerRuntimeLock } from "@/lib/state/runtime-lock";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "switchy-state-backup-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createState(
  directory: string,
  value: string,
  options: { secret?: string } = { secret: "secret-value" }
) {
  const paths = statePathsFromDirectory("production", directory);
  mkdirSync(join(paths.uploadsDirectory, "resumes", "empty"), { recursive: true, mode: 0o700 });
  writeFileSync(join(paths.uploadsDirectory, "resumes", "resume.txt"), `upload-${value}`, {
    mode: 0o600,
  });
  if (options.secret !== undefined) {
    writeFileSync(paths.encryptionSecretPath, options.secret, { mode: 0o600 });
  }

  const connection = new Database(paths.databasePath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  const database = drizzle(connection, { schema });
  migrateLocalDatabase(database, join(process.cwd(), "drizzle"));
  database.insert(schema.settings).values({ key: "backup-test", value }).run();
  connection.close();
  return paths;
}

function readDatabaseValue(databasePath: string): string {
  const connection = new Database(databasePath, { readonly: true });
  try {
    const database = drizzle(connection, { schema });
    const row = database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, "backup-test"))
      .get();
    if (!row?.value) throw new Error("Missing backup test value");
    return row.value;
  } finally {
    connection.close();
  }
}

function rewriteManifestChecksum(snapshotDirectory: string, artifactPath: string): void {
  const manifestPath = join(snapshotDirectory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    artifacts: Array<{ path: string; size: number; sha256: string }>;
  };
  const contents = readFileSync(join(snapshotDirectory, artifactPath));
  const artifact = manifest.artifacts.find((candidate) => candidate.path === artifactPath);
  if (!artifact) throw new Error("Missing test artifact");
  artifact.size = contents.byteLength;
  artifact.sha256 = createHash("sha256").update(contents).digest("hex");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("verified local state backup and restore", () => {
  it("round-trips the database, uploads, empty directories, and encryption secret", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    mkdirSync(join(statePaths.stateDirectory, "dev"), { mode: 0o700 });
    writeFileSync(join(statePaths.stateDirectory, "dev", "preserved.txt"), "development");
    const snapshotDirectory = join(root, "snapshot");

    const snapshot = await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
    expect(snapshot.manifest.environment).toBe("production");
    expect(snapshot.manifest.paths.encryptionSecret).toBe("encryption.secret");

    const current = new Database(statePaths.databasePath);
    drizzle(current, { schema })
      .update(schema.settings)
      .set({ value: "after" })
      .where(eq(schema.settings.key, "backup-test"))
      .run();
    current.close();
    writeFileSync(join(statePaths.uploadsDirectory, "resumes", "resume.txt"), "upload-after");
    writeFileSync(statePaths.encryptionSecretPath, "new-secret");

    const restored = await restoreState({
      statePaths,
      snapshotDirectory,
      replace: true,
    });

    expect(readDatabaseValue(statePaths.databasePath)).toBe("before");
    expect(readFileSync(join(statePaths.uploadsDirectory, "resumes", "resume.txt"), "utf8"))
      .toBe("upload-before");
    expect(readFileSync(statePaths.encryptionSecretPath, "utf8")).toBe("secret-value");
    expect(statSync(join(statePaths.uploadsDirectory, "resumes", "empty")).isDirectory()).toBe(true);
    expect(readFileSync(join(statePaths.stateDirectory, "dev", "preserved.txt"), "utf8"))
      .toBe("development");
    expect(statSync(statePaths.stateDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(statePaths.databasePath).mode & 0o777).toBe(0o600);
    expect(restored.rollbackSnapshotDirectory).not.toBeNull();
    const rollback = await verifyStateSnapshot(restored.rollbackSnapshotDirectory!);
    expect(readDatabaseValue(join(rollback.snapshotDirectory, "switchy.db"))).toBe("after");
  });

  it("supports snapshots without an encryption secret and removes an existing secret", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "source", { secret: undefined });
    const snapshotDirectory = join(root, "snapshot");
    const snapshot = await createStateSnapshot({
      statePaths: sourcePaths,
      outputDirectory: snapshotDirectory,
    });
    expect(snapshot.manifest.paths.encryptionSecret).toBeNull();

    const targetPaths = createState(join(root, "target"), "target");
    await restoreState({ statePaths: targetPaths, snapshotDirectory, replace: true });
    expect(existsSync(targetPaths.encryptionSecretPath)).toBe(false);
    expect(readDatabaseValue(targetPaths.databasePath)).toBe("source");
  });

  it("restores into a fresh environment whose top-level state root does not exist", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = statePathsFromDirectory(
      "production",
      join(root, "fresh", ".switchy")
    );
    expect(existsSync(targetPaths.rootStateDirectory)).toBe(false);

    const result = await restoreState({ statePaths: targetPaths, snapshotDirectory, replace: true });
    expect(result.rollbackSnapshotDirectory).toBeNull();
    expect(readDatabaseValue(targetPaths.databasePath)).toBe("snapshot");
    expect(statSync(targetPaths.stateDirectory).mode & 0o777).toBe(0o700);
  });

  it("rejects a tampered artifact checksum", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
    writeFileSync(join(snapshotDirectory, "uploads", "resumes", "resume.txt"), "tampered");

    await expect(verifyStateSnapshot(snapshotDirectory)).rejects.toThrow("checksum validation");
  });

  it("captures committed WAL changes while the source connection remains open", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    const connection = new Database(statePaths.databasePath);
    connection.pragma("journal_mode = WAL");
    drizzle(connection, { schema })
      .update(schema.settings)
      .set({ value: "wal-value" })
      .where(eq(schema.settings.key, "backup-test"))
      .run();
    const snapshotDirectory = join(root, "snapshot");

    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
    connection.close();

    expect(readDatabaseValue(join(snapshotDirectory, "switchy.db"))).toBe("wal-value");
    expect(existsSync(join(snapshotDirectory, "switchy.db-wal"))).toBe(false);
    expect(existsSync(join(snapshotDirectory, "switchy.db-shm"))).toBe(false);
  });

  it("rejects a concurrent resume upload that would orphan a copied file", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    const snapshotDirectory = join(root, "snapshot");

    await expect(createStateSnapshot(
      { statePaths, outputDirectory: snapshotDirectory },
      {
        afterDatabaseSnapshot() {
          writeFileSync(
            join(statePaths.uploadsDirectory, "resumes", "concurrent.pdf"),
            "concurrent resume"
          );
          const connection = new Database(statePaths.databasePath);
          const database = drizzle(connection, { schema });
          const localProfile = database.insert(schema.profile)
            .values({ name: "Concurrent Upload User" }).returning().get();
          database.insert(schema.resumes).values({
            profileId: localProfile.id,
            fileName: "concurrent.pdf",
            filePath: "resumes/concurrent.pdf",
            parsedData: "null",
            version: 1,
            isCurrent: true,
            storageState: "ready",
          }).run();
          connection.close();
        },
      }
    )).rejects.toThrow("state changed while uploads were being copied");
    expect(existsSync(snapshotDirectory)).toBe(false);
  });

  it("rejects a concurrent resume deletion that would leave a stale database reference", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    const connection = new Database(statePaths.databasePath);
    const database = drizzle(connection, { schema });
    const localProfile = database.insert(schema.profile)
      .values({ name: "Concurrent Delete User" }).returning().get();
    const resume = database.insert(schema.resumes).values({
      profileId: localProfile.id,
      fileName: "resume.txt",
      filePath: "resumes/resume.txt",
      parsedData: "null",
      version: 1,
      isCurrent: true,
      storageState: "ready",
    }).returning().get();
    connection.close();
    const snapshotDirectory = join(root, "snapshot");

    await expect(createStateSnapshot(
      { statePaths, outputDirectory: snapshotDirectory },
      {
        afterDatabaseSnapshot() {
          const concurrentConnection = new Database(statePaths.databasePath);
          drizzle(concurrentConnection, { schema }).delete(schema.resumes)
            .where(eq(schema.resumes.id, resume.id)).run();
          concurrentConnection.close();
          unlinkSync(join(statePaths.uploadsDirectory, "resumes", "resume.txt"));
        },
      }
    )).rejects.toThrow("state changed while uploads were being copied");
    expect(existsSync(snapshotDirectory)).toBe(false);
  });

  it("rejects a checksummed snapshot that omits a database-referenced ready resume", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    const connection = new Database(statePaths.databasePath);
    const database = drizzle(connection, { schema });
    const localProfile = database.insert(schema.profile).values({ name: "Backup User" })
      .returning().get();
    database.insert(schema.resumes).values({
      profileId: localProfile.id,
      fileName: "resume.txt",
      filePath: "resumes/resume.txt",
      parsedData: "null",
      version: 1,
      isCurrent: true,
      storageState: "ready",
    }).run();
    connection.close();
    const snapshotDirectory = join(root, "snapshot");

    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
    unlinkSync(join(snapshotDirectory, "uploads", "resumes", "resume.txt"));
    const manifestPath = join(snapshotDirectory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      artifacts: Array<{ path: string }>;
    };
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => artifact.path !== "uploads/resumes/resume.txt"
    );
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    await expect(verifyStateSnapshot(snapshotDirectory)).rejects.toThrow(
      "database-referenced resume upload"
    );
  });

  it("rejects path traversal metadata and symbolic links", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
    const manifestPath = join(snapshotDirectory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      paths: { database: string };
    };
    manifest.paths.database = "../outside.db";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await expect(verifyStateSnapshot(snapshotDirectory)).rejects.toThrow("manifest is invalid");

    const linkedStatePaths = createState(join(root, "linked"), "linked");
    symlinkSync(
      join(linkedStatePaths.uploadsDirectory, "resumes", "resume.txt"),
      join(linkedStatePaths.uploadsDirectory, "linked-resume.txt")
    );
    await expect(
      createStateSnapshot({
        statePaths: linkedStatePaths,
        outputDirectory: join(root, "linked-snapshot"),
      })
    ).rejects.toThrow("symbolic links");
  });

  it.each(["manifest.json", "switchy.db", "uploads", "encryption.secret"])(
    "rejects a snapshot with missing %s",
    async (relativePath) => {
      const root = temporaryDirectory();
      const statePaths = createState(join(root, "current"), "before");
      const snapshotDirectory = join(root, "snapshot");
      await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
      rmSync(join(snapshotDirectory, relativePath), { recursive: true, force: true });

      await expect(verifyStateSnapshot(snapshotDirectory)).rejects.toThrow();
    }
  );

  it("refuses restore without --replace before changing current state", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "current");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });

    await expect(
      restoreState({ statePaths, snapshotDirectory, replace: false })
    ).rejects.toThrow("--replace");
    expect(readDatabaseValue(statePaths.databasePath)).toBe("current");
  });

  it("leaves current state unchanged when staged validation fails", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = createState(join(root, "target"), "current");

    await expect(
      restoreState(
        { statePaths: targetPaths, snapshotDirectory, replace: true },
        {
          afterStageBuilt(stagingDirectory) {
            writeFileSync(join(stagingDirectory, "switchy.db"), "not sqlite");
          },
        }
      )
    ).rejects.toThrow("checksum validation");
    expect(readDatabaseValue(targetPaths.databasePath)).toBe("current");
  });

  it("restores the original directory when the atomic activation rename fails", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = createState(join(root, "target"), "current");
    let renameCalls = 0;

    await expect(
      restoreState(
        { statePaths: targetPaths, snapshotDirectory, replace: true },
        {
          async renamePath(source, destination) {
            renameCalls += 1;
            if (renameCalls === 2) throw new Error("injected activation failure");
            const { rename } = await import("node:fs/promises");
            await rename(source, destination);
          },
        }
      )
    ).rejects.toThrow("injected activation failure");
    expect(readDatabaseValue(targetPaths.databasePath)).toBe("current");
  });

  it("materializes the rollback snapshot when direct directory rollback also fails", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = createState(join(root, "target"), "current");
    let renameCalls = 0;

    await expect(
      restoreState(
        { statePaths: targetPaths, snapshotDirectory, replace: true },
        {
          async renamePath(source, destination) {
            renameCalls += 1;
            if (renameCalls === 2 || renameCalls === 3) {
              throw new Error("injected switch failure");
            }
            const { rename } = await import("node:fs/promises");
            await rename(source, destination);
          },
        }
      )
    ).rejects.toThrow("injected switch failure");
    expect(renameCalls).toBe(4);
    expect(readDatabaseValue(targetPaths.databasePath)).toBe("current");
  });

  it("retries the displaced directory when rollback-snapshot activation fails", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = createState(join(root, "target"), "current");
    let renameCalls = 0;

    await expect(
      restoreState(
        { statePaths: targetPaths, snapshotDirectory, replace: true },
        {
          async renamePath(source, destination) {
            renameCalls += 1;
            if ([2, 3, 4].includes(renameCalls)) {
              throw new Error("injected repeated switch failure");
            }
            const { rename } = await import("node:fs/promises");
            await rename(source, destination);
          },
        }
      )
    ).rejects.toThrow("injected repeated switch failure");
    expect(renameCalls).toBe(5);
    expect(readDatabaseValue(targetPaths.databasePath)).toBe("current");
  });

  it("surfaces every recovery location if repeated filesystem renames all fail", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = createState(join(root, "target"), "current");
    let renameCalls = 0;
    let caught: unknown;

    try {
      await restoreState(
        { statePaths: targetPaths, snapshotDirectory, replace: true },
        {
          async renamePath(source, destination) {
            renameCalls += 1;
            if (renameCalls >= 2) throw new Error("filesystem unavailable");
            const { rename } = await import("node:fs/promises");
            await rename(source, destination);
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StateRestoreRecoveryError);
    const recoveryError = caught as StateRestoreRecoveryError;
    expect(existsSync(recoveryError.displacedStateDirectory)).toBe(true);
    expect(existsSync(recoveryError.rollbackSnapshotDirectory!)).toBe(true);
    expect(existsSync(recoveryError.recoveryStagingDirectory)).toBe(true);
    expect(recoveryError.message).toContain(recoveryError.displacedStateDirectory);
    expect(recoveryError.message).toContain(recoveryError.rollbackSnapshotDirectory!);
  });

  it("preserves restored staging when a no-database target cannot be reactivated", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = statePathsFromDirectory("production", join(root, "empty-target"));
    mkdirSync(targetPaths.stateDirectory, { mode: 0o700 });
    let renameCalls = 0;
    let caught: unknown;

    try {
      await restoreState(
        { statePaths: targetPaths, snapshotDirectory, replace: true },
        {
          async renamePath(source, destination) {
            renameCalls += 1;
            if (renameCalls >= 2) throw new Error("filesystem unavailable");
            const { rename } = await import("node:fs/promises");
            await rename(source, destination);
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StateRestoreRecoveryError);
    const recoveryError = caught as StateRestoreRecoveryError;
    expect(recoveryError.rollbackSnapshotDirectory).toBeNull();
    expect(existsSync(recoveryError.displacedStateDirectory)).toBe(true);
    expect(existsSync(recoveryError.recoveryStagingDirectory)).toBe(true);
    expect(readDatabaseValue(join(recoveryError.recoveryStagingDirectory, "switchy.db")))
      .toBe("snapshot");
  });

  it("reports retained cleanup separately after rollback state is active", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = createState(join(root, "target"), "current");
    let renameCalls = 0;
    let caught: unknown;

    try {
      await restoreState(
        { statePaths: targetPaths, snapshotDirectory, replace: true },
        {
          async renamePath(source, destination) {
            renameCalls += 1;
            if (renameCalls === 2 || renameCalls === 3) {
              throw new Error("injected activation failure");
            }
            const { rename } = await import("node:fs/promises");
            await rename(source, destination);
          },
          async removePath() {
            throw new Error("injected cleanup failure");
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StateRestoreCleanupError);
    expect(caught).not.toBeInstanceOf(StateRestoreRecoveryError);
    const cleanupError = caught as StateRestoreCleanupError;
    expect(readDatabaseValue(targetPaths.databasePath)).toBe("current");
    expect(existsSync(cleanupError.retainedDirectory)).toBe(true);
  });

  it("refuses restore while an active runtime lock is present", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "current");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
    mkdirSync(statePaths.coordinationDirectory, { mode: 0o700 });
    const lockPath = join(
      statePaths.coordinationDirectory,
      `.switchy-runtime-${process.pid}.json`
    );
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { mode: 0o600 }
    );

    await expect(
      restoreState({ statePaths, snapshotDirectory, replace: true })
    ).rejects.toThrow("Stop the application");
    unlinkSync(lockPath);
  });

  it("holds an exclusive restore lock that prevents application startup races", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "current");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });

    await restoreState(
      { statePaths, snapshotDirectory, replace: true },
      {
        afterStageBuilt() {
          expect(() => registerRuntimeLock(statePaths.coordinationDirectory)).toThrow(
            "restore is in progress"
          );
        },
      }
    );
    expect(existsSync(join(statePaths.coordinationDirectory, "restore.lock"))).toBe(false);
  });

  it("recovers an ownerless restore lock without wedging future operations", async () => {
    const root = temporaryDirectory();
    const coordinationDirectory = join(root, "coordination");
    mkdirSync(join(coordinationDirectory, "restore.lock"), { recursive: true, mode: 0o700 });

    const release = await acquireRestoreLock(coordinationDirectory);
    expect(existsSync(join(coordinationDirectory, "restore.lock", "owner.json"))).toBe(true);
    await release();
    expect(existsSync(join(coordinationDirectory, "restore.lock"))).toBe(false);
  });

  it("rejects a snapshot reached through a symlinked ancestor inside current state", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "current");
    const outsideSnapshot = join(root, "outside-snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: outsideSnapshot });
    const embeddedSnapshot = join(statePaths.stateDirectory, "embedded-snapshot");
    const { renameSync } = await import("node:fs");
    renameSync(outsideSnapshot, embeddedSnapshot);
    const alias = join(root, "state-alias");
    symlinkSync(statePaths.stateDirectory, alias);

    await expect(
      restoreState({
        statePaths,
        snapshotDirectory: join(alias, "embedded-snapshot"),
        replace: true,
      })
    ).rejects.toThrow("outside the top-level state");
    expect(readDatabaseValue(statePaths.databasePath)).toBe("current");
  });

  it("rejects incomplete existing state that has no rollback database", async () => {
    const root = temporaryDirectory();
    const sourcePaths = createState(join(root, "source"), "snapshot");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });
    const targetPaths = statePathsFromDirectory("production", join(root, "target"));
    mkdirSync(targetPaths.uploadsDirectory, { recursive: true });
    writeFileSync(join(targetPaths.uploadsDirectory, "orphan.txt"), "preserve me");

    await expect(
      restoreState({ statePaths: targetPaths, snapshotDirectory, replace: true })
    ).rejects.toThrow("incomplete");
    expect(readFileSync(join(targetPaths.uploadsDirectory, "orphan.txt"), "utf8"))
      .toBe("preserve me");
  });

  it("places development rollback snapshots outside the top-level state root", async () => {
    const root = temporaryDirectory();
    const productionRoot = join(root, ".switchy");
    const statePaths = createState(join(productionRoot, "dev"), "current");
    statePaths.environment = "development";
    statePaths.rootStateDirectory = productionRoot;
    statePaths.coordinationDirectory = `${productionRoot}.coordination`;
    const sourcePaths = createState(join(root, "source-dev"), "snapshot");
    sourcePaths.environment = "development";
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths: sourcePaths, outputDirectory: snapshotDirectory });

    const result = await restoreState({ statePaths, snapshotDirectory, replace: true });
    expect(result.rollbackSnapshotDirectory).not.toBeNull();
    expect(result.rollbackSnapshotDirectory!.startsWith(`${productionRoot}/`)).toBe(false);
    expect(readDatabaseValue(statePaths.databasePath)).toBe("snapshot");
  });

  it("rejects development snapshots anywhere inside the top-level state root", async () => {
    const root = temporaryDirectory();
    const productionRoot = join(root, ".switchy");
    const developmentDirectory = join(productionRoot, "dev");
    const statePaths = createState(developmentDirectory, "current");
    statePaths.environment = "development";
    statePaths.rootStateDirectory = productionRoot;
    statePaths.coordinationDirectory = `${productionRoot}.coordination`;

    await expect(
      createStateSnapshot({
        statePaths,
        outputDirectory: join(productionRoot, "unsafe-snapshot"),
      })
    ).rejects.toThrow("overlap");

    const outsideSnapshot = join(root, "outside-snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: outsideSnapshot });
    const embeddedSnapshot = join(productionRoot, "embedded-snapshot");
    const { renameSync } = await import("node:fs");
    renameSync(outsideSnapshot, embeddedSnapshot);
    await expect(
      restoreState({ statePaths, snapshotDirectory: embeddedSnapshot, replace: true })
    ).rejects.toThrow("top-level state");
    expect(readDatabaseValue(statePaths.databasePath)).toBe("current");
  });

  it("rejects database foreign-key corruption even with a matching checksum", async () => {
    const root = temporaryDirectory();
    const statePaths = createState(join(root, "current"), "before");
    const snapshotDirectory = join(root, "snapshot");
    await createStateSnapshot({ statePaths, outputDirectory: snapshotDirectory });
    const databasePath = join(snapshotDirectory, "switchy.db");
    chmodSync(databasePath, 0o600);
    const connection = new Database(databasePath);
    connection.pragma("foreign_keys = OFF");
    drizzle(connection, { schema })
      .insert(schema.resumes)
      .values({
        profileId: 999,
        fileName: "invalid.pdf",
        filePath: "resumes/invalid.pdf",
        parsedData: "{}",
        version: 1,
        isCurrent: false,
      })
      .run();
    connection.close();
    rewriteManifestChecksum(snapshotDirectory, "switchy.db");

    await expect(verifyStateSnapshot(snapshotDirectory)).rejects.toThrow("foreign-key");
  });
});
