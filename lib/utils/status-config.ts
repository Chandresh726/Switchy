import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";

export interface StatusConfig {
  icon: LucideIcon;
  label: string;
  color: string;
  bgColor: string;
  borderColor?: string;
  /** Solid colour for the leading-edge rail on session cards. */
  railColor: string;
}

const SESSION_STATUS_CONFIG: Record<string, StatusConfig> = {
  completed: {
    icon: CheckCircle,
    label: "Completed",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    railColor: "bg-emerald-400",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    railColor: "bg-red-400",
  },
  cancelled: {
    icon: XCircle,
    label: "Cancelled",
    color: "text-zinc-400",
    bgColor: "bg-zinc-500/10",
    borderColor: "border-zinc-500/20",
    railColor: "bg-zinc-500",
  },
  in_progress: {
    icon: Clock,
    label: "In Progress",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    railColor: "bg-blue-400",
  },
  partial: {
    icon: AlertCircle,
    label: "Partial",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
    railColor: "bg-amber-400",
  },
  skipped: {
    icon: AlertCircle,
    label: "Skipped",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    railColor: "bg-amber-400",
  },
  queued: {
    icon: Clock,
    label: "In Queue",
    color: "text-zinc-400",
    bgColor: "bg-zinc-500/10",
    borderColor: "border-zinc-500/20",
    railColor: "bg-zinc-500",
  },
};

export const MATCHER_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "text-zinc-400" },
  in_progress: { label: "In Progress", color: "text-blue-400" },
  completed: { label: "Completed", color: "text-emerald-400" },
  failed: { label: "Failed", color: "text-red-400" },
};

export function getSessionStatusConfig(status: string): StatusConfig {
  let normalized = status.toLowerCase();
  if (normalized === "success") normalized = "completed";
  if (normalized === "error") normalized = "failed";
  return SESSION_STATUS_CONFIG[normalized] || SESSION_STATUS_CONFIG.in_progress;
}
