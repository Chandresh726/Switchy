"use client";

import { useState } from "react";

import { useParams, usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/ui/empty-state";
import { ApiErrorState } from "@/components/ui/api-error-state";
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
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage, isApiNotFoundError } from "@/lib/api/error-presentation";

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
        onSettled: () => setMatchSessionId(null),
    });
    const activeTab = pathname?.startsWith(`/companies/${companyId}/people`)
        ? "people"
        : pathname?.startsWith(`/companies/${companyId}/activity`)
            ? "activity"
            : pathname?.startsWith(`/companies/${companyId}/notes`)
                ? "notes"
                : "jobs";

    const { data, error, isError, isLoading, refetch } = useQuery<CompanyOverviewResponse>({
        queryKey: queryKeys.companies.overview(companyId),
        queryFn: async () => {
            return getCompanyOverview(companyId);
        },
        enabled: Number.isInteger(companyId) && companyId > 0,
    });

    const refreshJobsMutation = useMutation({
        mutationFn: async () => {
            return refreshCompanyJobs([companyId]);
        },
        onSuccess: (result) => {
            void cacheOwnership.companyMutation(queryClient, {
                companyId,
                affectsScrapeHistory: true,
            });
            toast.success(result.message || "Jobs refreshed successfully");
        },
        onError: (mutationError) => {
            toast.error(getApiErrorMessage(mutationError, "Failed to refresh jobs"));
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
        onError: (mutationError) => {
            toast.error(getApiErrorMessage(mutationError, "Failed to run matching"));
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (isError && !isApiNotFoundError(error)) {
        return (
            <ApiErrorState
                error={error}
                fallbackMessage="The company overview could not be loaded."
                onRetry={() => void refetch()}
            />
        );
    }

    if (!Number.isInteger(companyId) || companyId <= 0 || isApiNotFoundError(error) || !data) {
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
                                void cacheOwnership.peopleMutation(queryClient);
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
