import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
await rm(path.join(packageDirectory, "dist"), { recursive: true, force: true });
await mkdir(path.join(packageDirectory, "dist"), { recursive: true });
await build({
  entryPoints: [path.join(packageDirectory, "src", "cli.ts")],
  outfile: path.join(packageDirectory, "dist", "cli.js"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
});
