import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  handleApiError: vi.fn((error: unknown) => {
    if (error instanceof Error && error.name === "ValidationError") {
      const validationError = error as Error & { code?: string; statusCode?: number };
      return Response.json(
        { error: validationError.message, code: validationError.code },
        { status: validationError.statusCode ?? 400 }
      );
    }

    return Response.json({ error: "An unexpected error occurred", code: "internal_error" }, { status: 500 });
  }),
  importPeopleCsv: vi.fn(),
  ValidationError: class ValidationError extends Error {
    readonly code: string;
    readonly statusCode: number;

    constructor(message: string, code = "validation_error", statusCode = 400) {
      super(message);
      this.name = "ValidationError";
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
  handleApiError: mocks.handleApiError,
  ValidationError: mocks.ValidationError,
}));

vi.mock("@/lib/people/sync", () => ({
  importPeopleCsv: mocks.importPeopleCsv,
}));

import { POST } from "@/app/api/people/import/route";

function createImportRequest(formData: FormData): NextRequest {
  return new Request("http://localhost/api/people/import", {
    method: "POST",
    body: formData,
  }) as NextRequest;
}

describe("people import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.importPeopleCsv.mockResolvedValue({
      sessionId: "session-1",
      source: "linkedin",
      fileName: "connections.csv",
      totalRows: 1,
      insertedRows: 1,
      updatedRows: 0,
      deactivatedRows: 0,
      invalidRows: 0,
      unmatchedCompanyRows: 0,
      errors: [],
    });
  });

  it("passes source, file contents, filename, and import mode to the sync service", async () => {
    const formData = new FormData();
    formData.set("source", "linkedin");
    formData.set("importMode", "replace");
    formData.set("file", new File(["First Name,Last Name\nJane,Doe"], "connections.csv", { type: "text/csv" }));

    const response = await POST(createImportRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.insertedRows).toBe(1);
    expect(mocks.importPeopleCsv).toHaveBeenCalledWith({
      source: "linkedin",
      content: "First Name,Last Name\nJane,Doe",
      fileName: "connections.csv",
      mapping: undefined,
      importMode: "replace",
    });
  });

  it("defaults import mode to merge", async () => {
    const formData = new FormData();
    formData.set("source", "linkedin");
    formData.set("file", new File(["First Name,Last Name\nJane,Doe"], "connections.csv", { type: "text/csv" }));

    const response = await POST(createImportRequest(formData));

    expect(response.status).toBe(200);
    expect(mocks.importPeopleCsv).toHaveBeenCalledWith(
      expect.objectContaining({ importMode: "merge" })
    );
  });

  it("rejects non-csv files before importing", async () => {
    const formData = new FormData();
    formData.set("file", new File(["hello"], "connections.txt", { type: "text/plain" }));

    const response = await POST(createImportRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Only CSV files are supported", code: "validation_error" });
    expect(mocks.importPeopleCsv).not.toHaveBeenCalled();
  });
});
