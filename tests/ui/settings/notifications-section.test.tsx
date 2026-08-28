import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsSection } from "@/components/settings/notifications-section";

const mocks = vi.hoisted(() => ({
  getNativeNotificationPermission: vi.fn(),
  openNativeNotificationSettings: vi.fn(),
  patchSettings: vi.fn(),
  requestNativeNotificationPermission: vi.fn(),
  sendTestNotification: vi.fn(),
  stopNativeNotifications: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/api/clients/notifications", () => ({
  getNativeNotificationPermission: mocks.getNativeNotificationPermission,
  openNativeNotificationSettings: mocks.openNativeNotificationSettings,
  requestNativeNotificationPermission: mocks.requestNativeNotificationPermission,
  sendTestNotification: mocks.sendTestNotification,
  stopNativeNotifications: mocks.stopNativeNotifications,
}));

vi.mock("@/lib/api/clients/settings", () => ({
  patchSettings: mocks.patchSettings,
}));

function renderNotifications(enabled = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationsSection enabled={enabled} threshold={75} />
    </QueryClientProvider>
  );
}

describe("NotificationsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNativeNotificationPermission.mockResolvedValue({
      success: true,
      permission: "not_determined",
    });
    mocks.requestNativeNotificationPermission.mockResolvedValue({
      success: true,
      permission: "granted",
    });
    mocks.openNativeNotificationSettings.mockResolvedValue({ success: true });
    mocks.patchSettings.mockResolvedValue({
      notifications_enabled: "true",
    });
    mocks.stopNativeNotifications.mockResolvedValue({ success: true });
  });

  it("prepares native delivery before enabling notifications", async () => {
    renderNotifications();
    expect(mocks.getNativeNotificationPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Enable job match notifications" }));

    await waitFor(() => expect(mocks.patchSettings).toHaveBeenCalledWith({ notifications_enabled: true }));
    expect(mocks.requestNativeNotificationPermission).toHaveBeenCalledOnce();
  });

  it("keeps notifications disabled and offers settings when native permission is denied", async () => {
    mocks.requestNativeNotificationPermission.mockResolvedValue({
      success: true,
      permission: "denied",
    });

    renderNotifications();
    fireEvent.click(screen.getByRole("switch", { name: "Enable job match notifications" }));

    expect(await screen.findByText("Notifications are blocked")).toBeTruthy();
    expect(mocks.patchSettings).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Switchy is blocked from showing notifications. Allow it in System Settings."
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    await waitFor(() => expect(mocks.openNativeNotificationSettings).toHaveBeenCalledOnce());
  });

  it("lets an existing opt-in finish native permission setup", async () => {
    renderNotifications(true);

    expect(await screen.findByText("Finish notification setup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => expect(mocks.requestNativeNotificationPermission).toHaveBeenCalledOnce());
    expect(mocks.patchSettings).toHaveBeenCalledWith({ notifications_enabled: true });
  });

  it("stops the native helper after disabling an existing opt-in", async () => {
    mocks.getNativeNotificationPermission.mockResolvedValue({
      success: true,
      permission: "granted",
    });
    mocks.patchSettings.mockResolvedValue({ notifications_enabled: "false" });
    renderNotifications(true);

    await waitFor(() => expect(mocks.getNativeNotificationPermission).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("switch", { name: "Enable job match notifications" }));

    await waitFor(() => expect(mocks.patchSettings).toHaveBeenCalledWith({
      notifications_enabled: false,
    }));
    expect(mocks.stopNativeNotifications).toHaveBeenCalledOnce();
  });

  it("sends a test only after native permission is granted", async () => {
    mocks.getNativeNotificationPermission.mockResolvedValue({
      success: true,
      permission: "granted",
    });
    mocks.sendTestNotification.mockResolvedValue({
      success: true,
      message: "Test notification sent",
    });
    renderNotifications(true);

    const sendButton = await screen.findByRole("button", { name: "Send test" });
    await waitFor(() => expect((sendButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton);

    await waitFor(() => expect(mocks.sendTestNotification).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Test notification sent");
  });
});
