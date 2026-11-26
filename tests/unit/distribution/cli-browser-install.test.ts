import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getSwitchyPaths } from "../../../packages/cli/src/paths";
import { ensurePlaywrightBrowser } from "../../../packages/cli/src/runtime";

it.each(["headless-shell", "legacy", undefined])("installs browser mode %s with backward compatible arguments", async (browserMode) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "switchy-browser-install-"));
  try {
    const runtime = path.join(root, "runtime");
    await mkdir(path.join(runtime, "node_modules/playwright"), { recursive: true });
    await writeFile(path.join(runtime, "switchy-runtime.json"), JSON.stringify({ browserMode }));
    await writeFile(path.join(runtime, "node_modules/playwright/cli.js"), 'require("node:fs").writeFileSync("args.json", JSON.stringify({ args: process.argv.slice(2), cache: process.env.PLAYWRIGHT_BROWSERS_PATH }))');
    const paths = getSwitchyPaths(path.join(root, "state"));
    await ensurePlaywrightBrowser(runtime, paths);
    expect(JSON.parse(await readFile(path.join(runtime, "args.json"), "utf8"))).toEqual({
      args: ["install", "chromium", ...(browserMode === "headless-shell" ? ["--only-shell"] : [])], cache: paths.playwright,
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
