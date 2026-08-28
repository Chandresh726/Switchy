import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  getNativeNotificationPermission: vi.fn(),
  openNativeNotificationSettings: vi.fn(),
  prepareNativeNotifications: vi.fn(),
  stopNativeNotifications: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/notifications/native-notifier", () => ({
  getNativeNotificationPermission: mocks.getNativeNotificationPermission,
  openNativeNotificationSettings: mocks.openNativeNotificationSettings,
  prepareNativeNotifications: mocks.prepareNativeNotifications,
  stopNativeNotifications: mocks.stopNativeNotifications,
}));

import { DELETE, GET, POST, PUT } from "@/app/api/notifications/native/route";

function request(method: "DELETE" | "GET" | "POST" | "PUT") {
  return new Request("http://localhost/api/notifications/native", { method });
}

describe("native notification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNativeNotificationPermission.mockResolvedValue({
      success: true,
      permission: "not_determined",
    });
    mocks.prepareNativeNotifications.mockResolvedValue({
      success: true,
      permission: "denied",
    });
    mocks.openNativeNotificationSettings.mockReturnValue({ success: true });
    mocks.stopNativeNotifications.mockResolvedValue({ success: true });
  });

  it("checks permission without prompting or requiring a mutation guard", async () => {
    const response = await GET(request("GET"));

    await expect(response.json()).resolves.toEqual({
      success: true,
      permission: "not_determined",
    });
    expect(mocks.getNativeNotificationPermission).toHaveBeenCalledOnce();
    expect(mocks.assertAppRequest).not.toHaveBeenCalled();
  });

  it("requests permission and preserves a denied result", async () => {
    const nativeRequest = request("POST");
    const response = await POST(nativeRequest);

    await expect(response.json()).resolves.toEqual({
      success: true,
      permission: "denied",
    });
    expect(mocks.assertAppRequest).toHaveBeenCalledWith(nativeRequest);
    expect(mocks.prepareNativeNotifications).toHaveBeenCalledOnce();
  });

  it("opens notification settings through the guarded mutation", async () => {
    const nativeRequest = request("PUT");
    const response = await PUT(nativeRequest);

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.assertAppRequest).toHaveBeenCalledWith(nativeRequest);
    expect(mocks.openNativeNotificationSettings).toHaveBeenCalledOnce();
  });

  it("stops the helper through the guarded mutation", async () => {
    const nativeRequest = request("DELETE");
    const response = await DELETE(nativeRequest);

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.assertAppRequest).toHaveBeenCalledWith(nativeRequest);
    expect(mocks.stopNativeNotifications).toHaveBeenCalledOnce();
  });
});
