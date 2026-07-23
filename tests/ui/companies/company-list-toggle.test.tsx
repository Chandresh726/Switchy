import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyList } from "@/components/companies/company-list";
import {
  companiesResponseSchema,
  type Company,
} from "@/lib/api/contracts/companies";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({
  patchCompany: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock("@/lib/api/clients/companies", () => ({
  deleteCompany: vi.fn(),
  deleteCompanyJobs: vi.fn(),
  patchCompany: mocks.patchCompany,
}));

const companies = companiesResponseSchema.parse([
  {
    id: 1,
    name: "Alpha",
    careersUrl: "https://alpha.example/careers",
    logoUrl: null,
    notes: null,
    platform: "custom",
    boardToken: null,
    isActive: true,
    lastScrapedAt: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Beta",
    careersUrl: "https://beta.example/careers",
    logoUrl: null,
    notes: null,
    platform: "custom",
    boardToken: null,
    isActive: true,
    lastScrapedAt: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  },
]);

function CompanyListHarness() {
  const companiesQuery = useQuery({
    queryKey: queryKeys.companies.list(),
    queryFn: async () => companies,
  });

  return (
    <CompanyList
      companies={companiesQuery.data ?? []}
      isLoading={companiesQuery.isLoading}
      selectionMode={false}
      selectedIds={[]}
      onToggleSelection={vi.fn()}
      onEditCompany={vi.fn()}
      onRefreshJobs={vi.fn()}
      onRefreshMatches={vi.fn()}
      isRefreshing={false}
      isMatching={false}
    />
  );
}

function renderCompanyList() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: Infinity },
    },
  });
  queryClient.setQueryData(queryKeys.companies.list(), companies);

  render(
    <QueryClientProvider client={queryClient}>
      <CompanyListHarness />
    </QueryClientProvider>
  );

  return queryClient;
}

describe("CompanyList active toggles", () => {
  beforeEach(() => {
    mocks.patchCompany.mockReset();
    mocks.toastError.mockReset();
  });

  it("updates and disables only the selected company while the request is pending", async () => {
    let resolvePatch: ((company: Company) => void) | undefined;
    mocks.patchCompany.mockImplementation(() => new Promise<Company>((resolve) => {
      resolvePatch = resolve;
    }));
    const queryClient = renderCompanyList();
    const alphaSwitch = screen.getByRole("switch", { name: "Alpha active status" });
    const betaSwitch = screen.getByRole("switch", { name: "Beta active status" });

    fireEvent.click(alphaSwitch);

    await waitFor(() => expect(alphaSwitch.getAttribute("aria-checked")).toBe("false"));
    expect(alphaSwitch.hasAttribute("disabled")).toBe(true);
    expect(betaSwitch.hasAttribute("disabled")).toBe(false);
    expect(betaSwitch.getAttribute("aria-checked")).toBe("true");
    expect(mocks.patchCompany).toHaveBeenCalledWith(1, { isActive: false });
    expect(queryClient.getQueryData<Company[]>(queryKeys.companies.list())?.[1])
      .toBe(companies[1]);

    resolvePatch?.({
      ...companies[0],
      isActive: false,
      updatedAt: "2026-07-23T00:00:01.000Z",
    });

    await waitFor(() => expect(alphaSwitch.hasAttribute("disabled")).toBe(false));
    expect(betaSwitch.hasAttribute("disabled")).toBe(false);
  });

  it("rolls back only the selected company when the update fails", async () => {
    mocks.patchCompany.mockRejectedValue(new Error("Update failed"));
    renderCompanyList();
    const alphaSwitch = screen.getByRole("switch", { name: "Alpha active status" });
    const betaSwitch = screen.getByRole("switch", { name: "Beta active status" });

    fireEvent.click(alphaSwitch);

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(alphaSwitch.getAttribute("aria-checked")).toBe("true");
    expect(betaSwitch.getAttribute("aria-checked")).toBe("true");
    expect(betaSwitch.hasAttribute("disabled")).toBe(false);
  });
});
