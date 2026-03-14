"use client";

import { useParams, usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/ui/empty-state";
import {
    CompanyHeader,
    CompanyStats,
    CompanyActions,
    CompanyAddPerson,
    CompanyNoteSaveIndicator,
    CompanyNotesProvider,
    useCompanyNotesContext,
    type CompanyOverviewResponse,
} from "@/components/companies/company-detail";
import { CompanyLayoutClient } from "@/components/companies/company-detail/company-layout-client";

function CompanyLayoutContent({
    children,
}: {
    children: React.ReactNode;
}) {
    const params = useParams();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const { noteSaveIndicator } = useCompanyNotesContext();

    const companyId = Number(params.id);
    const activeTab = pathname?.startsWith(`/companies/${companyId}/people`)
        ? "people"
        : pathname?.startsWith(`/companies/${companyId}/activity`)
            ? "activity"
            : pathname?.startsWith(`/companies/${companyId}/notes`)
                ? "notes"
                : "jobs";

    const { data, isLoading } = useQuery<CompanyOverviewResponse>({
        queryKey: ["company-overview", companyId],
        queryFn: async () => {
            const res = await fetch(`/api/companies/${companyId}/overview`);
            if (!res.ok) throw new Error("Failed to fetch company overview");
            return res.json();
        },
        enabled: Number.isFinite(companyId),
    });

    const refreshJobsMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch("/api/companies/refresh-jobs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyIds: [companyId] }),
            });
            if (!res.ok) throw new Error("Failed to refresh jobs");
            return res.json();
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ["company-overview", companyId] });
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            toast.success(result.message || "Jobs refreshed successfully");
        },
        onError: () => {
            toast.error("Failed to refresh jobs");
        },
    });

    const runMatchingMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch("/api/companies/match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyIds: [companyId] }),
            });
            if (!res.ok) throw new Error("Failed to run matching");
            return res.json();
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ["company-overview", companyId] });
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            queryClient.invalidateQueries({ queryKey: ["match-history"] });
            toast.success(result.message || "Matching completed successfully");
        },
        onError: () => {
            toast.error("Failed to run matching");
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!data) {
        return (
            <EmptyState
                icon={Building2}
                title="Company not found"
                description="We could not load this company overview."
            />
        );
    }

    return (
        <div className="space-y-6">
            <CompanyHeader company={data.company} />

            <CompanyStats stats={data.stats} />

            <CompanyLayoutClient
                companyId={companyId}
                rightSlot={
                    activeTab === "jobs" ? (
                        <CompanyActions
                            canRefreshJobs={data.company.canScrapeJobs}
                            canRunMatching={data.stats.openJobs > 0}
                            isRefreshing={refreshJobsMutation.isPending}
                            isMatching={runMatchingMutation.isPending}
                            onRefreshJobs={() => refreshJobsMutation.mutate()}
                            onRunMatching={() => runMatchingMutation.mutate()}
                        />
                    ) : activeTab === "people" ? (
                        <CompanyAddPerson
                            companyId={companyId}
                            companyName={data.company.name}
                            onAdded={() => {
                                queryClient.invalidateQueries({ queryKey: ["company-overview", companyId] });
                            }}
                        />
                    ) : activeTab === "notes" ? (
                        <CompanyNoteSaveIndicator state={noteSaveIndicator} />
                    ) : null
                }
            >
                {children}
            </CompanyLayoutClient>
        </div>
    );
}

export default function CompanyLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <CompanyNotesProvider>
            <CompanyLayoutContent>{children}</CompanyLayoutContent>
        </CompanyNotesProvider>
    );
}
