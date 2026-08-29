import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EducationEditor } from "@/components/profile/education-editor";

const { applyResumeSection, createEducation, getEducation, updateEducation } = vi.hoisted(() => ({
  applyResumeSection: vi.fn().mockResolvedValue({
    added: 2,
    updated: 0,
    unchanged: 0,
    duplicatesSkipped: 0,
    invalidSkipped: 0,
  }),
  createEducation: vi.fn().mockResolvedValue([]),
  getEducation: vi.fn().mockResolvedValue([]),
  updateEducation: vi.fn(),
}));

vi.mock("@/lib/api/clients/profile", () => ({
  applyResumeSection,
  createEducation,
  deleteEducation: vi.fn(),
  getEducation,
  updateEducation,
}));

describe("EducationEditor", () => {
  it("places add and cancel actions in the education form header", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <EducationEditor profileId={1} />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add Education" }));

    const form = screen.getByRole("heading", { name: "Add Education" }).closest("form");
    const buttons = [...(form?.querySelectorAll("button") ?? [])];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Add Education",
      "Cancel",
    ]);
  });

  it("saves parsed education without dates as one batch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <EducationEditor
          profileId={1}
          resumeReview={{
            key: 9,
            review: {
              changes: [
                {
                  key: "example university|bs",
                  kind: "add",
                  currentId: null,
                  value: { institution: "Example University", degree: "BS" },
                  changedFields: [],
                },
                {
                  key: "second university|ms",
                  kind: "add",
                  currentId: null,
                  value: {
                    institution: "Second University",
                    degree: "MS",
                    field: "Systems",
                  },
                  changedFields: [],
                },
              ],
              unchangedCount: 0,
              duplicateCount: 0,
              invalidCount: 0,
            },
          }}
        />
      </QueryClientProvider>
    );

    const saveButton = await screen.findByRole("button", { name: "Save Changes" });
    expect(saveButton.closest('[data-slot="card-header"]')).not.toBeNull();
    expect(saveButton.closest('[data-slot="card-footer"]')).toBeNull();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(applyResumeSection).toHaveBeenCalledOnce();
    });
    expect(applyResumeSection).toHaveBeenCalledWith({
      section: "education",
      profileId: 1,
      items: [
        { institution: "Example University", degree: "BS" },
        {
          institution: "Second University",
          degree: "MS",
          field: "Systems",
        },
      ],
    });
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
    const degree = screen.getByText("BS");
    expect(degree.className).toContain("text-sm");
    const educationCard = screen.getByText("Original University").closest(".group");
    const editButton = educationCard?.querySelector("button");
    expect(editButton).not.toBeNull();
    fireEvent.click(editButton!);
    const institution = container.querySelector<HTMLInputElement>("#institution");
    expect(institution).not.toBeNull();
    fireEvent.change(institution!, { target: { value: "Renamed University" } });

    const editForm = screen.getByRole("heading", { name: "Edit Education" }).closest("form");
    const editButtons = [...(editForm?.querySelectorAll("button") ?? [])];
    expect(editButtons).toHaveLength(2);
    expect(editButtons.map((button) => button.textContent?.trim())).toEqual([
      "Save Changes",
      "Cancel",
    ]);

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
