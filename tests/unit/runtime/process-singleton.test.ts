import { afterEach, describe, expect, it, vi } from "vitest";

describe("processSingleton", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as typeof globalThis & {
      __switchyProcessSingletons?: unknown;
    }).__switchyProcessSingletons;
  });

  it("shares one instance across separately loaded module graphs outside tests", async () => {
    vi.stubEnv("VITEST", "");
    vi.resetModules();
    const instrumentationGraph = await import("@/lib/runtime/process-singleton");
    vi.resetModules();
    const routeGraph = await import("@/lib/runtime/process-singleton");

    const created = instrumentationGraph.processSingleton("gate", () => ({}));

    expect(routeGraph.processSingleton("gate", () => ({}))).toBe(created);
  });

  it("keeps instances module-scoped under Vitest so re-imports start fresh", async () => {
    vi.resetModules();
    const first = await import("@/lib/runtime/process-singleton");
    vi.resetModules();
    const second = await import("@/lib/runtime/process-singleton");

    const created = first.processSingleton("gate", () => ({}));

    expect(second.processSingleton("gate", () => ({}))).not.toBe(created);
  });
});
