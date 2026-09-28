import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSchedulerHostStatus: vi.fn(),
  installSchedulerHost: vi.fn(),
  uninstallSchedulerHost: vi.fn(),
  syncSchedulerHost: vi.fn(),
}));

vi.mock("@/lib/jobs/scheduler-host", () => ({
  getSchedulerHostStatus: mocks.getSchedulerHostStatus,
  installSchedulerHost: mocks.installSchedulerHost,
  uninstallSchedulerHost: mocks.uninstallSchedulerHost,
  syncSchedulerHost: mocks.syncSchedulerHost,
}));

import { GET, POST } from "@/app/api/scheduler/host/route";

const STATUS = {
  platform: "darwin",
  supported: true,
  serverAgentInstalled: true,
  tickAgentInstalled: true,
  serverAgentLoaded: true,
  tickAgentLoaded: true,
  schedulerEnabled: true,
};

function postAction(action: string): NextRequest {
  return new Request("http://localhost/api/scheduler/host", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "http://localhost",
      "x-switchy-request": "true",
    },
    body: JSON.stringify({ action }),
  }) as NextRequest;
}

describe("scheduler host route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchedulerHostStatus.mockResolvedValue(STATUS);
    mocks.syncSchedulerHost.mockResolvedValue("installed");
    mocks.installSchedulerHost.mockResolvedValue(undefined);
    mocks.uninstallSchedulerHost.mockResolvedValue(undefined);
  });

  it("returns host status", async () => {
    const response = await GET(new Request("http://localhost/api/scheduler/host"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(STATUS);
  });

  it("syncs the host on demand", async () => {
    const response = await POST(postAction("sync"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.syncSchedulerHost).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ result: "installed", status: STATUS });
  });

  it("installs and uninstalls explicitly", async () => {
    await expect(POST(postAction("install"))).resolves.toMatchObject({ status: 200 });
    expect(mocks.installSchedulerHost).toHaveBeenCalledTimes(1);

    await expect(POST(postAction("uninstall"))).resolves.toMatchObject({ status: 200 });
    expect(mocks.uninstallSchedulerHost).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown actions", async () => {
    const response = await POST(postAction("reboot"));

    expect(response.status).toBe(400);
  });
});
