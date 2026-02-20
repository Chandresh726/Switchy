import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearSchedulerEnabledCache: vi.fn(),
  getSchedulerEnabled: vi.fn(),
  restartScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  getSettingsWithDefaults: vi.fn(),
  parseSettingsUpdateBody: vi.fn(),
  upsertSettings: vi.fn(),
}));

vi.mock("@/lib/jobs/scheduler", () => ({
  clearSchedulerEnabledCache: mocks.clearSchedulerEnabledCache,
  getSchedulerEnabled: mocks.getSchedulerEnabled,
  restartScheduler: mocks.restartScheduler,
  stopScheduler: mocks.stopScheduler,
}));

vi.mock("@/lib/settings/settings-service", () => ({
  DEFAULT_SETTINGS: {},
  getSettingsWithDefaults: mocks.getSettingsWithDefaults,
  parseSettingsUpdateBody: mocks.parseSettingsUpdateBody,
  upsertSettings: mocks.upsertSettings,
}));

import { GET, POST } from "@/app/api/settings/route";

describe("settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettingsWithDefaults.mockResolvedValue({
      matcher_model: "gpt-4.1-mini",
      matcher_provider_id: "provider-1",
    });
    mocks.parseSettingsUpdateBody.mockReturnValue({
      updates: [],
      cronUpdated: false,
      enabledChanged: false,
      newEnabledValue: null,
    });
    mocks.upsertSettings.mockResolvedValue(undefined);
    mocks.getSchedulerEnabled.mockResolvedValue(true);
    mocks.restartScheduler.mockResolvedValue(undefined);
  });

  it("returns settings from service", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.matcher_model).toBe("gpt-4.1-mini");
  });

  it("returns 400 with typed code for invalid AI settings payload", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matcher_reasoning_effort: "ultra",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(mocks.parseSettingsUpdateBody).not.toHaveBeenCalled();
  });

  it("accepts cover_letter_focus as JSON string for backward compatibility", async () => {
    mocks.parseSettingsUpdateBody.mockReturnValue({
      updates: [{ key: "cover_letter_focus", value: "[\"skills\",\"experience\"]" }],
      cronUpdated: false,
      enabledChanged: false,
      newEnabledValue: null,
    });

    const request = new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cover_letter_focus: "[\"skills\",\"experience\"]",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.parseSettingsUpdateBody).toHaveBeenCalledTimes(1);
    expect(mocks.upsertSettings).toHaveBeenCalledWith([
      { key: "cover_letter_focus", value: "[\"skills\",\"experience\"]" },
    ]);
  });

  it("stops scheduler when scheduler_enabled changes to false", async () => {
    mocks.parseSettingsUpdateBody.mockReturnValue({
      updates: [{ key: "scheduler_enabled", value: "false" }],
      cronUpdated: false,
      enabledChanged: true,
      newEnabledValue: false,
    });

    const request = new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduler_enabled: false }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.upsertSettings).toHaveBeenCalledWith([
      { key: "scheduler_enabled", value: "false" },
    ]);
    expect(mocks.clearSchedulerEnabledCache).toHaveBeenCalledTimes(1);
    expect(mocks.stopScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.restartScheduler).not.toHaveBeenCalled();
  });

  it("restarts scheduler when cron changes and scheduler is enabled", async () => {
    mocks.parseSettingsUpdateBody.mockReturnValue({
      updates: [{ key: "scheduler_cron", value: "*/5 * * * *" }],
      cronUpdated: true,
      enabledChanged: false,
      newEnabledValue: null,
    });
    mocks.getSchedulerEnabled.mockResolvedValue(true);

    const request = new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduler_cron: "*/5 * * * *" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.clearSchedulerEnabledCache).toHaveBeenCalledTimes(1);
    expect(mocks.getSchedulerEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.restartScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.stopScheduler).not.toHaveBeenCalled();
  });
});
