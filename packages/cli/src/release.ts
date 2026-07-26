import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

import { extract } from "tar";

import {
  CLI_VERSION,
  GITHUB_REPOSITORY,
  RELEASE_MANIFEST_FILE,
} from "./config.js";
import {
  withDirectoryLock,
  writeJsonFileAtomic,
} from "./files.js";
import {
  currentTarget,
  isSupportedTarget,
} from "./platform.js";
import type {
  CurrentVersionRecord,
  ReleaseArtifact,
  ReleaseManifest,
  SwitchyPaths,
} from "./types.js";

const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

export function assertStableVersion(version: string): string {
  if (!STABLE_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid stable Switchy version: ${version}`);
  }
  return version;
}

function releaseManifestUrl(version: string): string {
  return process.env.SWITCHY_MANIFEST_URL
    ?? `https://github.com/${GITHUB_REPOSITORY}/releases/download/v${version}/${RELEASE_MANIFEST_FILE}`;
}

function assertReleaseArtifact(value: unknown): ReleaseArtifact {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as ReleaseArtifact).file !== "string"
    || path.basename((value as ReleaseArtifact).file)
      !== (value as ReleaseArtifact).file
    || !/^switchy-\d+\.\d+\.\d+-(?:darwin|linux|win32)-(?:arm64|x64)\.tar\.gz$/u
      .test((value as ReleaseArtifact).file)
    || typeof (value as ReleaseArtifact).sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test((value as ReleaseArtifact).sha256)
    || typeof (value as ReleaseArtifact).size !== "number"
    || !Number.isSafeInteger((value as ReleaseArtifact).size)
    || (value as ReleaseArtifact).size <= 0
    || (value as ReleaseArtifact).size > 1_000_000_000
  ) {
    throw new Error("Release manifest contains an invalid artifact");
  }
  return value as ReleaseArtifact;
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (
    typeof value !== "object"
    || value === null
    || (value as ReleaseManifest).schemaVersion !== 1
    || typeof (value as ReleaseManifest).version !== "string"
    || !STABLE_VERSION_PATTERN.test((value as ReleaseManifest).version)
    || typeof (value as ReleaseManifest).publishedAt !== "string"
    || typeof (value as ReleaseManifest).nodeVersion !== "string"
    || typeof (value as ReleaseManifest).artifacts !== "object"
    || (value as ReleaseManifest).artifacts === null
  ) {
    throw new Error("Release manifest is invalid");
  }
  const manifest = value as ReleaseManifest;
  if (
    !Number.isFinite(Date.parse(manifest.publishedAt))
    || !/^\d+\.\d+\.\d+$/u.test(manifest.nodeVersion)
    || Array.isArray(manifest.artifacts)
  ) {
    throw new Error("Release manifest is invalid");
  }
  for (const [target, valueArtifact] of Object.entries(manifest.artifacts)) {
    if (!isSupportedTarget(target)) {
      throw new Error(`Release manifest contains unsupported target ${target}`);
    }
    const artifact = assertReleaseArtifact(valueArtifact);
    if (artifact.file !== `switchy-${manifest.version}-${target}.tar.gz`) {
      throw new Error("Release manifest contains inconsistent artifact metadata");
    }
  }
  return manifest;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": `switchy-cli/${CLI_VERSION}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${url}`);
  }
  return response.json() as Promise<unknown>;
}

async function fetchReleaseManifest(version: string): Promise<{
  manifest: ReleaseManifest;
  url: string;
}> {
  const url = releaseManifestUrl(version);
  const manifest = parseReleaseManifest(await fetchJson(url));
  if (manifest.version !== version) {
    throw new Error(
      `Release manifest version ${manifest.version} does not match ${version}`
    );
  }
  return { manifest, url };
}

export async function resolveLatestStableVersion(): Promise<string> {
  const override = process.env.SWITCHY_LATEST_VERSION?.trim();
  if (override) return assertStableVersion(override);
  const value = await fetchJson(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`
  );
  const tagName = typeof value === "object" && value !== null
    ? (value as { tag_name?: unknown }).tag_name
    : null;
  if (typeof tagName !== "string" || !/^v\d+\.\d+\.\d+$/u.test(tagName)) {
    throw new Error("Latest GitHub release does not contain a stable version tag");
  }
  return tagName.slice(1);
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function downloadFile(
  url: string,
  destination: string,
  expectedSize: number
): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": `switchy-cli/${CLI_VERSION}` },
    redirect: "follow",
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Runtime download failed with ${response.status}`);
  }
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = Number(contentLengthHeader);
  if (
    contentLengthHeader !== null
    && Number.isFinite(contentLength)
    && contentLength !== expectedSize
  ) {
    throw new Error("Runtime download size does not match the release manifest");
  }
  let downloadedSize = 0;
  const sizeLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedSize += chunk.length;
      if (downloadedSize > expectedSize) {
        callback(new Error("Runtime download exceeded its declared size"));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    sizeLimit,
    createWriteStream(destination, { mode: 0o600 })
  );
  if (downloadedSize !== expectedSize) {
    throw new Error("Runtime download size does not match the release manifest");
  }
}

async function validateRuntimeDirectory(
  runtimeDirectory: string,
  version: string,
  target: string
): Promise<void> {
  for (const relativePath of [
    "server.js",
    "bin/migrate.cjs",
    "drizzle/meta/_journal.json",
    "switchy-runtime.json",
  ]) {
    const fileStats = await stat(path.join(runtimeDirectory, relativePath))
      .catch(() => null);
    if (!fileStats?.isFile()) {
      throw new Error(`Runtime is missing ${relativePath}`);
    }
  }
  let metadata: {
    schemaVersion?: unknown;
    version?: unknown;
    target?: unknown;
    nodeVersion?: unknown;
    builtAt?: unknown;
  };
  try {
    metadata = JSON.parse(
      await readFile(
        path.join(runtimeDirectory, "switchy-runtime.json"),
        "utf8"
      )
    ) as typeof metadata;
  } catch {
    throw new Error("Runtime metadata is invalid");
  }
  if (
    metadata.schemaVersion !== 1
    || metadata.version !== version
    || metadata.target !== target
    || typeof metadata.nodeVersion !== "string"
    || !/^\d+\.\d+\.\d+$/u.test(metadata.nodeVersion)
    || metadata.nodeVersion.split(".", 1)[0]
      !== process.versions.node.split(".", 1)[0]
    || typeof metadata.builtAt !== "string"
    || !Number.isFinite(Date.parse(metadata.builtAt))
  ) {
    throw new Error("Runtime metadata does not match this installation");
  }
}

async function installRuntimeUnlocked(
  version: string,
  paths: SwitchyPaths
): Promise<string> {
  assertStableVersion(version);
  const target = currentTarget();
  const versionDirectory = path.join(paths.versions, version);
  if ((await stat(versionDirectory).catch(() => null))?.isDirectory()) {
    try {
      await validateRuntimeDirectory(versionDirectory, version, target);
      return versionDirectory;
    } catch {
      await rm(versionDirectory, { recursive: true, force: true });
    }
  }

  const localRuntime = process.env.SWITCHY_RUNTIME_SOURCE?.trim();
  const temporaryDirectory = path.join(
    paths.app,
    `.install-${version}-${randomUUID()}`
  );
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });

  try {
    if (localRuntime) {
      await cp(path.resolve(localRuntime), temporaryDirectory, {
        recursive: true,
        verbatimSymlinks: true,
      });
    } else {
      const { manifest, url: manifestUrl } = await fetchReleaseManifest(version);
      const artifact = manifest.artifacts[target];
      if (!artifact) {
        throw new Error(`Release ${version} does not support ${target}`);
      }
      const archivePath = path.join(paths.downloads, artifact.file);
      const artifactUrl = new URL(artifact.file, manifestUrl).toString();
      const existing = await stat(archivePath).catch(() => null);
      const cachedArchiveIsValid = existing?.size === artifact.size
        && await sha256(archivePath) === artifact.sha256;
      if (!cachedArchiveIsValid) {
        await rm(archivePath, { force: true });
        try {
          await downloadFile(artifactUrl, archivePath, artifact.size);
        } catch (error) {
          await rm(archivePath, { force: true });
          throw error;
        }
      }
      const downloadedArchive = await stat(archivePath).catch(() => null);
      if (
        downloadedArchive?.size !== artifact.size
        || await sha256(archivePath) !== artifact.sha256
      ) {
        await rm(archivePath, { force: true });
        throw new Error("Runtime checksum verification failed");
      }
      await extract({
        cwd: temporaryDirectory,
        file: archivePath,
        preservePaths: false,
        strict: true,
      });
    }
    await validateRuntimeDirectory(temporaryDirectory, version, target);
    await rename(temporaryDirectory, versionDirectory);
    return versionDirectory;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function installRuntime(
  version: string,
  paths: SwitchyPaths
): Promise<string> {
  return withDirectoryLock(paths.installLock, async () => {
    return installRuntimeUnlocked(version, paths);
  });
}

export async function setCurrentVersion(
  paths: SwitchyPaths,
  version: string
): Promise<void> {
  const value: CurrentVersionRecord = {
    schemaVersion: 1,
    version,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFileAtomic(paths.currentVersion, value);
}
