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
}

export const SESSION_STATUS_CONFIG: Record<string, StatusConfig> = {
  completed: {
    icon: CheckCircle,
    label: "Completed",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
  },
  in_progress: {
    icon: Clock,
    label: "In Progress",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  partial: {
    icon: AlertCircle,
    label: "Partial",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
  },
  queued: {
    icon: Clock,
    label: "In Queue",
    color: "text-zinc-400",
    bgColor: "bg-zinc-500/10",
    borderColor: "border-zinc-500/20",
  },
};

export const LOG_STATUS_CONFIG: Record<string, { icon: LucideIcon; color: string }> = {
  success: {
    icon: CheckCircle,
    color: "text-emerald-400",
  },
  error: {
    icon: XCircle,
    color: "text-red-400",
  },
  partial: {
    icon: AlertCircle,
    color: "text-yellow-400",
  },
};

export const MATCHER_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "text-zinc-400" },
  in_progress: { label: "In Progress", color: "text-blue-400" },
  completed: { label: "Completed", color: "text-emerald-400" },
  failed: { label: "Failed", color: "text-red-400" },
};

export function getSessionStatusConfig(status: string): StatusConfig {
  return SESSION_STATUS_CONFIG[status] || SESSION_STATUS_CONFIG.in_progress;
}

export function getLogStatusConfig(status: string): { icon: LucideIcon; color: string } {
  return LOG_STATUS_CONFIG[status] || LOG_STATUS_CONFIG.partial;
}

export function getMatcherStatusConfig(
  status: string
): { label: string; color: string } {
  return MATCHER_STATUS_CONFIG[status] || MATCHER_STATUS_CONFIG.pending;
}
