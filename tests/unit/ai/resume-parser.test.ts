import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeStructured } = vi.hoisted(() => ({
  executeStructured: vi.fn(),
}));

vi.mock("@/lib/ai/runtime", () => ({
  createAICapabilityRuntime: vi.fn(async () => ({
      reasoningEffort: "medium",
      executeStructured,
  })),
  fingerprintAIInput: vi.fn(() => "fixture-fingerprint-000000000000000000000000"),
}));

import {
  parseResumeWithProvenance,
  RESUME_PARSER_VERSION,
  RESUME_POLICY_VERSION,
  RESUME_PROMPT_VERSION,
  RESUME_SCHEMA_VERSION,
} from "@/lib/ai/resume-parser";

describe("resume parser provenance", () => {
  beforeEach(() => executeStructured.mockReset());

  it("uses versioned runtime execution and returns run provenance", async () => {
    executeStructured.mockResolvedValue({
      output: {
        name: "Alex Rivera",
        skills: [{ name: "TypeScript" }, { name: "typescript" }],
        experience: [],
      },
      runId: "run-resume-1",
    });
    const controller = new AbortController();

    const result = await parseResumeWithProvenance("Synthetic resume text", {
      signal: controller.signal,
    });

    expect(executeStructured).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
      versions: {
        prompt: RESUME_PROMPT_VERSION,
        schema: RESUME_SCHEMA_VERSION,
        policy: RESUME_POLICY_VERSION,
      },
    }));
    expect(result).toMatchObject({
      aiRunId: "run-resume-1",
      parserVersion: RESUME_PARSER_VERSION,
      parsedData: { name: "Alex Rivera", skills: [{ name: "TypeScript" }] },
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "duplicate_skill", path: "skills.1.name" }),
    ]);
  });
});
