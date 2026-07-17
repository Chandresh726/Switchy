"use client";

import { useState } from "react";

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
} from "@/components/companies/company-detail";
import { CompanyLayoutClient } from "@/components/companies/company-detail/company-layout-client";
import {
    getCompanyOverview,
    matchCompanies,
    refreshCompanyJobs,
} from "@/lib/api/clients/companies";
import type { CompanyOverviewResponse } from "@/lib/api/contracts/companies";
import { useMatchSession } from "@/lib/hooks/use-match-session";

function CompanyLayoutContent({
    children,
}: {
    children: React.ReactNode;
}) {
    const params = useParams();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const [matchSessionId, setMatchSessionId] = useState<string | null>(null);
    const { noteSaveIndicator } = useCompanyNotesContext();

    const companyId = Number(params.id);
    useMatchSession(matchSessionId, {
        extraInvalidationKeys: [["company-overview", companyId]],
        onSettled: () => setMatchSessionId(null),
    });
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
            return getCompanyOverview(companyId);
        },
        enabled: Number.isFinite(companyId),
    });

    const refreshJobsMutation = useMutation({
        mutationFn: async () => {
            return refreshCompanyJobs([companyId]);
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
            return matchCompanies([companyId]);
        },
        onSuccess: (result: { sessionId: string; total: number }) => {
            setMatchSessionId(result.sessionId || null);
            toast.success(`Queued ${result.total} jobs for matching`);
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
                            isMatching={runMatchingMutation.isPending || Boolean(matchSessionId)}
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
