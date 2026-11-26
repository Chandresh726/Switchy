import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LifecycleListener } from "@/components/runtime/lifecycle-listener";
import { APP_VERSION } from "@/lib/constants";
import { requestBrowserReconnect } from "@/lib/runtime/browser-update";

const mocks = vi.hoisted(() => ({ heartbeat: vi.fn() }));
vi.mock("@/lib/api/clients/lifecycle", () => ({ sendLifecycleHeartbeat: mocks.heartbeat }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "production");
  window.sessionStorage.clear();
  mocks.heartbeat.mockReset().mockResolvedValue({ version: APP_VERSION, updating: false });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); window.sessionStorage.clear(); });

it("immediately wakes the normal heartbeat after an install request and backs off reconnect checks", async () => {
  const view = render(<LifecycleListener />);
  await act(async () => {});
  expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
  await act(async () => { requestBrowserReconnect(); });
  expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mocks.heartbeat).toHaveBeenCalledTimes(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(mocks.heartbeat).toHaveBeenCalledTimes(4);
  view.unmount();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.heartbeat).toHaveBeenCalledTimes(4);
});

it("serializes requests when an install arrives during a heartbeat", async () => {
  let finish!: (result: { version: string; updating: boolean }) => void;
  mocks.heartbeat.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = render(<LifecycleListener />);
  act(() => requestBrowserReconnect());
  expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ version: APP_VERSION, updating: true }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
  view.unmount();
});
