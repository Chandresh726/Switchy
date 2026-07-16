import { describe, expect, it } from "vitest";

import {
  buildPortableStructuredInstructions,
  parsePortableJson,
} from "@/lib/ai/runtime/portable-json";

describe("portable structured JSON", () => {
  it("accepts an exact JSON value", () => {
    expect(parsePortableJson('{"status":"ready"}')).toEqual({ status: "ready" });
  });

  it("accepts one optional JSON code fence", () => {
    expect(parsePortableJson('```json\n{"status":"ready"}\n```')).toEqual({
      status: "ready",
    });
  });

  it("rejects prose and malformed responses as retryable safe errors", () => {
    expect(() => parsePortableJson('Result: {"status":"ready"}')).toThrowError(
      expect.objectContaining({ type: "json_parse", retryable: true })
    );
    expect(() => parsePortableJson(" ")).toThrowError(
      expect.objectContaining({ type: "no_object", retryable: true })
    );
  });

  it("includes the schema and a correction instruction on retries", () => {
    const instructions = buildPortableStructuredInstructions(
      "Return the result.",
      { type: "object", required: ["status"] },
      2
    );

    expect(instructions).toContain('"required":["status"]');
    expect(instructions).toContain("previous response was invalid");
    expect(instructions).toContain("Return exactly one JSON value");
  });
});
