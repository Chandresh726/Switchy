import { afterEach, describe, expect, it, vi } from "vitest";

import { profile, resumes } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-resume-storage-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/storage/files");
  vi.doUnmock("@/lib/ai/resume/repository");
  vi.doUnmock("@/lib/ai/resume/text-extraction");
  vi.doUnmock("@/lib/ai/resume-parser");
  vi.resetModules();
});

describe("resume storage reconciliation", () => {
  it("recovers staged files, finishes deletes, and marks missing files idempotently", async () => {
    const { database } = harness.createDatabase();
    const files = new Set([
      "resumes/.staging/two.txt.tmp",
      "resumes/.staging/orphan.txt.tmp",
      "resumes/three.txt",
    ]);
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/resume/repository", () => ({ persistResumeVersion: vi.fn() }));
    vi.doMock("@/lib/ai/resume/text-extraction", () => ({ extractResumeText: vi.fn() }));
    vi.doMock("@/lib/ai/resume-parser", () => ({ parseResumeWithProvenance: vi.fn() }));
    vi.doMock("@/lib/storage/files", () => ({
      deleteResumeFile: (filePath: string) => files.delete(filePath),
      finalizeResumeFile: (stagingPath: string, finalPath: string) => {
        if (!files.delete(stagingPath)) throw new Error("staging file missing");
        files.add(finalPath);
      },
      getResumeFilePath: (filePath: string) => filePath,
      listResumeStagingFiles: () => [...files]
        .filter((filePath) => filePath.includes("/.staging/"))
        .map((filePath) => ({ path: filePath, modifiedAtMs: 0 })),
      resumeFileExists: (filePath: string) => files.has(filePath),
      stageResumeFile: vi.fn(),
    }));
    const localProfile = database.insert(profile).values({ name: "Local" }).returning().get();
    database.insert(resumes).values([
      {
        profileId: localProfile.id,
        fileName: "one.txt",
        filePath: "resumes/one.txt",
        parsedData: "null",
        version: 1,
        isCurrent: true,
        storageState: "ready",
      },
      {
        profileId: localProfile.id,
        fileName: "two.txt",
        filePath: "resumes/two.txt",
        parsedData: "null",
        version: 2,
        storageState: "staging",
        stagingPath: "resumes/.staging/two.txt.tmp",
      },
      {
        profileId: localProfile.id,
        fileName: "three.txt",
        filePath: "resumes/three.txt",
        parsedData: "null",
        version: 3,
        storageState: "deleting",
      },
    ]).run();
    const { reconcileResumeStorage } = await import("@/lib/application/profile-resume-service");

    await expect(reconcileResumeStorage()).resolves.toEqual({
      ready: 1,
      deleted: 1,
      missing: 1,
      orphanedDeleted: 1,
      failed: 0,
    });
    await expect(reconcileResumeStorage()).resolves.toEqual({
      ready: 0,
      deleted: 0,
      missing: 0,
      orphanedDeleted: 0,
      failed: 0,
    });
    expect(database.select().from(resumes).orderBy(resumes.version).all()).toMatchObject([
      { version: 1, storageState: "missing", isCurrent: false },
      { version: 2, storageState: "ready", stagingPath: null, isCurrent: true },
    ]);
    expect(files).toEqual(new Set(["resumes/two.txt"]));
  });

  it("continues reconciling later records after one record fails", async () => {
    const { database } = harness.createDatabase();
    const files = new Set(["resumes/.staging/two.txt.tmp"]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/resume/repository", () => ({ persistResumeVersion: vi.fn() }));
    vi.doMock("@/lib/ai/resume/text-extraction", () => ({ extractResumeText: vi.fn() }));
    vi.doMock("@/lib/ai/resume-parser", () => ({ parseResumeWithProvenance: vi.fn() }));
    vi.doMock("@/lib/storage/files", () => ({
      deleteResumeFile: (filePath: string) => files.delete(filePath),
      finalizeResumeFile: (stagingPath: string, finalPath: string) => {
        files.delete(stagingPath);
        files.add(finalPath);
      },
      getResumeFilePath: (filePath: string) => filePath,
      listResumeStagingFiles: () => [],
      resumeFileExists: (filePath: string) => {
        if (filePath === "resumes/broken.txt") throw new Error("permission denied");
        return files.has(filePath);
      },
      stageResumeFile: vi.fn(),
    }));
    const localProfile = database.insert(profile).values({ name: "Local" }).returning().get();
    database.insert(resumes).values([
      {
        profileId: localProfile.id,
        fileName: "broken.txt",
        filePath: "resumes/broken.txt",
        parsedData: "null",
        version: 1,
        storageState: "ready",
      },
      {
        profileId: localProfile.id,
        fileName: "two.txt",
        filePath: "resumes/two.txt",
        parsedData: "null",
        version: 2,
        storageState: "staging",
        stagingPath: "resumes/.staging/two.txt.tmp",
      },
    ]).run();
    const { reconcileResumeStorage } = await import("@/lib/application/profile-resume-service");

    await expect(reconcileResumeStorage()).resolves.toMatchObject({ ready: 1, failed: 1 });
    expect(database.select().from(resumes).orderBy(resumes.version).all()).toMatchObject([
      { version: 1, storageState: "ready" },
      { version: 2, storageState: "ready", isCurrent: true },
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "[Resume storage] Reconciliation failed",
      { code: "resume_record_reconciliation_failed", resumeId: expect.any(Number) }
    );
  });
});
