"use client";

import { useEffect, useState } from "react";

import { sendLifecycleHeartbeat } from "@/lib/api/clients/lifecycle";
import { APP_VERSION } from "@/lib/constants";

export const LifecycleListener = () => {
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const id = crypto.randomUUID();
    let disposed = false;
    let supported = true;
    let timer: ReturnType<typeof setTimeout>;
    const heartbeat = async () => {
      try {
        const result = await sendLifecycleHeartbeat(id);
        if (disposed) return;
        supported = result.supported !== false;
        if (window.sessionStorage.getItem("switchy-update-requested") === "true") {
          setUpdating(result.updating);
          if (result.version !== APP_VERSION && !result.updating) {
            window.sessionStorage.removeItem("switchy-update-requested");
            window.location.reload();
          }
        }
      } catch {
        if (!disposed && window.sessionStorage.getItem("switchy-update-requested") === "true") setUpdating(true);
      } finally {
        if (!disposed && supported) timer = setTimeout(() => void heartbeat(), window.sessionStorage.getItem("switchy-update-requested") === "true" ? 10_000 : 30_000);
      }
    };
    void heartbeat();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  return updating ? <div role="status" className="fixed inset-x-0 top-0 z-50 bg-primary px-4 py-3 text-center text-sm text-primary-foreground">Switchy is updating. This page will reconnect automatically.</div> : null;
};
