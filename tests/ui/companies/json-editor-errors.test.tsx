import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JsonEditor } from "@/components/companies/json-editor";
import { APIClientError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  getCompanies: vi.fn(),
  syncCompanies: vi.fn(),
}));

vi.mock("@/lib/api/clients/companies", () => ({
  getCompanies: mocks.getCompanies,
  syncCompanies: mocks.syncCompanies,
}));

describe("company JSON editor loading", () => {
  it("never mounts the full-sync editor after the company query fails", async () => {
    mocks.getCompanies.mockRejectedValue(
      new APIClientError("Companies unavailable", 500, "internal_error", undefined, "req-companies-json")
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <JsonEditor onSuccess={vi.fn()} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Companies unavailable")).toBeTruthy();
    expect(screen.getByText("Request ID: req-companies-json")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(mocks.syncCompanies).not.toHaveBeenCalled();
  });
});
