"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { persistSidebarCollapsedAction } from "@/app/actions/sidebar";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_COOKIE_MAX_AGE,
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_STORAGE_KEY,
} from "@/lib/sidebar-preferences";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Building2,
  ChevronLeft,
  ChevronRight,
  History,
  LayoutDashboard,
  Settings,
  User,
  Users,
} from "lucide-react";

const mainNavigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "Companies", href: "/companies", icon: Building2 },
  { name: "Profile", href: "/profile", icon: User },
];

const peopleNavigation = { name: "People", href: "/people", icon: Users };
const historyNavigation = { name: "History", href: "/history", icon: History };
const settingsNavigation = { name: "Settings", href: "/settings", icon: Settings };

function persistSidebarCollapsedClient(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Ignore storage errors
  }

  if (collapsed) {
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=true; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`;
  } else {
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

interface SidebarProps {
  initialCollapsed?: boolean;
}

export function Sidebar({ initialCollapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      persistSidebarCollapsedClient(next);
      void persistSidebarCollapsedAction(next);
      return next;
    });
  };

  const renderNavItem = (item: { name: string; href: string; icon: React.ElementType }) => {
    const isActive =
      pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(item.href));

    return (
      <Link
        key={item.name}
        href={item.href}
        title={collapsed ? item.name : undefined}
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-colors",
          collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
          isActive
            ? "bg-emerald-500/10 text-emerald-500"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span>{item.name}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        {collapsed ? (
          <Image
            src="/Switchy-logo-nobg.png"
            alt="Switchy"
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
            title="Switchy"
          />
        ) : (
          <span className="text-xl font-semibold text-foreground">Switchy</span>
        )}
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center border-b border-sidebar-border py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Main Navigation */}
      <nav className={cn("flex-1 space-y-1 py-4", collapsed ? "px-2" : "px-3")}>
        {mainNavigation.map(renderNavItem)}
      </nav>

      {/* Bottom Navigation */}
      <div
        className={cn(
          "space-y-1 border-t border-sidebar-border py-4",
          collapsed ? "px-2" : "px-3"
        )}
      >
        {renderNavItem(peopleNavigation)}
        {renderNavItem(historyNavigation)}
        {renderNavItem(settingsNavigation)}
        <ThemeToggle collapsed={collapsed} />
      </div>
    </aside>
  );
}
