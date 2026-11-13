import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExperienceList } from "@/components/profile/experience-list";
import { SkillsEditor } from "@/components/profile/skills-editor";

const mocks = vi.hoisted(() => ({
  getExperience: vi.fn().mockResolvedValue([]),
  getSkills: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/api/clients/profile", () => ({
  applyResumeSection: vi.fn(),
  createExperience: vi.fn(),
  createSkill: vi.fn(),
  deleteExperience: vi.fn(),
  deleteSkill: vi.fn(),
  getExperience: mocks.getExperience,
  getSkills: mocks.getSkills,
  updateExperience: vi.fn(),
}));

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

function expectReviewActionsInHeader() {
  const saveButton = screen.getByRole("button", { name: "Save Changes" });
  const revertButton = screen.getByRole("button", { name: "Revert" });

  expect(saveButton.closest('[data-slot="card-header"]')).not.toBeNull();
  expect(revertButton.closest('[data-slot="card-header"]')).not.toBeNull();
  expect(saveButton.closest('[data-slot="card-footer"]')).toBeNull();
}

describe("profile section action layout", () => {
  it("places add and cancel actions in the experience form header", async () => {
    renderWithClient(<ExperienceList profileId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add Work Experience" }));

    const form = screen.getByRole("heading", { name: "Add Experience" }).closest("form");
    const buttons = [...(form?.querySelectorAll("button") ?? [])];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Add Experience",
      "Cancel",
    ]);
  });

  it("shows work experience review actions in the card header", async () => {
    renderWithClient(
      <ExperienceList
        profileId={1}
        resumeReview={{
          key: 1,
          review: {
            changes: [{
              key: "example|engineer",
              kind: "add",
              currentId: null,
              value: {
                company: "Example",
                title: "Engineer",
                startDate: "2024-01",
              },
              changedFields: [],
            }],
            unchangedCount: 0,
            duplicateCount: 0,
            invalidCount: 0,
          },
        }}
      />
    );

    await screen.findByText("Work Experience");
    expectReviewActionsInHeader();
  });

  it("shows skills review actions in the card header", async () => {
    renderWithClient(
      <SkillsEditor
        profileId={1}
        resumeReview={{
          key: 1,
          review: {
            changes: [{
              key: "typescript",
              kind: "add",
              currentId: null,
              value: { name: "TypeScript", category: "frontend" },
              changedFields: [],
            }],
            unchangedCount: 0,
            duplicateCount: 0,
            invalidCount: 0,
          },
        }}
      />
    );

    await screen.findByText("Skills");
    expectReviewActionsInHeader();
  });
});
