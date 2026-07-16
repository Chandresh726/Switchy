import { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  returningRows: [] as unknown[],
  scheduleProfileRematch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => mocks.returningRows),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mocks.returningRows),
        })),
      })),
    })),
  },
}));
vi.mock("@/lib/ai/matcher/profile-rematch", () => ({
  scheduleProfileRematch: mocks.scheduleProfileRematch,
}));

import { DELETE as deleteEducation, PUT as updateEducation } from "@/app/api/profile/education/route";
import { DELETE as deleteExperience, PUT as updateExperience } from "@/app/api/profile/experience/route";
import { DELETE as deleteSkill } from "@/app/api/profile/skills/route";

function mutationRequest(url: string, method: "DELETE" | "PUT", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      origin: "http://localhost",
      "x-switchy-request": "true",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectNotFound(response: Response, code: string): Promise<void> {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    code,
    requestId: expect.any(String),
  });
  expect(mocks.scheduleProfileRematch).not.toHaveBeenCalled();
}

describe("profile child missing-resource mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returningRows = [];
  });

  it("returns 404 when deleting a missing skill", async () => {
    await expectNotFound(
      await deleteSkill(mutationRequest("http://localhost/api/profile/skills?id=99", "DELETE")),
      "skill_not_found"
    );
  });

  it("returns 404 when deleting or updating missing experience", async () => {
    await expectNotFound(
      await deleteExperience(mutationRequest("http://localhost/api/profile/experience?id=99", "DELETE")),
      "experience_not_found"
    );
    await expectNotFound(
      await updateExperience(mutationRequest("http://localhost/api/profile/experience", "PUT", {
        id: 99,
        company: "Example",
        title: "Engineer",
        startDate: "2024-01",
      })),
      "experience_not_found"
    );
  });

  it("returns 404 when deleting or updating missing education", async () => {
    await expectNotFound(
      await deleteEducation(mutationRequest("http://localhost/api/profile/education?id=99", "DELETE")),
      "education_not_found"
    );
    await expectNotFound(
      await updateEducation(mutationRequest("http://localhost/api/profile/education", "PUT", {
        id: 99,
        institution: "Example University",
        degree: "BS",
        startDate: "2020-01",
      })),
      "education_not_found"
    );
  });
});
