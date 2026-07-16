import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeResumeData,
  ResumeDataSchema,
  ResumeValidationWarningsSchema,
} from "@/lib/ai/resume/schema";

describe("resume normalization evaluation", () => {
  it("normalizes raw structured data to the committed expected result", () => {
    const raw = JSON.parse(readFileSync(join(
      process.cwd(),
      "tests/fixtures/ai/resume/raw-normalization.json"
    ), "utf8")) as unknown;
    const expectedFixture = JSON.parse(readFileSync(join(
      process.cwd(),
      "tests/fixtures/ai/resume/expected-validation.json"
    ), "utf8")) as { parsedData: unknown; warnings: unknown };
    const expected = {
      parsedData: ResumeDataSchema.parse(expectedFixture.parsedData),
      warnings: ResumeValidationWarningsSchema.parse(expectedFixture.warnings),
    };

    expect(normalizeResumeData(ResumeDataSchema.parse(raw))).toEqual(expected);
  });
});
