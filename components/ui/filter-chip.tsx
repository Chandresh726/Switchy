"use client";

import { X } from "lucide-react";

export function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 bg-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400">
      {label}
      <button
        onClick={onRemove}
        className="p-0.5 hover:bg-emerald-500/30"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
