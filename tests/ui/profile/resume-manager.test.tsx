import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResumeManager } from "@/components/profile/resume-manager";
import type { Resume } from "@/lib/api/contracts/profile";

const mocks = vi.hoisted(() => ({
  downloadResume: vi.fn(),
  uploadResume: vi.fn(),
}));

vi.mock("@/lib/api/clients/profile", () => ({
  downloadResume: mocks.downloadResume,
  uploadResume: mocks.uploadResume,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const resumes: Resume[] = [
  {
    id: 1,
    profileId: 1,
    fileName: "resume-v1.pdf",
    filePath: "uploads/resume-v1.pdf",
    parsedData: "{}",
    aiRunId: null,
    parserVersion: null,
    validationWarnings: null,
    version: 1,
    isCurrent: false,
    storageState: "missing",
    createdAt: "2026-06-01T10:00:00.000Z",
  },
  {
    id: 2,
    profileId: 1,
    fileName: "resume-v2.pdf",
    filePath: "uploads/resume-v2.pdf",
    parsedData: "{}",
    aiRunId: null,
    parserVersion: null,
    validationWarnings: null,
    version: 2,
    isCurrent: false,
    storageState: "ready",
    createdAt: "2026-07-01T10:00:00.000Z",
  },
  {
    id: 3,
    profileId: 1,
    fileName: "resume-v3.pdf",
    filePath: "uploads/resume-v3.pdf",
    parsedData: "{}",
    aiRunId: null,
    parserVersion: null,
    validationWarnings: null,
    version: 3,
    isCurrent: true,
    storageState: "ready",
    createdAt: "2026-08-01T10:00:00.000Z",
  },
];

function renderResumeManager() {
  return render(
    <ResumeManager
      resumes={resumes}
      onParsed={vi.fn()}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onRefresh={vi.fn()}
    />
  );
}

describe("ResumeManager history disclosure", () => {
  beforeEach(() => {
    mocks.downloadResume.mockReset();
    mocks.uploadResume.mockReset();
    mocks.downloadResume.mockResolvedValue(undefined);
  });

  it("hides resume details by default and shows every version when expanded", () => {
    const { container } = renderResumeManager();

    const managerButton = screen.getByRole("button", {
      name: "Resume Manager, 3 resumes",
    });
    expect(managerButton.querySelector(".lucide-files")).toBeNull();
    expect(screen.getByText("3 resumes")).toBeTruthy();
    expect(screen.queryByText("resume-v3.pdf")).toBeNull();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    expect(screen.queryByText("Previous Versions")).toBeNull();

    fireEvent.click(managerButton);

    expect(managerButton.getAttribute("aria-expanded")).toBe("true");
    expect(managerButton.className).toContain("aria-expanded:bg-transparent");
    expect(managerButton.className).not.toContain("aria-expanded:bg-muted");
    expect(screen.queryByText("Resume history")).toBeNull();
    expect(screen.queryByText(
      "The current resume is used for your profile and job matching."
    )).toBeNull();
    expect(screen.getByText("resume-v3.pdf")).toBeTruthy();
    expect(screen.getByText("resume-v2.pdf")).toBeTruthy();
    expect(screen.getByText("resume-v1.pdf")).toBeTruthy();
    expect(screen.getByText("Current").className).toContain("text-emerald-700");
    expect(screen.getByText("File missing")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Download/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Delete/ })).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="separator"]')).toHaveLength(1);
  });

  it("downloads the current resume from inside Resume Manager", async () => {
    renderResumeManager();

    fireEvent.click(screen.getByRole("button", {
      name: "Resume Manager, 3 resumes",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Download resume-v3.pdf",
    }));

    await waitFor(() => expect(mocks.downloadResume).toHaveBeenCalledWith(3));
  });
});
