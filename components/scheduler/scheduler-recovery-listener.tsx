"use client";

import { useEffect, useRef } from "react";

import { APP_REQUEST_HEADERS } from "@/lib/api/request-headers";

const RECOVERY_COOLDOWN_MS = 15_000;
const RECOVERY_STABILIZATION_MS = 10_000;
const SLEEP_DRIFT_THRESHOLD_MS = 75_000;
const TICK_INTERVAL_MS = 30_000;

async function requestRecovery(): Promise<void> {
  const response = await fetch("/api/scheduler/recover", {
    method: "POST",
    headers: APP_REQUEST_HEADERS,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Recovery request failed with HTTP ${response.status}`);
  }
}

export function SchedulerRecoveryListener() {
  const inFlightRef = useRef(false);
  const lastAttemptAtRef = useRef(0);
  const recoveryPendingRef = useRef(false);
  const stabilizationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearStabilizationTimer = () => {
      if (stabilizationTimerRef.current === null) return;
      window.clearTimeout(stabilizationTimerRef.current);
      stabilizationTimerRef.current = null;
    };

    const isReadyForRecovery = () =>
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      navigator.onLine;

    const maybeRecover = async (): Promise<boolean> => {
      const now = Date.now();
      if (inFlightRef.current || now - lastAttemptAtRef.current < RECOVERY_COOLDOWN_MS) {
        return false;
      }

      inFlightRef.current = true;
      lastAttemptAtRef.current = now;

      let succeeded = false;
      try {
        await requestRecovery();
        succeeded = true;
      } catch (error) {
        console.error("[Scheduler Recovery Listener] Failed to request recovery:", error);
      } finally {
        inFlightRef.current = false;
      }
      return succeeded;
    };

    const schedulePendingRecovery = () => {
      clearStabilizationTimer();
      if (!recoveryPendingRef.current || !isReadyForRecovery()) return;

      stabilizationTimerRef.current = window.setTimeout(() => {
        stabilizationTimerRef.current = null;
        if (!recoveryPendingRef.current || !isReadyForRecovery()) return;

        void maybeRecover().then((started) => {
          if (started) {
            recoveryPendingRef.current = false;
          } else if (recoveryPendingRef.current) {
            schedulePendingRecovery();
          }
        });
      }, RECOVERY_STABILIZATION_MS);
    };

    const markRecoveryPending = () => {
      recoveryPendingRef.current = true;
      schedulePendingRecovery();
    };

    markRecoveryPending();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markRecoveryPending();
      } else {
        clearStabilizationTimer();
      }
    };

    const handleFocus = () => {
      markRecoveryPending();
    };

    const handleOnline = () => {
      markRecoveryPending();
    };

    const handleOffline = () => {
      clearStabilizationTimer();
    };

    let expectedTickAt = Date.now() + TICK_INTERVAL_MS;
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (now - expectedTickAt > SLEEP_DRIFT_THRESHOLD_MS) {
        markRecoveryPending();
      }
      expectedTickAt = now + TICK_INTERVAL_MS;
    }, TICK_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearInterval(interval);
      clearStabilizationTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return null;
}
