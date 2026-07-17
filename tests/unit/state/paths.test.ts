import path from "node:path";

import { describe, expect, it } from "vitest";

import { getUploadFilePath, getUploadTypeDir } from "@/lib/state/paths";

describe("local state upload paths", () => {
  it("resolves safe relative paths beneath the uploads directory", () => {
    const uploadsRoot = getUploadFilePath("");
    const resumePath = getUploadFilePath("resumes/example.pdf");

    expect(path.relative(uploadsRoot, resumePath)).toBe(path.join("resumes", "example.pdf"));
  });

  it.each(["../escape", "resumes/../../escape", "/absolute/path"])(
    "rejects an upload path outside the uploads directory: %s",
    (relativePath) => {
      expect(() => getUploadFilePath(relativePath)).toThrow("escapes uploads directory");
    }
  );

  it.each(["../resumes", "resumes/files", "", "resumes."])(
    "rejects an invalid upload type before creating directories: %s",
    (type) => {
      expect(() => getUploadTypeDir(type)).toThrow("Invalid upload type");
    }
  );
});
