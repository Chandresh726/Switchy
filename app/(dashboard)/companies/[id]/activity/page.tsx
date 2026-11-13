"use client";

import { CompanyActivityTab } from "@/components/companies/company-detail";
import { useCompanyOverview } from "@/components/companies/company-detail/company-overview-context";

export default function CompanyActivityPage() {
  const data = useCompanyOverview();
  return <CompanyActivityTab activity={data.activity} />;
}
