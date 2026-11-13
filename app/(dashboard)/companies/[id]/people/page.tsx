"use client";

import { CompanyPeopleTab } from "@/components/companies/company-detail";
import { useCompanyOverview } from "@/components/companies/company-detail/company-overview-context";

export default function CompanyPeoplePage() {
  const data = useCompanyOverview();
  return <CompanyPeopleTab people={data.people} />;
}
