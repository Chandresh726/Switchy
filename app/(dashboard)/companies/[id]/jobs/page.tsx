"use client";

import { CompanyJobsTab } from "@/components/companies/company-detail";
import { useCompanyOverview } from "@/components/companies/company-detail/company-overview-context";

export default function CompanyJobsPage() {
  const data = useCompanyOverview();
  return <CompanyJobsTab company={data.company} jobs={data.jobs} topMatches={data.topMatches} />;
}
