import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EducationEditor } from "@/components/profile/education-editor";

const { createEducation, getEducation, updateEducation } = vi.hoisted(() => ({
  createEducation: vi.fn().mockResolvedValue([]),
  getEducation: vi.fn().mockResolvedValue([]),
  updateEducation: vi.fn(),
}));

vi.mock("@/lib/api/clients/profile", () => ({
  createEducation,
  deleteEducation: vi.fn(),
  getEducation,
  updateEducation,
}));

describe("EducationEditor", () => {
  it("saves parsed education without dates as one batch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <EducationEditor
          profileId={1}
          initialEducation={[
            { institution: "Example University", degree: "BS" },
            { institution: "Second University", degree: "MS", field: "Systems" },
          ]}
        />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Save All" }));

    await waitFor(() => {
      expect(createEducation).toHaveBeenCalledOnce();
    });
    expect(createEducation).toHaveBeenCalledWith([
      {
        institution: "Example University",
        degree: "BS",
        field: null,
        startDate: null,
        endDate: null,
        gpa: null,
        honors: null,
        profileId: 1,
      },
      {
        institution: "Second University",
        degree: "MS",
        field: "Systems",
        startDate: null,
        endDate: null,
        gpa: null,
        honors: null,
        profileId: 1,
      },
    ]);
  });

  it("edits another field on a no-date education without inventing a date", async () => {
    getEducation.mockResolvedValueOnce([
      {
        id: 7,
        profileId: 1,
        institution: "Original University",
        degree: "BS",
        field: null,
        startDate: "",
        endDate: null,
        gpa: null,
        honors: null,
      },
    ]);
    updateEducation.mockResolvedValueOnce({ id: 7 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <EducationEditor profileId={1} />
      </QueryClientProvider>
    );

    await screen.findByText("Original University");
    const educationCard = screen.getByText("Original University").closest(".group");
    const editButton = educationCard?.querySelector("button");
    expect(editButton).not.toBeNull();
    fireEvent.click(editButton!);
    const institution = container.querySelector<HTMLInputElement>("#institution");
    expect(institution).not.toBeNull();
    fireEvent.change(institution!, { target: { value: "Renamed University" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateEducation).toHaveBeenCalledOnce();
    });
    expect(updateEducation).toHaveBeenCalledWith(7, expect.objectContaining({
      institution: "Renamed University",
      startDate: null,
    }));
  });

  it("shows a retryable load failure instead of converting it to empty education", async () => {
    getEducation
      .mockRejectedValueOnce(new Error("Education unavailable"))
      .mockResolvedValueOnce([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <EducationEditor profileId={1} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Education unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Education")).toBeTruthy();
    expect(getEducation).toHaveBeenCalledTimes(2);
  });
});
