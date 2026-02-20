"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  Briefcase,
  Building2,
  Settings,
  User,
  LayoutDashboard,
  History,
} from "lucide-react";

const ThemeToggle = dynamic(
  () => import("@/components/dashboard/theme-toggle").then((mod) => mod.ThemeToggle),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground">
        Theme
      </div>
    ),
  }
);

const mainNavigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "Companies", href: "/companies", icon: Building2 },
  { name: "Profile", href: "/profile", icon: User },
];

const historyNavigation = { name: "History", href: "/history", icon: History };
const settingsNavigation = { name: "Settings", href: "/settings", icon: Settings };

export function Sidebar() {
  const pathname = usePathname();

  const renderNavItem = (item: { name: string; href: string; icon: React.ElementType }) => {
    const isActive =
      pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(item.href));

    return (
      <Link
        key={item.name}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-emerald-500/10 text-emerald-500"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <item.icon className="h-5 w-5" />
        {item.name}
      </Link>
    );
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-6">
        <span className="text-xl font-semibold text-foreground">Switchy</span>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {mainNavigation.map(renderNavItem)}
      </nav>

      {/* Bottom Navigation */}
      <div className="space-y-1 border-t border-sidebar-border px-3 py-4">
        {renderNavItem(historyNavigation)}
        <ThemeToggle />
        {renderNavItem(settingsNavigation)}
      </div>
    </aside>
  );
}
