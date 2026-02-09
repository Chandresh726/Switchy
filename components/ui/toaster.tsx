"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "rgb(24 24 27)", // zinc-900
          border: "1px solid rgb(39 39 42)", // zinc-800
          color: "rgb(250 250 250)", // zinc-50
        },
      }}
    />
  );
}
