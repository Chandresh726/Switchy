import type { NextRequest } from "next/server";

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyResumeSection: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  assertAppRequest: vi.fn(),
}));

vi.mock("@/lib/application/profile-service", () => ({
  applyResumeSection: mocks.applyResumeSection,
}));

import { POST } from "@/app/api/profile/resume-review/route";

describe("profile resume review route", () => {
  it("validates and applies one reviewed section", async () => {
    mocks.applyResumeSection.mockResolvedValue({
      added: 1,
      updated: 1,
      unchanged: 2,
      duplicatesSkipped: 1,
      invalidSkipped: 0,
    });
    const body = {
      section: "skills",
      profileId: 1,
      items: [
        { name: "TypeScript", category: "backend" },
        { name: "React", category: "frontend" },
      ],
    };

    const response = await POST(new Request(
      "http://localhost/api/profile/resume-review",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
          "x-switchy-request": "true",
        },
        body: JSON.stringify(body),
      }
    ) as NextRequest);

    expect(response.status).toBe(200);
    expect(mocks.applyResumeSection).toHaveBeenCalledWith(body);
    await expect(response.json()).resolves.toMatchObject({
      added: 1,
      updated: 1,
      unchanged: 2,
    });
  });
});
