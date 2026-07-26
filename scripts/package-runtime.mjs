import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { build } from "esbuild";

const projectDirectory = process.cwd();
const packageJson = JSON.parse(
  await readFile(path.join(projectDirectory, "package.json"), "utf8")
);
const target = process.env.SWITCHY_TARGET
  ?? `${process.platform}-${process.arch}`;
const expectedTarget = `${process.platform}-${process.arch}`;
if (target !== expectedTarget) {
  throw new Error(
    `Runtime target ${target} must be built on matching host ${expectedTarget}`
  );
}

const standaloneDirectory = path.join(
  projectDirectory,
  ".next",
  "standalone"
);
const standaloneStats = await stat(standaloneDirectory).catch(() => null);
if (!standaloneStats?.isDirectory()) {
  throw new Error("Run pnpm build before packaging the standalone runtime");
}

const serverCandidates = [
  path.join(standaloneDirectory, "server.js"),
  path.join(standaloneDirectory, path.basename(projectDirectory), "server.js"),
];
const serverPath = await Promise.all(
  serverCandidates.map(async (candidate) => ({
    candidate,
    exists: (await stat(candidate).catch(() => null))?.isFile() ?? false,
  }))
).then((candidates) => candidates.find(({ exists }) => exists)?.candidate);
if (!serverPath) {
  throw new Error("Unable to locate server.js in the standalone build");
}

const standaloneAppDirectory = path.dirname(serverPath);
const releaseAssetsDirectory = path.join(
  projectDirectory,
  "dist",
  "release-assets"
);
const runtimeDirectory = path.join(
  projectDirectory,
  "dist",
  "runtime",
  target
);
await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
await mkdir(releaseAssetsDirectory, { recursive: true });
for (const entry of ["server.js", "package.json", ".next"]) {
  const source = path.join(standaloneAppDirectory, entry);
  if (!(await stat(source).catch(() => null))) {
    throw new Error(`Standalone runtime is missing ${entry}`);
  }
  await cp(source, path.join(runtimeDirectory, entry), {
    recursive: true,
    verbatimSymlinks: true,
  });
}
await cp(
  path.join(standaloneDirectory, "node_modules"),
  path.join(runtimeDirectory, "node_modules"),
  { recursive: true, verbatimSymlinks: true }
);
const playwrightSource = await realpath(
  path.join(projectDirectory, "node_modules", "playwright")
);
const playwrightCoreSource = await realpath(
  path.join(path.dirname(playwrightSource), "playwright-core")
);
const playwrightDestination = await realpath(
  path.join(runtimeDirectory, "node_modules", "playwright")
);
const playwrightCoreDestination = await realpath(
  path.join(path.dirname(playwrightDestination), "playwright-core")
);
for (const [source, destination] of [
  [playwrightSource, playwrightDestination],
  [playwrightCoreSource, playwrightCoreDestination],
]) {
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, {
    recursive: true,
    verbatimSymlinks: true,
  });
}
await mkdir(path.join(runtimeDirectory, ".next"), { recursive: true });
await cp(
  path.join(projectDirectory, ".next", "static"),
  path.join(runtimeDirectory, ".next", "static"),
  { recursive: true }
);
await cp(
  path.join(projectDirectory, "public"),
  path.join(runtimeDirectory, "public"),
  { recursive: true }
);
await cp(
  path.join(projectDirectory, "drizzle"),
  path.join(runtimeDirectory, "drizzle"),
  { recursive: true }
);
await mkdir(path.join(runtimeDirectory, "bin"), { recursive: true });
await build({
  entryPoints: [path.join(projectDirectory, "scripts", "migrate-database.ts")],
  outfile: path.join(runtimeDirectory, "bin", "migrate.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["better-sqlite3"],
  alias: { "@": projectDirectory },
  sourcemap: true,
});
await writeFile(
  path.join(runtimeDirectory, "switchy-runtime.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    version: packageJson.version,
    target,
    nodeVersion: process.versions.node,
    builtAt: new Date().toISOString(),
  }, null, 2)}\n`
);

const archiveName = `switchy-${packageJson.version}-${target}.tar.gz`;
const archivePath = path.join(releaseAssetsDirectory, archiveName);
await rm(archivePath, { force: true });
const archive = spawnSync(
  "tar",
  [
    process.platform === "win32" ? "-czhf" : "-czf",
    archivePath,
    "-C",
    runtimeDirectory,
    ".",
  ],
  { stdio: "inherit" }
);
if (archive.status !== 0) {
  throw new Error(`tar exited with code ${archive.status}`);
}

const hash = createHash("sha256");
for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
const archiveStats = await stat(archivePath);
await writeFile(
  path.join(releaseAssetsDirectory, `${target}.artifact.json`),
  `${JSON.stringify({
    target,
    file: archiveName,
    sha256: hash.digest("hex"),
    size: archiveStats.size,
  }, null, 2)}\n`
);

console.log(archivePath);
