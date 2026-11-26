"use client";

import { useEffect, useState } from "react";

import { sendLifecycleHeartbeat } from "@/lib/api/clients/lifecycle";
import { APP_VERSION } from "@/lib/constants";
import { clearBrowserReconnect, UPDATE_REQUESTED_EVENT, updateWasRequested } from "@/lib/runtime/browser-update";

export const LifecycleListener = () => {
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const id = crypto.randomUUID();
    let disposed = false;
    let supported = true;
    let inFlight = false;
    let wakePending = false;
    let reconnectAttempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const heartbeat = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      try {
        const result = await sendLifecycleHeartbeat(id);
        if (disposed) return;
        supported = result.supported !== false;
        if (updateWasRequested()) {
          setUpdating(result.updating);
          if (result.version !== APP_VERSION && !result.updating) {
            clearBrowserReconnect();
            window.location.reload();
          }
        }
      } catch {
        if (!disposed && updateWasRequested()) setUpdating(true);
      } finally {
        inFlight = false;
        const delay = wakePending ? 0 : updateWasRequested()
          ? Math.min(1000 * 2 ** Math.min(reconnectAttempts++, 3), 5000) : 30_000;
        wakePending = false;
        if (!disposed && supported) timer = setTimeout(() => void heartbeat(), delay);
      }
    };
    const wake = () => {
      if (!updateWasRequested() || disposed) return;
      reconnectAttempts = 0;
      clearTimeout(timer);
      if (inFlight) wakePending = true;
      else void heartbeat();
    };
    window.addEventListener(UPDATE_REQUESTED_EVENT, wake);
    window.addEventListener("online", wake);
    void heartbeat();
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener(UPDATE_REQUESTED_EVENT, wake);
      window.removeEventListener("online", wake);
    };
  }, []);
  return updating ? <div role="status" className="fixed inset-x-0 top-0 z-50 bg-primary px-4 py-3 text-center text-sm text-primary-foreground">Switchy is updating. This page will reconnect automatically.</div> : null;
};
