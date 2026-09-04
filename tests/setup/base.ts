import { vi } from "vitest";

export function resetTestDoubles(): void {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
}
