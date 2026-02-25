"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { CompanyActivityTab, type CompanyOverviewResponse } from "@/components/companies/company-detail";

export default function CompanyActivityPage() {
    const params = useParams();
    const companyId = Number(params.id);

    const { data, isLoading } = useQuery<CompanyOverviewResponse>({
        queryKey: ["company-overview", companyId],
        queryFn: async () => {
            const res = await fetch(`/api/companies/${companyId}/overview`);
            if (!res.ok) throw new Error("Failed to fetch company overview");
            return res.json();
        },
        enabled: Number.isFinite(companyId),
    });

    if (isLoading || !data) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return <CompanyActivityTab activity={data.activity} />;
}
