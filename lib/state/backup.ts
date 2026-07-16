import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import packageJson from "@/package.json";

import type { StatePaths } from "./environment-paths";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MANIFEST_FILE = "manifest.json";
const DATABASE_FILE = "switchy.db";
const UPLOADS_DIRECTORY = "uploads";
const SECRET_FILE = "encryption.secret";

const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .refine((value) => !path.isAbsolute(value), "Artifact paths must be relative")
  .refine(
    (value) => !value.split(/[\\/]/u).some((segment) => segment === ".."),
    "Artifact paths cannot traverse outside the snapshot"
  )
  .refine((value) => !value.includes("\\"), "Artifact paths must use forward slashes");

const artifactSchema = z.object({
  path: relativeArtifactPathSchema,
  kind: z.enum(["database", "upload", "encryption-secret"]),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const stateSnapshotManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    applicationVersion: z.string().min(1),
    environment: z.enum(["production", "development"]),
    createdAt: z.iso.datetime(),
    paths: z.object({
      database: relativeArtifactPathSchema,
      uploads: relativeArtifactPathSchema,
      encryptionSecret: relativeArtifactPathSchema.nullable(),
    }),
    uploadDirectories: z.array(relativeArtifactPathSchema).min(1),
    artifacts: z.array(artifactSchema).min(1),
  })
  .superRefine((manifest, context) => {
    if (
      manifest.paths.database !== DATABASE_FILE ||
      manifest.paths.uploads !== UPLOADS_DIRECTORY ||
      (manifest.paths.encryptionSecret !== null &&
        manifest.paths.encryptionSecret !== SECRET_FILE)
    ) {
      context.addIssue({ code: "custom", message: "Manifest uses unsupported artifact paths" });
    }

    const artifactPaths = manifest.artifacts.map((artifact) => artifact.path);
    if (new Set(artifactPaths).size !== artifactPaths.length) {
      context.addIssue({ code: "custom", message: "Artifact paths must be unique" });
    }
    if (
      new Set(manifest.uploadDirectories).size !== manifest.uploadDirectories.length ||
      !manifest.uploadDirectories.includes(manifest.paths.uploads) ||
      manifest.uploadDirectories.some(
        (directory) =>
          directory !== manifest.paths.uploads &&
          !directory.startsWith(`${manifest.paths.uploads}/`)
      )
    ) {
      context.addIssue({ code: "custom", message: "Upload directory metadata is invalid" });
    }

    const databaseArtifacts = manifest.artifacts.filter((artifact) => artifact.kind === "database");
    if (databaseArtifacts.length !== 1 || databaseArtifacts[0]?.path !== manifest.paths.database) {
      context.addIssue({
        code: "custom",
        message: "Manifest must contain exactly one database artifact",
      });
    }

    const secretArtifacts = manifest.artifacts.filter(
      (artifact) => artifact.kind === "encryption-secret"
    );
    if (
      (manifest.paths.encryptionSecret === null && secretArtifacts.length !== 0) ||
      (manifest.paths.encryptionSecret !== null &&
        (secretArtifacts.length !== 1 ||
          secretArtifacts[0]?.path !== manifest.paths.encryptionSecret))
    ) {
      context.addIssue({
        code: "custom",
        message: "Encryption-secret metadata is inconsistent",
      });
    }

    const uploadsPrefix = `${manifest.paths.uploads}/`;
    if (
      manifest.artifacts.some(
        (artifact) => artifact.kind === "upload" && !artifact.path.startsWith(uploadsPrefix)
      )
    ) {
      context.addIssue({ code: "custom", message: "Upload artifacts must be inside uploads" });
    }
  });

export type StateSnapshotManifest = z.infer<typeof stateSnapshotManifestSchema>;
type SnapshotArtifact = StateSnapshotManifest["artifacts"][number];

interface CreateStateSnapshotOptions {
  statePaths: StatePaths;
  outputDirectory: string;
  applicationVersion?: string;
}

export interface VerifiedStateSnapshot {
  snapshotDirectory: string;
  manifest: StateSnapshotManifest;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveSnapshotPath(snapshotDirectory: string, relativePath: string): string {
  const resolved = path.resolve(snapshotDirectory, relativePath);
  if (!isWithin(snapshotDirectory, resolved) || resolved === path.resolve(snapshotDirectory)) {
    throw new Error("Snapshot artifact path escapes the snapshot directory");
  }
  return resolved;
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  const fileStat = await lstat(filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
}

async function assertDirectory(directoryPath: string, label: string): Promise<void> {
  const directoryStat = await lstat(directoryPath).catch(() => null);
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`${label} must be a directory`);
  }
}

async function hashFile(filePath: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    hash.update(buffer);
  }
  return {
    size,
    sha256: hash.digest("hex"),
  };
}

async function copyArtifact(
  sourcePath: string,
  destinationPath: string,
  relativePath: string,
  kind: SnapshotArtifact["kind"]
): Promise<SnapshotArtifact> {
  await assertRegularFile(sourcePath, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true, mode: DIRECTORY_MODE });
  await copyFile(sourcePath, destinationPath);
  await chmod(destinationPath, FILE_MODE);
  return { path: relativePath, kind, ...(await hashFile(destinationPath)) };
}

async function copyUploads(
  sourceDirectory: string,
  destinationDirectory: string,
  directories: string[],
  relativeDirectory = UPLOADS_DIRECTORY
): Promise<SnapshotArtifact[]> {
  await assertDirectory(sourceDirectory, "Uploads path");
  await mkdir(destinationDirectory, { recursive: true, mode: DIRECTORY_MODE });
  await chmod(destinationDirectory, DIRECTORY_MODE);
  directories.push(relativeDirectory);

  const artifacts: SnapshotArtifact[] = [];
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Uploads cannot contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      artifacts.push(...(await copyUploads(sourcePath, destinationPath, directories, relativePath)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Uploads can contain only regular files: ${relativePath}`);
    }
    artifacts.push(await copyArtifact(sourcePath, destinationPath, relativePath, "upload"));
  }
  return artifacts;
}

export async function validateStateDatabase(databasePath: string): Promise<void> {
  await assertRegularFile(databasePath, "Snapshot database");
  const connection = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    connection.pragma("query_only = ON");
    const schemaEntries = connection.pragma("table_list") as Array<{ name: string }>;
    if (!schemaEntries.some((entry) => !entry.name.startsWith("sqlite_"))) {
      throw new Error("Snapshot database does not contain a readable application schema");
    }
    const integrity = connection.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new Error("Snapshot database failed SQLite integrity validation");
    }
    const foreignKeyFailures = connection.pragma("foreign_key_check") as unknown[];
    if (foreignKeyFailures.length > 0) {
      throw new Error("Snapshot database failed foreign-key validation");
    }
  } finally {
    connection.close();
  }
}

async function listSnapshotFiles(
  snapshotDirectory: string,
  currentDirectory = snapshotDirectory
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("Snapshots cannot contain symbolic links");
    }
    if (entry.isDirectory()) {
      files.push(...(await listSnapshotFiles(snapshotDirectory, absolutePath)));
    } else if (entry.isFile()) {
      files.push(path.relative(snapshotDirectory, absolutePath).split(path.sep).join("/"));
    } else {
      throw new Error("Snapshots can contain only regular files and directories");
    }
  }
  return files.sort();
}

async function listSnapshotDirectories(
  snapshotDirectory: string,
  currentDirectory: string
): Promise<string[]> {
  const directories: string[] = [];
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const absolutePath = path.join(currentDirectory, entry.name);
    const relativePath = path.relative(snapshotDirectory, absolutePath).split(path.sep).join("/");
    directories.push(relativePath);
    directories.push(...(await listSnapshotDirectories(snapshotDirectory, absolutePath)));
  }
  return directories.sort();
}

export async function createStateSnapshot({
  statePaths,
  outputDirectory,
  applicationVersion = packageJson.version,
}: CreateStateSnapshotOptions): Promise<VerifiedStateSnapshot> {
  const output = path.resolve(outputDirectory);
  const repository = path.resolve(process.cwd());
  if (isWithin(repository, output)) {
    throw new Error("State snapshots must be stored outside the repository");
  }
  if (await stat(output).then(() => true).catch(() => false)) {
    throw new Error("Snapshot output directory already exists");
  }

  await assertDirectory(statePaths.stateDirectory, "Application state path");
  await assertDirectory(statePaths.rootStateDirectory, "Top-level application state path");
  await assertRegularFile(statePaths.databasePath, "Application database");
  await assertDirectory(statePaths.uploadsDirectory, "Uploads path");

  const parentDirectory = path.dirname(output);
  await mkdir(parentDirectory, { recursive: true, mode: DIRECTORY_MODE });
  const realOutput = path.join(await realpath(parentDirectory), path.basename(output));
  const realRepository = await realpath(repository);
  const realStateDirectory = await realpath(statePaths.rootStateDirectory);
  if (isWithin(realRepository, realOutput)) {
    throw new Error("State snapshots must be stored outside the repository");
  }
  if (isWithin(realStateDirectory, realOutput) || isWithin(realOutput, realStateDirectory)) {
    throw new Error("Snapshot output cannot overlap the application state directory");
  }
  const stagingDirectory = path.join(
    path.dirname(realOutput),
    `.${path.basename(output)}.staging-${randomUUID()}`
  );
  await mkdir(stagingDirectory, { mode: DIRECTORY_MODE });

  try {
    const databaseDestination = path.join(stagingDirectory, DATABASE_FILE);
    const sourceDatabase = new Database(statePaths.databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      await sourceDatabase.backup(databaseDestination);
    } finally {
      sourceDatabase.close();
    }
    const snapshotDatabase = new Database(databaseDestination);
    try {
      snapshotDatabase.pragma("journal_mode = DELETE");
    } finally {
      snapshotDatabase.close();
    }
    await chmod(databaseDestination, FILE_MODE);

    const uploadDirectories: string[] = [];
    const artifacts: SnapshotArtifact[] = [
      { path: DATABASE_FILE, kind: "database", ...(await hashFile(databaseDestination)) },
      ...(await copyUploads(
        statePaths.uploadsDirectory,
        path.join(stagingDirectory, UPLOADS_DIRECTORY),
        uploadDirectories
      )),
    ];

    const secretExists = await stat(statePaths.encryptionSecretPath)
      .then(() => true)
      .catch(() => false);
    if (secretExists) {
      artifacts.push(
        await copyArtifact(
          statePaths.encryptionSecretPath,
          path.join(stagingDirectory, SECRET_FILE),
          SECRET_FILE,
          "encryption-secret"
        )
      );
    }

    const manifest: StateSnapshotManifest = {
      formatVersion: 1,
      applicationVersion,
      environment: statePaths.environment,
      createdAt: new Date().toISOString(),
      paths: {
        database: DATABASE_FILE,
        uploads: UPLOADS_DIRECTORY,
        encryptionSecret: secretExists ? SECRET_FILE : null,
      },
      uploadDirectories: uploadDirectories.sort(),
      artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path)),
    };
    await writeFile(
      path.join(stagingDirectory, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: FILE_MODE }
    );
    await chmod(stagingDirectory, DIRECTORY_MODE);
    await rename(stagingDirectory, realOutput);
    return verifyStateSnapshot(realOutput);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyStateSnapshot(
  snapshotDirectory: string
): Promise<VerifiedStateSnapshot> {
  const requestedSnapshot = path.resolve(snapshotDirectory);
  await assertDirectory(requestedSnapshot, "Snapshot path");
  const snapshot = await realpath(requestedSnapshot);
  await assertRegularFile(path.join(snapshot, MANIFEST_FILE), "Snapshot manifest");

  const manifestStat = await stat(path.join(snapshot, MANIFEST_FILE));
  if (manifestStat.size > 10 * 1024 * 1024) {
    throw new Error("Snapshot manifest is too large");
  }

  const manifestContents = await readFile(path.join(snapshot, MANIFEST_FILE), "utf8");
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestContents);
  } catch {
    throw new Error("Snapshot manifest is not valid JSON");
  }
  const parsedManifest = stateSnapshotManifestSchema.safeParse(manifestJson);
  if (!parsedManifest.success) {
    throw new Error("Snapshot manifest is invalid");
  }
  const manifest = parsedManifest.data;

  const uploadsPath = resolveSnapshotPath(snapshot, manifest.paths.uploads);
  await assertDirectory(uploadsPath, "Snapshot uploads path");

  for (const artifact of manifest.artifacts) {
    const artifactPath = resolveSnapshotPath(snapshot, artifact.path);
    await assertRegularFile(artifactPath, `Snapshot artifact ${artifact.path}`);
    const actual = await hashFile(artifactPath);
    if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256) {
      throw new Error(`Snapshot artifact failed checksum validation: ${artifact.path}`);
    }
  }

  await validateStateDatabase(resolveSnapshotPath(snapshot, manifest.paths.database));

  const expectedFiles = [MANIFEST_FILE, ...manifest.artifacts.map((artifact) => artifact.path)].sort();
  const actualFiles = await listSnapshotFiles(snapshot);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Snapshot contains missing or untracked files");
  }
  const actualDirectories = await listSnapshotDirectories(snapshot, snapshot);
  if (JSON.stringify(actualDirectories) !== JSON.stringify([...manifest.uploadDirectories].sort())) {
    throw new Error("Snapshot upload directory metadata is inconsistent");
  }

  return { snapshotDirectory: snapshot, manifest };
}

export async function verifyMaterializedState(
  stateDirectory: string,
  manifest: StateSnapshotManifest
): Promise<void> {
  const uploadsDirectory = resolveSnapshotPath(stateDirectory, manifest.paths.uploads);
  await assertDirectory(uploadsDirectory, "Restored uploads path");

  const actualUploadDirectories = [
    UPLOADS_DIRECTORY,
    ...(await listSnapshotDirectories(stateDirectory, uploadsDirectory)),
  ].sort();
  if (
    JSON.stringify(actualUploadDirectories) !==
    JSON.stringify([...manifest.uploadDirectories].sort())
  ) {
    throw new Error("Restored upload directory metadata is inconsistent");
  }

  for (const artifact of manifest.artifacts) {
    const artifactPath = resolveSnapshotPath(stateDirectory, artifact.path);
    await assertRegularFile(artifactPath, `Restored artifact ${artifact.path}`);
    const actual = await hashFile(artifactPath);
    if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256) {
      throw new Error(`Restored artifact failed checksum validation: ${artifact.path}`);
    }
  }

  const expectedUploads = manifest.artifacts
    .filter((artifact) => artifact.kind === "upload")
    .map((artifact) => artifact.path)
    .sort();
  const actualUploads = (await listSnapshotFiles(uploadsDirectory)).map((relativePath) =>
    path.posix.join(UPLOADS_DIRECTORY, relativePath)
  );
  if (JSON.stringify(actualUploads) !== JSON.stringify(expectedUploads)) {
    throw new Error("Restored uploads contain missing or untracked files");
  }

  const secretExists = await stat(path.join(stateDirectory, SECRET_FILE))
    .then(() => true)
    .catch(() => false);
  if (secretExists !== (manifest.paths.encryptionSecret !== null)) {
    throw new Error("Restored encryption-secret state is inconsistent");
  }

  await validateStateDatabase(path.join(stateDirectory, DATABASE_FILE));
}
