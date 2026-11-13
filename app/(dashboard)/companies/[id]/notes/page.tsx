"use client";

import { CompanyNotesTab } from "@/components/companies/company-detail";
import { useCompanyOverview } from "@/components/companies/company-detail/company-overview-context";

export default function CompanyNotesPage() {
  const data = useCompanyOverview();
  return <CompanyNotesTab companyId={data.company.id} note={data.company.notes} />;
}
