import type { NextRequest } from "next/server";

import { APICallError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  extractResumeText: vi.fn(),
  parseResumeWithProvenance: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  assertAppRequest: mocks.assertAppRequest,
}));
vi.mock("@/lib/ai/resume/repository", () => ({ persistResumeVersion: vi.fn() }));
vi.mock("@/lib/ai/resume/text-extraction", () => ({
  extractResumeText: mocks.extractResumeText,
}));
vi.mock("@/lib/ai/resume-parser", () => ({
  parseResumeWithProvenance: mocks.parseResumeWithProvenance,
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ profile: {} }));
vi.mock("@/lib/storage/files", () => ({
  deleteResumeFile: vi.fn(),
  saveResumeFile: vi.fn(),
}));

import { POST } from "@/app/api/profile/parse-resume/route";

describe("parse-resume route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not log or return provider request details", async () => {
    mocks.extractResumeText.mockResolvedValue({
      text: "Synthetic resume text long enough for parsing. ".repeat(3),
    });
    mocks.parseResumeWithProvenance.mockRejectedValue(new APICallError({
      message: "Provider rejected SENTINEL_RESUME_DATA",
      url: "https://provider.invalid/generate",
      requestBodyValues: { prompt: "SENTINEL_RESUME_DATA" },
      statusCode: 503,
      responseHeaders: {},
      responseBody: "SENTINEL_PROVIDER_BODY",
      isRetryable: true,
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const formData = new FormData();
    formData.set("file", new File(["Synthetic resume"], "resume.txt", {
      type: "text/plain",
    }));
    const request = new Request("http://localhost/api/profile/parse-resume", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "The AI provider could not complete the request.",
      code: "generation_failed",
    });
    expect(JSON.stringify(body)).not.toContain("SENTINEL_RESUME_DATA");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("SENTINEL_RESUME_DATA");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("SENTINEL_PROVIDER_BODY");
  });

  it("rejects a string-valued file field with a stable 400", async () => {
    const formData = new FormData();
    formData.set("file", "not-a-file");
    const request = new Request("http://localhost/api/profile/parse-resume", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request as NextRequest);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_request",
      requestId: expect.any(String),
    });
    expect(mocks.extractResumeText).not.toHaveBeenCalled();
  });

  it("rejects an invalid autofill value before reading the file", async () => {
    const formData = new FormData();
    formData.set("file", new File(["Synthetic resume"], "resume.txt", {
      type: "text/plain",
    }));
    formData.set("autofill", "sometimes");
    const request = new Request("http://localhost/api/profile/parse-resume", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request as NextRequest);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_request",
      requestId: expect.any(String),
    });
    expect(mocks.extractResumeText).not.toHaveBeenCalled();
  });
});
