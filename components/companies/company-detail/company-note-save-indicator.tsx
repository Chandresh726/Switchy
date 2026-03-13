"use client";

import { CheckCircle2, Loader2 } from "lucide-react";

export type NoteSaveIndicatorState = "hidden" | "saving" | "saved";

interface CompanyNoteSaveIndicatorProps {
  state: NoteSaveIndicatorState;
}

export function CompanyNoteSaveIndicator({ state }: CompanyNoteSaveIndicatorProps) {
  if (state === "hidden") {
    return null;
  }

  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Saved
    </span>
  );
}
