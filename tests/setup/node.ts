import { afterEach, vi } from "vitest";

import { resetTestDoubles } from "./base";

// Native OS assertions are exercised through injected child processes in the
// inhibitor tests. Other tests must not change the host's sleep behavior.
vi.mock("@/lib/scraper/runtime/device-sleep-inhibitor", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/scraper/runtime/device-sleep-inhibitor")>(),
  createDeviceSleepInhibitor: () => ({ acquire: async () => ({ release: async () => undefined }) }),
}));

afterEach(() => {
  resetTestDoubles();
});
