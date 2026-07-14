import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SchedulerRecoveryListener } from "@/components/scheduler/scheduler-recovery-listener";

function setDocumentState({
  visible,
  focused,
  online,
}: {
  visible: boolean;
  focused: boolean;
  online: boolean;
}) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visible ? "visible" : "hidden",
  });
  Object.defineProperty(document, "hasFocus", {
    configurable: true,
    value: () => focused,
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

describe("SchedulerRecoveryListener", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waits for a visible, focused, online state to remain stable", async () => {
    setDocumentState({ visible: false, focused: true, online: true });
    render(<SchedulerRecoveryListener />);

    vi.setSystemTime(new Date("2026-07-14T00:02:00Z"));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetch).not.toHaveBeenCalled();

    setDocumentState({ visible: true, focused: true, online: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels stabilization when the app becomes hidden or offline", async () => {
    setDocumentState({ visible: true, focused: true, online: true });
    render(<SchedulerRecoveryListener />);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    setDocumentState({ visible: true, focused: true, online: false });
    window.dispatchEvent(new Event("offline"));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).not.toHaveBeenCalled();

    setDocumentState({ visible: true, focused: true, online: true });
    window.dispatchEvent(new Event("online"));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("coalesces repeated wake signals into one recovery request", async () => {
    setDocumentState({ visible: true, focused: true, online: true });
    render(<SchedulerRecoveryListener />);

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps recovery pending after a failed request", async () => {
    setDocumentState({ visible: true, focused: true, online: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(<SchedulerRecoveryListener />);

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not schedule more recovery work after unmounting in flight", async () => {
    setDocumentState({ visible: true, focused: true, online: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolveRecovery: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRecovery = resolve;
        })
    );
    const { unmount } = render(<SchedulerRecoveryListener />);

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveRecovery?.(new Response(null, { status: 503 }));
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
