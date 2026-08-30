import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const SUPPORTED_TARGETS = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const projectDirectory = process.cwd();
const releaseAssetsDirectory = path.join(
  projectDirectory,
  "dist",
  "release-assets"
);
const releasePackageJson = JSON.parse(
  await readFile(
    path.join(projectDirectory, "packages", "cli", "package.json"),
    "utf8"
  )
);
const artifactFiles = (await readdir(releaseAssetsDirectory))
  .filter((name) => name.endsWith(".artifact.json"))
  .sort();
if (artifactFiles.length === 0) {
  throw new Error("No runtime artifact metadata was found");
}

const artifacts = {};
for (const artifactFile of artifactFiles) {
  const artifact = JSON.parse(
    await readFile(path.join(releaseAssetsDirectory, artifactFile), "utf8")
  );
  if (
    typeof artifact.target !== "string"
    || !SUPPORTED_TARGETS.has(artifact.target)
    || typeof artifact.file !== "string"
    || typeof artifact.sha256 !== "string"
    || typeof artifact.size !== "number"
  ) {
    throw new Error(`${artifactFile} is invalid`);
  }
  const expectedFile = `switchy-${releasePackageJson.version}-${artifact.target}.tar.gz`;
  if (artifact.file !== expectedFile || artifacts[artifact.target]) {
    throw new Error(`${artifactFile} has inconsistent release metadata`);
  }
  const archivePath = path.join(releaseAssetsDirectory, artifact.file);
  const archiveStats = await stat(archivePath).catch(() => null);
  if (
    !archiveStats?.isFile()
    || archiveStats.size !== artifact.size
    || await sha256(archivePath) !== artifact.sha256
  ) {
    throw new Error(`${artifact.file} does not match its artifact metadata`);
  }
  artifacts[artifact.target] = {
    file: artifact.file,
    sha256: artifact.sha256,
    size: artifact.size,
  };
}

const requiredTargets = process.env.SWITCHY_REQUIRED_TARGETS
  ?.split(",")
  .map((target) => target.trim())
  .filter(Boolean) ?? [];
const missingTargets = requiredTargets.filter((target) => !artifacts[target]);
if (missingTargets.length > 0) {
  throw new Error(`Missing runtime targets: ${missingTargets.join(", ")}`);
}

const manifest = {
  schemaVersion: 1,
  version: releasePackageJson.version,
  publishedAt: new Date().toISOString(),
  nodeVersion: process.versions.node,
  artifacts,
};
await writeFile(
  path.join(releaseAssetsDirectory, "switchy-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
