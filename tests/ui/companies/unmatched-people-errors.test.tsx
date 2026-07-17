import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UnmatchedPeopleModal } from "@/components/companies/unmatched-people-modal";
import { APIClientError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  getUnmatchedCompanies: vi.fn(),
}));

vi.mock("@/lib/api/clients/people", () => ({
  getUnmatchedCompanies: mocks.getUnmatchedCompanies,
  getUnmatchedCompanyPeople: vi.fn(),
  updateUnmatchedCompany: vi.fn(),
}));

describe("unmatched people modal failures", () => {
  it("renders a retryable error instead of zero counts or an empty collection", async () => {
    mocks.getUnmatchedCompanies.mockRejectedValue(
      new APIClientError("Mapping data unavailable", 500, "internal_error", undefined, "req-mapping")
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <UnmatchedPeopleModal open onOpenChange={vi.fn()} companies={[]} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Mapping data unavailable")).toBeTruthy();
    expect(screen.getByText("Request ID: req-mapping")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No unmatched companies found for current filters.")).toBeNull();
    expect(screen.queryByText("0 unmatched companies")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unmapped (0)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ignored (0)" })).toBeNull();
  });
});
