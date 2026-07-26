import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import {
  cp,
  mkdir,
  readFile,
  readdir,
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
const projectPlaywrightSource = await realpath(
  path.join(projectDirectory, "node_modules", "playwright")
);
const projectBetterSqliteSource = await realpath(
  path.join(projectDirectory, "node_modules", "better-sqlite3")
);
const projectBetterSqliteRequire = createRequire(
  path.join(projectBetterSqliteSource, "package.json")
);
const projectBindingsSource = path.dirname(
  projectBetterSqliteRequire.resolve("bindings/package.json")
);
const projectBindingsRequire = createRequire(
  path.join(projectBindingsSource, "package.json")
);
const projectFileUriToPathSource = path.dirname(
  projectBindingsRequire.resolve("file-uri-to-path/package.json")
);
const preferredPackageSources = new Map([
  ["better-sqlite3", projectBetterSqliteSource],
  ["bindings", projectBindingsSource],
  ["file-uri-to-path", projectFileUriToPathSource],
  ["playwright", projectPlaywrightSource],
  [
    "playwright-core",
    await realpath(
      path.join(path.dirname(projectPlaywrightSource), "playwright-core")
    ),
  ],
]);

async function packageEntries(nodeModulesDirectory) {
  const packages = [];
  for (const entry of await readdir(nodeModulesDirectory, {
    withFileTypes: true,
  })) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.name.startsWith("@")) {
      packages.push(entry.name);
      continue;
    }
    const scopeDirectory = path.join(nodeModulesDirectory, entry.name);
    for (const scopedEntry of await readdir(scopeDirectory, {
      withFileTypes: true,
    })) {
      packages.push(`${entry.name}/${scopedEntry.name}`);
    }
  }
  return packages;
}

async function resolvePackageDependency(packageDirectory, dependency) {
  const packageRequire = createRequire(
    path.join(packageDirectory, "package.json")
  );
  try {
    return path.dirname(packageRequire.resolve(`${dependency}/package.json`));
  } catch {
    let entryPoint;
    try {
      entryPoint = packageRequire.resolve(dependency);
    } catch {
      return null;
    }
    let candidate = path.dirname(entryPoint);
    while (true) {
      const definitionPath = path.join(candidate, "package.json");
      const definition = await readFile(definitionPath, "utf8")
        .then((value) => JSON.parse(value))
        .catch(() => null);
      if (definition?.name === dependency) return candidate;
      const parent = path.dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

async function materializePackage(source, destination, ancestors = new Set()) {
  let resolvedSource = await realpath(source);
  let packageDefinition = JSON.parse(
    await readFile(path.join(resolvedSource, "package.json"), "utf8")
  );
  const preferredSource = preferredPackageSources.get(packageDefinition.name);
  if (preferredSource) {
    const projectDefinition = JSON.parse(
      await readFile(path.join(preferredSource, "package.json"), "utf8")
    );
    if (projectDefinition.version === packageDefinition.version) {
      resolvedSource = preferredSource;
      packageDefinition = projectDefinition;
    }
  }
  if (ancestors.has(resolvedSource)) return;

  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(resolvedSource, destination, {
    recursive: true,
    dereference: true,
  });

  const dependencies = new Set([
    ...Object.keys(packageDefinition.dependencies ?? {}),
    ...Object.keys(packageDefinition.optionalDependencies ?? {}),
    ...Object.keys(packageDefinition.peerDependencies ?? {}),
  ]);
  const nextAncestors = new Set(ancestors).add(resolvedSource);
  for (const dependency of dependencies) {
    const dependencySource = await resolvePackageDependency(
      resolvedSource,
      dependency
    );
    if (!dependencySource) continue;
    await materializePackage(
      dependencySource,
      path.join(destination, "node_modules", dependency),
      nextAncestors
    );
  }
}

async function materializeSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".pnpm") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const source = await realpath(entryPath);
      const sourceStats = await stat(source);
      const packageDefinition = sourceStats.isDirectory()
        ? await stat(path.join(source, "package.json")).catch(() => null)
        : null;
      if (packageDefinition?.isFile()) {
        await materializePackage(source, entryPath);
      } else {
        await rm(entryPath, { recursive: true, force: true });
        await cp(source, entryPath, {
          recursive: sourceStats.isDirectory(),
          dereference: true,
        });
      }
    }
    if ((await stat(entryPath)).isDirectory()) {
      await materializeSymlinks(entryPath);
    }
  }
}

const runtimeNodeModules = path.join(runtimeDirectory, "node_modules");
for (const packageName of await packageEntries(runtimeNodeModules)) {
  const destination = path.join(runtimeNodeModules, packageName);
  await materializePackage(destination, destination);
}
await materializeSymlinks(runtimeDirectory);
await rm(path.join(runtimeNodeModules, ".pnpm"), {
  recursive: true,
  force: true,
});
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
  ["-czf", archivePath, "-C", runtimeDirectory, "."],
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
