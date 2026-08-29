import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyForm } from "@/components/companies/company-form";
import type { Company } from "@/lib/api/contracts/companies";

const mocks = vi.hoisted(() => ({
  createCompanies: vi.fn(),
  updateCompany: vi.fn(),
}));

vi.mock("@/lib/api/clients/companies", () => ({
  createCompanies: mocks.createCompanies,
  updateCompany: mocks.updateCompany,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const existingCompany: Company = {
  id: 1,
  name: "Acme",
  careersUrl: "https://jobs.lever.co/acme",
  logoUrl: null,
  notes: "Follow up next week",
  platform: "lever",
  boardToken: "acme",
  isActive: true,
  lastScrapedAt: null,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

function renderForm(company?: Company) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CompanyForm company={company} />
    </QueryClientProvider>
  );
}

describe("CompanyForm create fields", () => {
  beforeEach(() => {
    mocks.createCompanies.mockReset();
    mocks.updateCompany.mockReset();
    mocks.createCompanies.mockResolvedValue(existingCompany);
  });

  it("omits Notes from custom company creation and from its payload", async () => {
    renderForm();

    expect(screen.queryByRole("heading", { name: "Add Company" })).toBeNull();
    expect(screen.queryByLabelText("Notes")).toBeNull();
    fireEvent.change(screen.getByLabelText("Company Name *"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText("Careers Page URL *"), {
      target: { value: "https://jobs.lever.co/acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Company" }));

    await waitFor(() => expect(mocks.createCompanies).toHaveBeenCalledTimes(1));
    const payload = mocks.createCompanies.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      name: "Acme",
      careersUrl: "https://jobs.lever.co/acme",
    });
    expect(payload).not.toHaveProperty("notes");
  });

  it("keeps Notes available while editing an existing company", async () => {
    renderForm(existingCompany);

    expect(screen.queryByRole("heading", { name: "Edit Company" })).toBeNull();
    const notes = await screen.findByLabelText("Notes");
    expect((notes as HTMLTextAreaElement).value).toBe("Follow up next week");
  });

  it("shows a logo preview only after a valid logo URL is provided", () => {
    renderForm();

    expect(screen.queryByRole("img")).toBeNull();

    fireEvent.change(screen.getByLabelText("Company Name *"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText("Logo URL (Optional)"), {
      target: { value: "https://example.com/acme.png" },
    });

    const preview = screen.getByRole("img", { name: "Acme logo preview" });
    expect(preview.getAttribute("src")).toBe("https://example.com/acme.png");

    fireEvent.error(preview);
    expect(screen.getByLabelText("Logo preview unavailable")).toBeTruthy();
  });

  it("supports a manual SmartRecruiters identifier for a branded careers URL", async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Company Name *"), {
      target: { value: "PhonePe" },
    });
    fireEvent.change(screen.getByLabelText("Careers Page URL *"), {
      target: { value: "https://www.phonepe.com/careers/job-openings/" },
    });
    fireEvent.click(screen.getByLabelText("This company uses a known ATS"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "smartrecruiters" },
    });

    expect(screen.getByPlaceholderText("Company identifier")).toBeTruthy();
    expect(screen.getByText(/case-sensitive company identifier/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Company identifier"), {
      target: { value: "PHONEPELIMITED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Company" }));

    await waitFor(() => expect(mocks.createCompanies).toHaveBeenCalledTimes(1));
    expect(mocks.createCompanies).toHaveBeenCalledWith(expect.objectContaining({
      name: "PhonePe",
      careersUrl: "https://www.phonepe.com/careers/job-openings/",
      platform: "smartrecruiters",
      boardToken: "PHONEPELIMITED",
    }));
  });
});
