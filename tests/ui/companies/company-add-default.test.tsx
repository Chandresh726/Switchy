import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CompaniesPage from "@/app/(dashboard)/companies/page";
import type { Company } from "@/lib/api/contracts/companies";
import { parsePresetCompanies } from "@/lib/companies/preset-companies";

const mocks = vi.hoisted(() => ({
  getCompanies: vi.fn(),
  usePresetCompanies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/companies",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("sortBy=name&sortOrder=asc"),
}));

vi.mock("@/lib/api/clients/companies", () => ({
  bulkDeleteCompanies: vi.fn(),
  bulkDeleteCompanyJobs: vi.fn(),
  bulkSetCompaniesActive: vi.fn(),
  createCompanies: vi.fn(),
  getCompanies: mocks.getCompanies,
  matchCompanies: vi.fn(),
  refreshCompanyJobs: vi.fn(),
}));

vi.mock("@/lib/hooks/use-match-session", () => ({
  useMatchSession: vi.fn(),
}));

vi.mock("@/lib/hooks/use-preset-companies", () => ({
  usePresetCompanies: mocks.usePresetCompanies,
}));

vi.mock("@/components/companies/company-filters", () => ({
  CompanyFilters: ({ onAddCompany }: { onAddCompany: () => void }) => (
    <button type="button" onClick={onAddCompany}>Add Company</button>
  ),
}));

vi.mock("@/components/companies/company-form", () => ({
  CompanyForm: () => <div>Custom company form</div>,
}));

vi.mock("@/components/companies/company-quick-add", () => ({
  CompanyQuickAdd: () => <div>Quick Add choices</div>,
}));

vi.mock("@/components/companies/company-list", () => ({
  CompanyList: () => <div>Company list</div>,
}));

vi.mock("@/components/companies/json-editor", () => ({
  JsonEditor: () => <div>JSON editor</div>,
}));

const existingCompany: Company = {
  id: 1,
  name: "Acme",
  careersUrl: "https://jobs.lever.co/acme",
  logoUrl: null,
  notes: null,
  platform: "lever",
  boardToken: "acme",
  isActive: true,
  lastScrapedAt: null,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

const presets = parsePresetCompanies([
  {
    name: "Acme",
    careersUrl: "https://jobs.lever.co/acme",
    platform: "lever",
  },
]);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CompaniesPage />
    </QueryClientProvider>
  );
}

describe("Add Company default tab", () => {
  beforeEach(() => {
    mocks.getCompanies.mockReset();
    mocks.usePresetCompanies.mockReset();
    mocks.getCompanies.mockResolvedValue([existingCompany]);
  });

  it("opens Custom Company when every Quick Add preset is already present", async () => {
    mocks.usePresetCompanies.mockReturnValue({ data: presets });
    const { container } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add Company" }));

    await waitFor(() => {
      expect(screen.getByText("Custom company form")).toBeTruthy();
    });
    expect(screen.queryByText("Quick Add choices")).toBeNull();
    expect(container.querySelector('[data-slot="separator"]')).not.toBeNull();
  });

  it("opens Quick Add when at least one preset has not been added", async () => {
    mocks.usePresetCompanies.mockReturnValue({
      data: parsePresetCompanies([
        ...presets,
        {
          name: "Beta",
          careersUrl: "https://job-boards.greenhouse.io/beta",
          platform: "greenhouse",
        },
      ]),
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add Company" }));

    await waitFor(() => {
      expect(screen.getByText("Quick Add choices")).toBeTruthy();
    });
    expect(screen.queryByText("Custom company form")).toBeNull();
  });
});
