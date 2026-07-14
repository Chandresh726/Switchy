import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractResumeText } from "@/lib/ai/resume/text-extraction";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/ai/resume");

describe("deterministic resume text extraction", () => {
  for (const fileName of [
    "synthetic-resume.txt",
    "synthetic-resume.pdf",
    "synthetic-resume.docx",
  ]) {
    it(`extracts the synthetic ${extname(fileName)} fixture`, async () => {
      const bytes = await readFile(join(FIXTURE_DIR, fileName));
      const result = await extractResumeText(new File([bytes], fileName));

      expect(result.text).toContain("Alex Rivera");
      expect(result.text).toContain("Northstar Labs");
      expect(result.text).toContain("TypeScript");
    });
  }

  it("rejects formats that cannot be deterministically extracted", async () => {
    await expect(extractResumeText(new File(["resume"], "resume.doc")))
      .rejects.toThrow("Autofill supports PDF, DOCX, TXT, or MD files.");
  });
});
