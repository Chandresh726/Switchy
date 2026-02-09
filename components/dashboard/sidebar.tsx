"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  Building2,
  Settings,
  User,
  LayoutDashboard,
  RefreshCw,
  History,
} from "lucide-react";

const mainNavigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "Companies", href: "/companies", icon: Building2 },
  { name: "Profile", href: "/profile", icon: User },
];

const bottomNavigation = [
  { name: "History", href: "/history", icon: History },
  { name: "Settings", href: "/settings", icon: Settings },
];

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
            : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
        )}
      >
        <item.icon className="h-5 w-5" />
        {item.name}
      </Link>
    );
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-zinc-800 px-6">
        <RefreshCw className="h-6 w-6 text-emerald-500" />
        <span className="text-xl font-semibold text-white">Switchy</span>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {mainNavigation.map(renderNavItem)}
      </nav>

      {/* Bottom Navigation */}
      <div className="border-t border-zinc-800 px-3 py-4 space-y-1">
        {bottomNavigation.map(renderNavItem)}
      </div>
    </aside>
  );
}
