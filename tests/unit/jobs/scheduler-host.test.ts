import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const store = vi.hoisted(() => ({
  files: new Map<string, string>(),
  execCalls: [] as Array<{ command: string; args: string[] }>,
  loaded: new Set<string>(),
  bootstrapFail: new Set<string>(),
  schedulerEnabled: "true" as string | null,
}));

function labelFromPlist(value: string): string {
  return path.basename(value, ".plist");
}

vi.mock("node:child_process", () => ({
  execFile: (command: string, args: string[], callback: ExecCallback) => {
    store.execCalls.push({ command, args });
    if (args[0] === "print") {
      const label = String(args[1]).split("/").pop() ?? "";
      if (store.loaded.has(label)) {
        callback(null, "state = running", "");
      } else {
        callback(new Error(`Could not find service "${label}"`));
      }
      return;
    }
    if (args[0] === "bootstrap") {
      const label = labelFromPlist(String(args[2]));
      if (store.bootstrapFail.has(label)) {
        callback(new Error("Bootstrap failed: 5: Input/output error"));
      } else {
        store.loaded.add(label);
        callback(null, "", "");
      }
      return;
    }
    if (args[0] === "bootout") {
      store.loaded.delete(labelFromPlist(String(args[2])));
      callback(null, "", "");
      return;
    }
    callback(new Error(`unexpected launchctl args: ${args.join(" ")}`));
  },
}));

vi.mock("node:fs/promises", () => ({
  access: async (filePath: string) => {
    if (!store.files.has(String(filePath))) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
  },
  mkdir: async () => undefined,
  readFile: async (filePath: string) => {
    const contents = store.files.get(String(filePath));
    if (contents === undefined) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return contents;
  },
  rm: async (filePath: string) => {
    store.files.delete(String(filePath));
  },
  writeFile: async (filePath: string, contents: string) => {
    store.files.set(String(filePath), String(contents));
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, value: string) => value,
}));

vi.mock("@/lib/db/schema", () => ({
  settings: { __table: "settings", key: "key" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => store.schedulerEnabled === null
            ? []
            : [{ value: store.schedulerEnabled }],
        }),
      }),
    }),
  },
}));

const realPlatform = process.platform;

function usePlatform(platform: string): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function plistPath(label: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

describe("scheduler host agents", () => {
  beforeEach(() => {
    vi.resetModules();
    store.files.clear();
    store.execCalls.length = 0;
    store.loaded.clear();
    store.bootstrapFail.clear();
    store.schedulerEnabled = "true";
    usePlatform("darwin");
  });

  afterEach(() => {
    usePlatform(realPlatform);
  });

  it("skips host management off macOS", async () => {
    usePlatform("linux");
    const host = await import("@/lib/jobs/scheduler-host");

    await expect(host.syncSchedulerHost()).resolves.toBe("skipped");
    await expect(host.installSchedulerHost()).rejects.toThrow("only supported on macOS");
    await expect(host.uninstallSchedulerHost()).resolves.toBeUndefined();
    expect(await host.getSchedulerHostStatus()).toMatchObject({ supported: false });
  });

  it("installs and loads both agents when enabled", async () => {
    const host = await import("@/lib/jobs/scheduler-host");

    await expect(host.syncSchedulerHost()).resolves.toBe("installed");

    expect(store.files.has(plistPath("com.switchy.app"))).toBe(true);
    expect(store.files.has(plistPath("com.switchy.scheduler-tick"))).toBe(true);
    expect(await host.getSchedulerHostStatus()).toMatchObject({
      serverAgentInstalled: true,
      tickAgentInstalled: true,
      serverAgentLoaded: true,
      tickAgentLoaded: true,
    });
  });

  it("removes only the tick agent when scheduling is disabled", async () => {
    store.schedulerEnabled = "false";
    store.files.set(plistPath("com.switchy.app"), "server-plist");
    store.files.set(plistPath("com.switchy.scheduler-tick"), "tick-plist");
    store.loaded.add("com.switchy.app");
    store.loaded.add("com.switchy.scheduler-tick");
    const host = await import("@/lib/jobs/scheduler-host");

    await expect(host.syncSchedulerHost()).resolves.toBe("removed");

    // Disabling auto-scrape must never stop the app server itself.
    expect(store.files.has(plistPath("com.switchy.app"))).toBe(true);
    expect(store.files.has(plistPath("com.switchy.scheduler-tick"))).toBe(false);
    expect(store.loaded.has("com.switchy.scheduler-tick")).toBe(false);
  });

  it("reports a failed bootstrap as not installed so sync retries the load", async () => {
    store.bootstrapFail.add("com.switchy.scheduler-tick");
    const host = await import("@/lib/jobs/scheduler-host");

    await expect(host.installSchedulerHost()).rejects.toThrow("did not load");
    const status = await host.getSchedulerHostStatus();
    expect(status.tickAgentInstalled).toBe(false);
    expect(status.tickAgentLoaded).toBe(false);

    store.bootstrapFail.clear();
    await expect(host.syncSchedulerHost()).resolves.toBe("installed");
    expect((await host.getSchedulerHostStatus()).tickAgentInstalled).toBe(true);
  });

  it("reloads a plist that exists but is not loaded", async () => {
    store.files.set(plistPath("com.switchy.app"), "server-plist");
    store.files.set(plistPath("com.switchy.scheduler-tick"), "tick-plist");
    store.loaded.add("com.switchy.app");
    const host = await import("@/lib/jobs/scheduler-host");

    expect((await host.getSchedulerHostStatus()).tickAgentInstalled).toBe(false);
    await expect(host.syncSchedulerHost()).resolves.toBe("installed");
    expect(store.execCalls.some((call) => call.args[0] === "bootstrap")).toBe(true);
    expect((await host.getSchedulerHostStatus()).tickAgentInstalled).toBe(true);
  });

  it("gives the server agent a PATH and reloads a drifted plist", async () => {
    store.files.set(plistPath("com.switchy.app"), "stale-server-plist");
    store.loaded.add("com.switchy.app");
    const host = await import("@/lib/jobs/scheduler-host");

    await expect(host.syncSchedulerHost("/tmp/switchy-checkout")).resolves.toBe("installed");

    const serverPlist = store.files.get(plistPath("com.switchy.app")) ?? "";
    expect(serverPlist).toContain("<key>PATH</key>");
    expect(serverPlist).toContain("/tmp/switchy-checkout");
    const serverCalls = store.execCalls
      .filter((call) => String(call.args.at(-1)).endsWith("com.switchy.app.plist"))
      .map((call) => call.args[0]);
    expect(serverCalls).toContain("bootout");
    expect(serverCalls.at(-1)).toBe("bootstrap");

    store.execCalls.length = 0;
    await expect(host.syncSchedulerHost("/tmp/switchy-checkout")).resolves.toBe("installed");
    expect(store.execCalls.some((call) => call.args[0] === "bootout")).toBe(false);
  });

  it("installs only the tick agent for a CLI-managed packaged runtime", async () => {
    const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), "switchy-host-runtime-"));
    writeFileSync(path.join(runtimeDirectory, "switchy-runtime.json"), "{}");
    store.files.set(plistPath("com.switchy.app"), "legacy-server-plist");
    store.loaded.add("com.switchy.app");
    const host = await import("@/lib/jobs/scheduler-host");

    try {
      await expect(host.syncSchedulerHost(runtimeDirectory)).resolves.toBe("installed");

      expect(store.files.has(plistPath("com.switchy.app"))).toBe(false);
      expect(store.loaded.has("com.switchy.app")).toBe(false);
      expect(store.loaded.has("com.switchy.scheduler-tick")).toBe(true);
      expect(await host.getSchedulerHostStatus(runtimeDirectory)).toMatchObject({
        serverAgentSupported: false,
        tickAgentInstalled: true,
      });
    } finally {
      rmSync(runtimeDirectory, { recursive: true, force: true });
    }
  });
});
