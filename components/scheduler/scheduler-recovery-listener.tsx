"use client";

import { useEffect, useRef } from "react";

import { APP_REQUEST_HEADERS } from "@/lib/api/request-headers";

const RECOVERY_COOLDOWN_MS = 15_000;
const SLEEP_DRIFT_THRESHOLD_MS = 75_000;
const TICK_INTERVAL_MS = 30_000;

async function requestRecovery(): Promise<void> {
  await fetch("/api/scheduler/recover", {
    method: "POST",
    headers: APP_REQUEST_HEADERS,
    cache: "no-store",
  });
}

export function SchedulerRecoveryListener() {
  const inFlightRef = useRef(false);
  const lastAttemptAtRef = useRef(0);

  useEffect(() => {
    const maybeRecover = async () => {
      const now = Date.now();
      if (inFlightRef.current || now - lastAttemptAtRef.current < RECOVERY_COOLDOWN_MS) {
        return;
      }

      inFlightRef.current = true;
      lastAttemptAtRef.current = now;

      try {
        await requestRecovery();
      } catch (error) {
        console.error("[Scheduler Recovery Listener] Failed to request recovery:", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    void maybeRecover();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void maybeRecover();
      }
    };

    const handleFocus = () => {
      void maybeRecover();
    };

    let expectedTickAt = Date.now() + TICK_INTERVAL_MS;
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (now - expectedTickAt > SLEEP_DRIFT_THRESHOLD_MS) {
        void maybeRecover();
      }
      expectedTickAt = now + TICK_INTERVAL_MS;
    }, TICK_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return null;
}
