"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Briefcase, Users, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface CompanyLayoutClientProps {
    companyId: number;
    rightSlot?: React.ReactNode;
    children: React.ReactNode;
}

const TABS = [
    { id: "jobs", label: "Jobs", icon: Briefcase, href: (id: number) => `/companies/${id}/jobs` },
    { id: "connections", label: "Connections", icon: Users, href: (id: number) => `/companies/${id}/connections` },
    { id: "activity", label: "Activity", icon: Activity, href: (id: number) => `/companies/${id}/activity` },
] as const;

export function CompanyLayoutClient({ companyId, rightSlot, children }: CompanyLayoutClientProps) {
    const pathname = usePathname();

    const activeTab = TABS.find((tab) =>
        pathname?.startsWith(`/companies/${companyId}/${tab.id}`)
    )?.id ?? "jobs";

    return (
        <>
            {/* Tab bar */}
            <div className="flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-1">
                    {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;

                        return (
                            <Link
                                key={tab.id}
                                href={tab.href(companyId)}
                                className={cn(
                                    "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px",
                                    isActive
                                        ? "border-emerald-500 text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                {tab.label}
                            </Link>
                        );
                    })}
                </div>

                {rightSlot && (
                    <div className="flex items-center gap-2 pb-1">
                        {rightSlot}
                    </div>
                )}
            </div>

            {/* Tab content */}
            <div className="pt-2">{children}</div>
        </>
    );
}
