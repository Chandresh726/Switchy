import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/components/profile/profile-form";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/clients/profile", () => ({
  getProfile: mocks.getProfile,
  saveProfile: mocks.saveProfile,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

const profile = {
  id: 1,
  name: "Existing User",
  email: "existing@example.com",
  phone: "",
  location: "Old City",
  preferredCountry: null,
  preferredCity: null,
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  resumePath: null,
  summary: "",
  createdAt: null,
  updatedAt: null,
  skills: [],
  experience: [],
  education: [],
  resumes: [],
};

function renderProfileForm(props: React.ComponentProps<typeof ProfileForm> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(queryKeys.profile.detail(), profile);

  render(
    <QueryClientProvider client={queryClient}>
      <ProfileForm {...props} />
    </QueryClientProvider>
  );
}

describe("ProfileForm review workflow", () => {
  beforeEach(() => {
    mocks.getProfile.mockResolvedValue(profile);
    mocks.saveProfile.mockImplementation(async (data) => ({ ...profile, ...data }));
  });

  it("stages extracted profile changes until the user saves them", async () => {
    const onReviewResolved = vi.fn();
    renderProfileForm({
      reviewKey: 12,
      initialData: {
        email: "new@example.com",
        location: "New City",
      },
      onReviewResolved,
    });

    expect(screen.getByDisplayValue("new@example.com")).toBeTruthy();
    expect(screen.getByText(/2 pending changes: Email, Location/)).toBeTruthy();
    expect(mocks.saveProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.saveProfile).toHaveBeenCalledOnce();
    });
    expect(onReviewResolved).toHaveBeenCalledOnce();
  });

  it("reverts manual or extracted edits to the persisted profile", () => {
    const onReviewResolved = vi.fn();
    renderProfileForm({
      reviewKey: 13,
      initialData: { location: "New City" },
      onReviewResolved,
    });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "manual@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));

    expect(screen.getByDisplayValue("existing@example.com")).toBeTruthy();
    expect(screen.getByDisplayValue("Old City")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(onReviewResolved).toHaveBeenCalledOnce();
    expect(mocks.saveProfile).not.toHaveBeenCalled();
  });

  it("explains invalid extracted profile fields before saving", () => {
    renderProfileForm({
      reviewKey: 14,
      initialData: { email: "not-an-email" },
    });

    const saveButton = screen.getByRole("button", {
      name: "Save Changes",
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(
      /Fix before saving: Email:/
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "valid@example.com" },
    });

    expect(saveButton.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
