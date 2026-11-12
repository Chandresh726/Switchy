import { readdir } from "node:fs/promises";
import path from "node:path";

// Windows directory junctions become invalid when copied to a new tree. Resolve
// Turbopack's hashed package aliases from the original standalone output instead
// of following the copied junction, then materialize the package and its deps.
export async function materializeTracedPackages(sourceNext, destinationNext, materializePackage) {
  const sourceModules = path.join(sourceNext, "node_modules");
  const entries = await readdir(sourceModules, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    await materializePackage(
      path.join(sourceModules, entry.name),
      path.join(destinationNext, "node_modules", entry.name)
    );
  }
}
