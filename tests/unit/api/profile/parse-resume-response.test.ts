import type { NextRequest } from "next/server";

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadResume: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  assertAppRequest: vi.fn(),
}));

vi.mock("@/lib/application/profile-resume-service", () => ({
  uploadResume: mocks.uploadResume,
}));

import { POST } from "@/app/api/profile/parse-resume/route";

describe("parse resume response contract", () => {
  it("does not serialize the internal staging path", async () => {
    mocks.uploadResume.mockResolvedValue({
      parsedData: null,
      resumeRecord: {
        id: 1,
        profileId: 1,
        fileName: "resume.txt",
        filePath: "resumes/resume.txt",
        parsedData: "null",
        aiRunId: null,
        parserVersion: null,
        validationWarnings: null,
        version: 1,
        isCurrent: true,
        storageState: "ready",
        stagingPath: "resumes/.staging/internal.tmp",
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
      },
      aiRunId: null,
      parserVersion: null,
      warnings: [],
    });
    const formData = new FormData();
    formData.set("file", new File(["resume"], "resume.txt", { type: "text/plain" }));
    formData.set("autofill", "false");

    const response = await POST(new Request("http://localhost/api/profile/parse-resume", {
      method: "POST",
      body: formData,
    }) as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resumeRecord).not.toHaveProperty("stagingPath");
    expect(body.resumeRecord).toMatchObject({ storageState: "ready" });
  });
});
