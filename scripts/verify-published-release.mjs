import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { verifyNpmInstallation } from "./verify-npm-installation.mjs";

const repository = process.env.GITHUB_REPOSITORY ?? "Chandresh726/Switchy";
const { name, version } = JSON.parse(await readFile("packages/cli/package.json", "utf8"));
const mode = process.argv[2] ?? "assets";

async function published(url) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (response.ok) return response;
    if (![404, 429, 500, 502, 503, 504].includes(response.status)) throw new Error(`${url} returned ${response.status}`);
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Published artifact is not available: ${url}`);
}

async function digest(response, algorithm) {
  const hash = createHash(algorithm);
  let size = 0;
  for await (const chunk of response.body) { hash.update(chunk); size += chunk.length; }
  return { hex: hash.digest("hex"), size };
}

if (mode === "assets") {
  const base = `https://github.com/${repository}/releases/download/v${version}/`;
  const expected = JSON.parse(await readFile("dist/release-assets/switchy-manifest.json", "utf8"));
  const actual = await (await published(`${base}switchy-manifest.json`)).json();
  assert.deepEqual(actual, expected, "Published manifest differs from the verified build");
  for (const artifact of Object.values(expected.artifacts)) {
    const downloaded = await digest(await published(`${base}${artifact.file}`), "sha256");
    assert.equal(downloaded.hex, artifact.sha256, `Checksum mismatch: ${artifact.file}`);
    assert.equal(downloaded.size, artifact.size, `Size mismatch: ${artifact.file}`);
  }
} else if (mode === "npm") {
  const packageFile = (await readdir("dist/npm")).find((name) => name.endsWith(".tgz"));
  if (!packageFile) throw new Error("The verified npm package is missing");
  const local = await readFile(path.join("dist/npm", packageFile));
  const expected = createHash("sha512").update(local).digest("hex");
  const metadata = await (await published(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)).json();
  const downloaded = await digest(await published(metadata.dist.tarball), "sha512");
  assert.equal(downloaded.hex, expected, "Published npm tarball differs from the verified build");
  await verifyNpmInstallation(name, version);
} else {
  throw new Error("Use assets or npm");
}
console.log(`Verified published ${mode} for Switchy ${version}.`);
