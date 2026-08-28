import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SystemInfo } from "@/components/settings/system-info";

const runtimeHealth = {
  databaseAvailable: true,
  schedulerInitialization: "ready" as const,
  queueRecovery: "ready" as const,
  lastSuccessfulRecoveryAt: null,
  lastSuccessfulDispatchAt: null,
  oldestQueuedWorkAgeMs: null,
  expiredLeaseCount: 0,
  lastError: null,
};

describe("SystemInfo runtime health", () => {
  it("shows pending health without claiming an empty state", () => {
    render(
      <SystemInfo
        version="1.0.0"
        dbPath="local database"
        isReadinessLoading
        isRuntimeHealthLoading
      />
    );

    expect(screen.getAllByText("Checking")).toHaveLength(4);
  });

  it("shows ready database, scheduler, and queue state", () => {
    render(
      <SystemInfo
        version="1.0.0"
        dbPath="local database"
        readiness={{
          ready: true,
          databaseAvailable: true,
          schedulerInitialization: "ready",
          queueRecovery: "ready",
        }}
        runtimeHealth={runtimeHealth}
      />
    );

    expect(screen.getAllByText("Ready")).toHaveLength(3);
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getByText("v1.0.0")).toBeTruthy();
    expect(screen.queryByText("Platforms")).toBeNull();
  });

  it("shows failed initialization and recovery state", () => {
    render(
      <SystemInfo
        version="1.0.0"
        dbPath="local database"
        readiness={{
          ready: false,
          databaseAvailable: true,
          schedulerInitialization: "failed",
          queueRecovery: "failed",
        }}
        runtimeHealth={{
          ...runtimeHealth,
          schedulerInitialization: "failed",
          queueRecovery: "failed",
        }}
      />
    );

    expect(screen.getByText("Not ready")).toBeTruthy();
    expect(screen.getAllByText("Failed")).toHaveLength(2);
  });

  it("shows unavailable when health endpoints fail", () => {
    render(
      <SystemInfo
        version="1.0.0"
        dbPath="local database"
        isReadinessUnavailable
        isRuntimeHealthUnavailable
      />
    );

    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
  });

  it("keeps authoritative readiness visible when runtime diagnostics fail", () => {
    render(
      <SystemInfo
        version="1.0.0"
        dbPath="local database"
        readiness={{
          ready: true,
          databaseAvailable: true,
          schedulerInitialization: "ready",
          queueRecovery: "ready",
        }}
        isRuntimeHealthUnavailable
      />
    );

    expect(screen.getAllByText("Ready")).toHaveLength(3);
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.queryByText("Unavailable")).toBeNull();
  });
});
