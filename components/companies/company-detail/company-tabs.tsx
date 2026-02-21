"use client";

import type { ReactNode } from "react";
import { Briefcase, Users, Activity } from "lucide-react";

import { cn } from "@/lib/utils";

import type { Tab } from "./types";

interface CompanyTabsProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  rightSlot?: ReactNode;
}

const TAB_OPTIONS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "connections", label: "Connections", icon: Users },
  { id: "activity", label: "Activity", icon: Activity },
];

export function CompanyTabs({ activeTab, onTabChange, rightSlot }: CompanyTabsProps) {
  return (
    <div className="flex items-center justify-between border-b border-border">
      <div className="flex items-center gap-1">
        {TAB_OPTIONS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-emerald-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {rightSlot && (
        <div className="flex items-center gap-2 pb-1">
          {rightSlot}
        </div>
      )}
    </div>
  );
}
