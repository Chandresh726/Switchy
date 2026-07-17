import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanyNotesProvider } from "@/components/companies/company-detail/company-notes-context";
import { CompanyNotesTab } from "@/components/companies/company-detail/company-notes-tab";

const mocks = vi.hoisted(() => ({
  patchCompany: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/clients/companies", () => ({ patchCompany: mocks.patchCompany }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

describe("company notes autosave failures", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("attempts a rejected draft once and never reports success", async () => {
    vi.useFakeTimers();
    mocks.patchCompany.mockRejectedValue(new Error("Notes unavailable"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CompanyNotesProvider>
          <CompanyNotesTab companyId={7} note="Original" />
        </CompanyNotesProvider>
      </QueryClientProvider>
    );

    const editor = screen.getByRole("textbox");
    editor.innerText = "Unsaved draft";
    fireEvent.input(editor);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.patchCompany).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(mocks.patchCompany).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
