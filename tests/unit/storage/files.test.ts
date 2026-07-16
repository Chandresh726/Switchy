import fs from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

async function temporaryUploadsDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "switchy-storage-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock("@/lib/state/paths");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("resume file storage", () => {
  it("stages, lists, finalizes, resolves, and deletes a resume securely", async () => {
    const uploadsDirectory = await temporaryUploadsDirectory();
    const resolveUploadPath = (relativePath: string) => {
      const root = path.resolve(uploadsDirectory);
      const resolved = path.resolve(root, relativePath);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error("Upload path escapes uploads directory");
      }
      return resolved;
    };
    vi.doMock("@/lib/state/paths", () => ({
      getUploadFilePath: resolveUploadPath,
      getUploadTypeDir(type: string) {
        const directory = resolveUploadPath(type);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        return directory;
      },
    }));
    const storage = await import("@/lib/storage/files");

    const staged = await storage.stageResumeFile(
      new File(["resume contents"], "candidate.pdf", { type: "application/pdf" })
    );
    expect(staged.filename).toBe("candidate.pdf");
    expect(staged.finalPath).toMatch(/^resumes\/[a-f0-9-]+\.pdf$/u);
    expect(staged.stagingPath).toBe(`${staged.finalPath.replace("resumes/", "resumes/.staging/")}.tmp`);
    expect(await readFile(resolveUploadPath(staged.stagingPath), "utf8")).toBe("resume contents");
    expect((await stat(resolveUploadPath(staged.stagingPath))).mode & 0o777).toBe(0o600);
    expect(storage.listResumeStagingFiles()).toEqual([
      expect.objectContaining({ path: staged.stagingPath }),
    ]);

    storage.finalizeResumeFile(staged.stagingPath, staged.finalPath);
    expect(storage.resumeFileExists(staged.stagingPath)).toBe(false);
    expect(storage.resumeFileExists(staged.finalPath)).toBe(true);
    expect(storage.getResumeFilePath(staged.finalPath)).toBe(resolveUploadPath(staged.finalPath));
    expect((await stat(resolveUploadPath(staged.finalPath))).mode & 0o777).toBe(0o600);

    storage.deleteResumeFile(staged.finalPath);
    storage.deleteResumeFile(staged.finalPath);
    expect(storage.resumeFileExists(staged.finalPath)).toBe(false);
  });
});
