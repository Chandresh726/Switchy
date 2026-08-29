import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CompanyQuickAdd } from "@/components/companies/company-quick-add";
import { parsePresetCompanies } from "@/lib/companies/preset-companies";

const presets = parsePresetCompanies([
  {
    name: "Acme",
    careersUrl: "https://jobs.lever.co/acme/open-roles",
    logoUrl: "https://example.com/acme.png",
    platform: "lever",
  },
]);

vi.mock("@/lib/hooks/use-preset-companies", () => ({
  usePresetCompanies: () => ({
    data: presets,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/api/clients/companies", () => ({
  createCompanies: vi.fn(),
}));

function renderQuickAdd() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <CompanyQuickAdd existingCompanies={[]} />
    </QueryClientProvider>
  );
}

describe("CompanyQuickAdd row layout", () => {
  it("shows the company name above the card-style careers URL", () => {
    renderQuickAdd();

    expect(screen.getByText("Acme")).toBeTruthy();
    const careersLink = screen.getByRole("link", {
      name: "jobs.lever.co/acme/open-roles",
    });
    expect(careersLink.getAttribute("href")).toBe(
      "https://jobs.lever.co/acme/open-roles"
    );
    expect(screen.queryByText("Visit careers page")).toBeNull();
    expect(screen.queryByText(/Showing .* preset companies/)).toBeNull();
    expect(screen.queryByText(/\d+ selected/)).toBeNull();
    expect(screen.getByRole("button", { name: "Select All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select Visible" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear Visible" })).toBeNull();
  });
});
