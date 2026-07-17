"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { CompanyJobsTab } from "@/components/companies/company-detail";
import { getCompanyOverview } from "@/lib/api/clients/companies";
import type { CompanyOverviewResponse } from "@/lib/api/contracts/companies";
import { queryKeys } from "@/lib/query-keys";

export default function CompanyJobsPage() {
    const params = useParams();
    const companyId = Number(params.id);

    const { data, isLoading } = useQuery<CompanyOverviewResponse>({
        queryKey: queryKeys.companies.overview(companyId),
        queryFn: async () => {
            return getCompanyOverview(companyId);
        },
        enabled: Number.isInteger(companyId) && companyId > 0,
    });

    if (isLoading || !data) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <CompanyJobsTab
            company={data.company}
            jobs={data.jobs}
            topMatches={data.topMatches}
        />
    );
}
