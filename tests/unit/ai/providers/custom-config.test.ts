import { describe, expect, it } from "vitest";

import {
  buildCustomRequestHeaders,
  mergeCustomHeaderPatch,
  normalizeCustomBaseUrl,
  normalizeCustomHeaders,
  normalizeCustomReasoningEfforts,
  normalizeManualModelIds,
} from "@/lib/ai/providers/custom-config";

describe("custom provider configuration", () => {
  it("normalizes local HTTP URLs and rejects unsafe URL components", () => {
    expect(normalizeCustomBaseUrl(" http://127.0.0.1:8317/v1/ "))
      .toBe("http://127.0.0.1:8317/v1");
    expect(normalizeCustomBaseUrl("http://127.0.0.1:8317/v1///"))
      .toBe("http://127.0.0.1:8317/v1");
    expect(normalizeCustomBaseUrl("http://127.0.0.1:8317///"))
      .toBe("http://127.0.0.1:8317");
    expect(() => normalizeCustomBaseUrl("ftp://localhost/models")).toThrow("HTTP or HTTPS");
    expect(() => normalizeCustomBaseUrl("https://user:secret@example.com/v1")).toThrow("embedded credentials");
    expect(() => normalizeCustomBaseUrl("https://example.com/v1?token=secret")).toThrow("query string");
  });

  it("validates headers case-insensitively and blocks transport-controlled headers", () => {
    expect(() => normalizeCustomHeaders([
      { name: "Authorization", value: "one" },
      { name: "authorization", value: "two" },
    ])).toThrow("more than once");
    expect(() => normalizeCustomHeaders([{ name: "Host", value: "example.com" }]))
      .toThrow("controlled by the HTTP transport");
    expect(() => normalizeCustomHeaders([{ name: "X-Test", value: "bad\nvalue" }]))
      .toThrow("line breaks");
  });

  it("preserves omitted stored header values and deletes omitted header names", () => {
    expect(mergeCustomHeaderPatch(
      { Authorization: "Bearer stored", "X-Remove": "old" },
      [{ name: "authorization" }]
    )).toEqual({ authorization: "Bearer stored" });
    expect(() => mergeCustomHeaderPatch({}, [{ name: "X-New" }]))
      .toThrow("value is required");
  });

  it("builds format-specific authentication before custom header overrides", () => {
    expect(buildCustomRequestHeaders({
      apiFormat: "openai_chat_completions",
      apiKey: "standard",
      headers: { authorization: "Bearer override" },
    })).toEqual({ authorization: "Bearer override" });
    expect(buildCustomRequestHeaders({
      apiFormat: "anthropic_messages",
      apiKey: "anthropic-key",
      headers: { "anthropic-version": "2025-01-01" },
    })).toEqual({
      "x-api-key": "anthropic-key",
      "anthropic-version": "2025-01-01",
    });
  });

  it("deduplicates manual model IDs without changing their order", () => {
    expect(normalizeManualModelIds([" model-a ", "model-b", "model-a", ""]))
      .toEqual(["model-a", "model-b"]);
  });

  it("normalizes opaque custom reasoning levels without changing their order", () => {
    expect(normalizeCustomReasoningEfforts([
      " low ",
      "medium",
      "future_v1",
      "low",
      "",
    ])).toEqual(["low", "medium", "future_v1"]);
    expect(() => normalizeCustomReasoningEfforts(["not valid"]))
      .toThrow("is invalid");
  });
});
