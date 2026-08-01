import {
  CheckCircle2,
  FileX,
  Loader2,
  Upload,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { ResumeHistoryEntry } from "@/lib/api/contracts/history";

interface ParseStateConfig {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  railColor: string;
  spin?: boolean;
  hint?: string;
}

export const RESUME_HISTORY_POLL_INTERVAL_MS = 1_000;

export const RESUME_PARSE_STATE_CONFIG: Record<
  ResumeHistoryEntry["parseState"],
  ParseStateConfig
> = {
  parsed: {
    label: "Parsed",
    icon: CheckCircle2,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    railColor: "bg-emerald-400",
  },
  upload_only: {
    label: "No autofill",
    icon: Upload,
    color: "text-zinc-400",
    bgColor: "bg-zinc-500/10",
    railColor: "bg-zinc-500",
    hint: "Uploaded with autofill off, so no model ran",
  },
  failed: {
    label: "Parse failed",
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    railColor: "bg-red-400",
    hint: "No resume was stored for this attempt",
  },
  running: {
    label: "Parsing",
    icon: Loader2,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    railColor: "bg-blue-400",
    spin: true,
  },
  detached: {
    label: "File removed",
    icon: FileX,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    railColor: "bg-amber-400",
    hint: "The parse succeeded but its upload is no longer stored",
  },
};
