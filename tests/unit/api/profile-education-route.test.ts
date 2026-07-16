import { beforeEach, describe, expect, it, vi } from "vitest";

const { createEducation, listEducation } = vi.hoisted(() => ({
  createEducation: vi.fn(),
  listEducation: vi.fn(),
}));

vi.mock("@/lib/application/profile-service", () => ({
  createEducation,
  listEducation,
}));

import { POST } from "@/app/api/profile/education/route";

describe("profile education route", () => {
  beforeEach(() => {
    createEducation.mockResolvedValue([
      {
        id: 1,
        profileId: 1,
        institution: "Example University",
        degree: "BS",
        field: null,
        startDate: null,
        endDate: null,
        gpa: null,
        honors: null,
      },
    ]);
  });

  it("accepts a no-date education batch and invokes one atomic service operation", async () => {
    const input = [
      {
        profileId: 1,
        institution: "Example University",
        degree: "BS",
      },
    ];
    const response = await POST(
      new Request("http://localhost/api/profile/education", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
          "x-switchy-request": "true",
        },
        body: JSON.stringify(input),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(createEducation).toHaveBeenCalledOnce();
    expect(createEducation).toHaveBeenCalledWith(input);
    await expect(response.json()).resolves.toMatchObject([{ startDate: null }]);
  });
});
