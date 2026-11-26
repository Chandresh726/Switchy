import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (entry.isFile()) yield file;
  }
}

/** Operate only on the disposable runtime staging tree, never on installed data. */
export async function optimizeRuntime(runtimeDirectory, target) {
  if (!["darwin-arm64", "linux-arm64", "linux-x64", "win32-x64"].includes(target)) throw new Error(`Unsupported runtime target ${target}`);
  const directories = [path.join(runtimeDirectory, "node_modules"), path.join(runtimeDirectory, ".next/node_modules")];
  for (const directory of directories) {
    const packages = [];
    for await (const file of files(directory)) {
      if (path.basename(file) !== "package.json") continue;
      const definition = JSON.parse(await readFile(file, "utf8"));
      if (definition.name === "better-sqlite3") packages.push(path.dirname(file));
    }
    for (const pkg of packages) {
      // Keep the JavaScript entrypoints, license, and the host's native binding.
      const prebuilds = path.join(pkg, "prebuilds");
      if (!(await stat(path.join(prebuilds, `${target}.node`)).catch(() => null))?.isFile()) {
        throw new Error(`SQLite runtime is missing the ${target} prebuild`);
      }
      for (const name of ["deps", "src", "binding.gyp"]) await rm(path.join(pkg, name), { recursive: true, force: true });
      for (const name of await readdir(prebuilds)) {
        if (name.endsWith(".node") && name !== `${target}.node`) await rm(path.join(prebuilds, name));
      }
    }
  }

  // Preserve every resolution path, including Turbopack aliases. Tar stores
  // repeated immutable dependency content once when the files share an inode.
  const seen = new Map();
  let linkedBytes = 0;
  let linkedFiles = 0;
  for (const directory of directories) for await (const file of files(directory)) {
    const info = await stat(file);
    if (info.size === 0) continue;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const key = `${info.size}:${info.mode & 0o777}:${hash.digest("hex")}`;
    const original = seen.get(key);
    if (!original) { seen.set(key, file); continue; }
    const temporary = `${file}.${randomUUID()}.link`;
    try {
      await link(original, temporary);
      await rename(temporary, file);
      linkedBytes += info.size;
      linkedFiles++;
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EMLINK"].includes(error.code)) throw error;
      // Filesystems without hard links still get a complete, pruned runtime.
    } finally { await rm(temporary, { force: true }); }
  }
  return { linkedBytes, linkedFiles };
}
