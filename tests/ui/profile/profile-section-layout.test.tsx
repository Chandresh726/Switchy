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

  it("gives experience titles more emphasis than descriptions", async () => {
    mocks.getExperience.mockResolvedValueOnce([{
      id: 7,
      profileId: 1,
      company: "Example Company",
      title: "Senior Engineer",
      location: "Bengaluru",
      startDate: "2024-01",
      endDate: null,
      description: "Built reliable platform services.",
      highlights: null,
    }]);

    renderWithClient(<ExperienceList profileId={1} />);

    const title = await screen.findByText("Senior Engineer");
    const description = screen.getByText("Built reliable platform services.");
    expect(title.className).toContain("text-sm");
    expect(description.className).toContain("text-xs");
    expect(description.className).not.toContain("text-sm");
  });

  it("packs intrinsic-width skill categories while keeping each skill list on one line", async () => {
    mocks.getSkills.mockResolvedValueOnce([
      { id: 1, profileId: 1, name: "Python", category: "languages" },
      { id: 2, profileId: 1, name: "TypeScript/JavaScript", category: "languages" },
      { id: 3, profileId: 1, name: "Node.js", category: "backend" },
      { id: 4, profileId: 1, name: "AWS", category: "cloud" },
      { id: 5, profileId: 1, name: "PostgreSQL", category: "database" },
    ]);

    const { container } = renderWithClient(<SkillsEditor profileId={1} />);

    await screen.findByText("TypeScript/JavaScript");
    const categorySelect = screen.getByRole("combobox", { name: "Skill category" });
    expect(categorySelect.getAttribute("data-slot")).toBe("select-trigger");
    expect(container.querySelector('select:not([aria-hidden="true"])')).toBeNull();

    const categoryLayout = container.querySelector("[data-skills-category-layout]");
    expect(categoryLayout?.className).toContain("flex-wrap");
    expect(categoryLayout?.className).not.toContain("grid");
    expect(
      [...(categoryLayout?.children ?? [])].map((category) =>
        category.querySelector("h4")?.textContent
      )
    ).toEqual(["languages", "backend", "cloud", "database"]);

    const languages = container.querySelector("[data-skills-category]");
    expect(languages?.className).toContain("w-max");
    const languageSkills = languages?.querySelector("[data-skills-category-items]");
    expect(languageSkills?.className).toContain("flex-nowrap");
    expect(languageSkills?.className).not.toContain("flex-wrap");
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
