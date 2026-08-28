import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const helperListeners = new Map<string, (...args: unknown[]) => void>();
  const stdoutListeners = new Map<string, (chunk: string) => void>();
  const helper = {
    exitCode: null as number | null,
    killed: false,
    kill: vi.fn(),
    stdin: { write: vi.fn() },
    stdout: {
      setEncoding: vi.fn(),
      on: vi.fn((event: string, listener: (chunk: string) => void) => {
        stdoutListeners.set(event, listener);
      }),
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      helperListeners.set(event, listener);
      return helper;
    }),
  };
  const detachedProcess = { once: vi.fn(), unref: vi.fn() };
  return {
    detachedProcess,
    helper,
    helperListeners,
    spawn: vi.fn((executable: string) =>
      executable === "/tmp/SwitchyNotifier" ? helper : detachedProcess),
    stdoutListeners,
  };
});

function emitHelperLine(value: unknown): void {
  mocks.stdoutListeners.get("data")?.(`${JSON.stringify(value)}\n`);
}

/** Answers the next helper command with `response` once it is written to stdin. */
function replyOnce(response: Record<string, unknown>): void {
  mocks.helper.stdin.write.mockImplementationOnce((line: string) => {
    const request = JSON.parse(line) as { request_id: string };
    queueMicrotask(() => emitHelperLine({
      event: "response",
      request_id: request.request_id,
      success: true,
      ...response,
    }));
    return true;
  });
}

describe("native notifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.helperListeners.clear();
    mocks.stdoutListeners.clear();
    mocks.helper.exitCode = null;
    mocks.helper.killed = false;
    vi.spyOn(process, "getBuiltinModule").mockReturnValue({ spawn: mocks.spawn } as never);
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    // The helper announces itself as soon as it is spawned.
    mocks.spawn.mockImplementation((executable: string) => {
      if (executable !== "/tmp/SwitchyNotifier") return mocks.detachedProcess;
      queueMicrotask(() => emitHelperLine({ event: "ready" }));
      return mocks.helper;
    });
    process.env.PORT = "6767";
    process.env.SWITCHY_MACOS_NOTIFICATION_HELPER = "/tmp/SwitchyNotifier";
    delete globalThis.__switchyNotificationHelper;
  });

  afterEach(() => {
    delete process.env.PORT;
    delete process.env.SWITCHY_MACOS_NOTIFICATION_HELPER;
    delete globalThis.__switchyNotificationHelper;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("delivers through the packaged helper over a single stdio pipe", async () => {
    replyOnce({ id: "00000000-0000-4000-8000-000000000001" });
    const { sendNativeNotification } = await import("@/lib/notifications/native-notifier");

    await sendNativeNotification({
      title: "New profile match found",
      body: "Staff Engineer at Acme · 88% match",
      path: "/jobs?minScore=75",
    });

    expect(mocks.spawn).toHaveBeenCalledWith(
      "/tmp/SwitchyNotifier",
      [],
      { stdio: ["pipe", "pipe", "inherit"] }
    );
    const [line] = mocks.helper.stdin.write.mock.calls[0] as [string];
    expect(JSON.parse(line)).toMatchObject({
      action: "show",
      title: "New profile match found",
      body: "Staff Engineer at Acme · 88% match",
      url: "http://127.0.0.1:6767/jobs?minScore=75",
    });
  });

  it("reuses one helper process across notifications", async () => {
    replyOnce({ id: "notification-1" });
    const { sendNativeNotification } = await import("@/lib/notifications/native-notifier");
    await sendNativeNotification({ title: "One", body: "One", path: "/jobs" });

    replyOnce({ id: "notification-2" });
    await sendNativeNotification({ title: "Two", body: "Two", path: "/jobs" });

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.helper.stdin.write).toHaveBeenCalledTimes(2);
  });

  it("rejects notification destinations that escape the local Switchy origin", async () => {
    const { sendNativeNotification } = await import("@/lib/notifications/native-notifier");

    await expect(sendNativeNotification({
      title: "Unsafe destination",
      body: "This must not be delivered",
      path: "//example.com/jobs",
    })).rejects.toThrow("must stay within Switchy");
    await expect(sendNativeNotification({
      title: "Unsafe destination",
      body: "This must not be delivered",
      path: "//user@127.0.0.1:6767/jobs",
    })).rejects.toThrow("must stay within Switchy");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("surfaces a helper refusal as a client error rather than a crash", async () => {
    mocks.helper.stdin.write.mockImplementationOnce((line: string) => {
      const request = JSON.parse(line) as { request_id: string };
      queueMicrotask(() => emitHelperLine({
        event: "response",
        request_id: request.request_id,
        success: false,
        error: "Notification permission is denied",
      }));
      return true;
    });
    const { sendNativeNotification } = await import("@/lib/notifications/native-notifier");

    await expect(sendNativeNotification({
      title: "Blocked",
      body: "Blocked",
      path: "/jobs",
    })).rejects.toMatchObject({ code: "native_notifications_unavailable" });
  });

  it("returns explicit permission states without turning denial into a server error", async () => {
    replyOnce({ permission: "denied" });
    const { prepareNativeNotifications } = await import("@/lib/notifications/native-notifier");

    await expect(prepareNativeNotifications()).resolves.toEqual({
      success: true,
      permission: "denied",
    });
  });

  it("reports permission as unavailable when the helper is not configured", async () => {
    delete process.env.SWITCHY_MACOS_NOTIFICATION_HELPER;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { getNativeNotificationPermission } = await import(
      "@/lib/notifications/native-notifier"
    );

    await expect(getNativeNotificationPermission()).resolves.toEqual({
      success: true,
      permission: "unavailable",
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("reports notifications as unavailable off macOS instead of spawning a helper", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const { getNativeNotificationPermission, sendNativeNotification } = await import(
      "@/lib/notifications/native-notifier"
    );

    await expect(getNativeNotificationPermission()).resolves.toEqual({
      success: true,
      permission: "unavailable",
    });
    await expect(sendNativeNotification({
      title: "Unsupported",
      body: "Unsupported",
      path: "/jobs",
    })).rejects.toMatchObject({ code: "native_notifications_unavailable" });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("stops a running helper and tolerates one that already exited", async () => {
    replyOnce({ id: "notification-1" });
    const { sendNativeNotification, stopNativeNotifications } = await import(
      "@/lib/notifications/native-notifier"
    );
    await sendNativeNotification({ title: "One", body: "One", path: "/jobs" });

    replyOnce({});
    await expect(stopNativeNotifications()).resolves.toEqual({ success: true });
    const [line] = mocks.helper.stdin.write.mock.calls.at(-1) as [string];
    expect(JSON.parse(line)).toMatchObject({ action: "quit" });

    delete globalThis.__switchyNotificationHelper;
    await expect(stopNativeNotifications()).resolves.toEqual({ success: true });
  });

  it("fails in-flight requests when the helper exits", async () => {
    mocks.helper.stdin.write.mockImplementationOnce(() => {
      queueMicrotask(() => mocks.helperListeners.get("exit")?.(1, null));
      return true;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendNativeNotification } = await import("@/lib/notifications/native-notifier");

    await expect(sendNativeNotification({
      title: "Interrupted",
      body: "Interrupted",
      path: "/jobs",
    })).rejects.toMatchObject({ code: "native_notifications_unavailable" });
  });

  it("opens the macOS notification pane for a blocked permission", async () => {
    const { openNativeNotificationSettings } = await import("@/lib/notifications/native-notifier");

    expect(openNativeNotificationSettings()).toEqual({ success: true });
    expect(mocks.spawn).toHaveBeenCalledWith(
      "open",
      [
        "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        + "?bundleId=in.slope726.switchy.notifications",
      ],
      { detached: true, stdio: "ignore" }
    );
    expect(mocks.detachedProcess.unref).toHaveBeenCalledOnce();
  });
});
