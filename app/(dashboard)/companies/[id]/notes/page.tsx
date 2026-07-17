"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { CompanyNotesTab } from "@/components/companies/company-detail";
import { getCompanyOverview } from "@/lib/api/clients/companies";
import type { CompanyOverviewResponse } from "@/lib/api/contracts/companies";
import { queryKeys } from "@/lib/query-keys";

export default function CompanyNotesPage() {
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

  return <CompanyNotesTab companyId={companyId} note={data.company.notes} />;
}
