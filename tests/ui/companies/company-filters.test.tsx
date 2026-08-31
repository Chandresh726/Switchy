import { useState } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CompanyFilters,
  type CompanyFilters as CompanyFilterValues,
} from "@/components/companies/company-filters";

const DEFAULT_FILTERS: CompanyFilterValues = {
  search: "",
  platforms: [],
  status: [],
  sortBy: "name",
  sortOrder: "asc",
};

function CompanyFiltersHarness() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  return (
    <CompanyFilters
      filters={filters}
      onFiltersChange={setFilters}
      selectionMode={false}
      selectedIds={[]}
      onToggleSelectionMode={vi.fn()}
      onClearSelection={vi.fn()}
      onSelectAll={vi.fn()}
      onBulkRefreshJobs={vi.fn()}
      onBulkRefreshMatches={vi.fn()}
      onBulkDeleteJobs={vi.fn()}
      onBulkDeleteCompanies={vi.fn()}
      onBulkToggleActive={vi.fn()}
      onAddCompany={vi.fn()}
      isRefreshing={false}
      isMatching={false}
      isDeletingJobs={false}
      isDeletingCompanies={false}
      isTogglingActive={false}
    />
  );
}

describe("CompanyFilters", () => {
  it("searches and adds multiple scraper filters from one dropdown", () => {
    render(<CompanyFiltersHarness />);

    expect(screen.queryByRole("button", { name: "Greenhouse" })).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Scrapers" }));

    const search = screen.getByRole("combobox", { name: "Search scrapers" });
    fireEvent.change(search, { target: { value: "oracle" } });

    expect(screen.getByRole("option", { name: "Oracle Recruiting" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Greenhouse" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Oracle Recruiting" }));

    expect(screen.getByRole("combobox", { name: "Scrapers (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Oracle Recruiting filter" })).toBeTruthy();

    fireEvent.change(search, { target: { value: "workday" } });
    fireEvent.click(screen.getByRole("option", { name: "Workday" }));

    expect(screen.getByRole("combobox", { name: "Scrapers (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Workday filter" })).toBeTruthy();
  });
});
