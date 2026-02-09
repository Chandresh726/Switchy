"use client";

import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12">
      <Icon className="h-12 w-12 text-zinc-600" />
      <h3 className="mt-4 text-lg font-medium text-white">{title}</h3>
      <p className="mt-1 max-w-sm text-center text-sm text-zinc-400">{description}</p>
      {action && (
        <Button variant="outline" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
