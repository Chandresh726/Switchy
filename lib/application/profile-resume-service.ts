import fs from "node:fs";

import { and, desc, eq } from "drizzle-orm";

import { persistResumeVersion } from "@/lib/ai/resume/repository";
import { extractResumeText } from "@/lib/ai/resume/text-extraction";
import { parseResumeWithProvenance } from "@/lib/ai/resume-parser";
import { NotFoundError, ValidationError } from "@/lib/api";
import { MAX_RESUME_FILE_SIZE, MAX_RESUME_TEXT_LENGTH } from "@/lib/constants";
import { db } from "@/lib/db";
import { profile, resumes } from "@/lib/db/schema";
import {
  deleteResumeFile,
  finalizeResumeFile,
  getResumeFilePath,
  listResumeStagingFiles,
  resumeFileExists,
  stageResumeFile,
} from "@/lib/storage/files";

type ResumeRecord = typeof resumes.$inferSelect;
const ORPHANED_STAGING_GRACE_MS = 60 * 60 * 1_000;

function toResumeResponse(record: ResumeRecord) {
  const { stagingPath, ...response } = record;
  void stagingPath;
  return {
    ...response,
    createdAt: response.createdAt?.toISOString() ?? null,
  };
}

function promoteLatestReadyResume(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  profileId: number
): void {
  const fallback = tx.select({ id: resumes.id }).from(resumes).where(and(
    eq(resumes.profileId, profileId),
    eq(resumes.storageState, "ready")
  )).orderBy(desc(resumes.version)).get();
  if (fallback) {
    tx.update(resumes).set({ isCurrent: true }).where(eq(resumes.id, fallback.id)).run();
  }
}

function markResumeReady(record: ResumeRecord): ResumeRecord {
  return db.transaction((tx) => {
    const current = tx.select({ id: resumes.id, version: resumes.version })
      .from(resumes).where(and(
        eq(resumes.profileId, record.profileId),
        eq(resumes.isCurrent, true),
        eq(resumes.storageState, "ready")
      )).get();
    const makeCurrent = !current || record.version > current.version;
    if (makeCurrent) {
      tx.update(resumes).set({ isCurrent: false })
        .where(eq(resumes.profileId, record.profileId)).run();
    }
    return tx.update(resumes).set({
      storageState: "ready",
      stagingPath: null,
      isCurrent: makeCurrent,
    }).where(eq(resumes.id, record.id)).returning().get();
  }, { behavior: "immediate" });
}

function markResumeMissing(record: ResumeRecord): void {
  db.transaction((tx) => {
    tx.update(resumes).set({ storageState: "missing", stagingPath: null, isCurrent: false })
      .where(eq(resumes.id, record.id)).run();
    if (record.isCurrent) promoteLatestReadyResume(tx, record.profileId);
  }, { behavior: "immediate" });
}

export async function deleteResume(id: number) {
  const resume = db.transaction((tx) => {
    const existing = tx.select().from(resumes).where(eq(resumes.id, id)).get();
    if (!existing) throw new NotFoundError("Resume not found", "resume_not_found");
    tx.update(resumes).set({ storageState: "deleting", isCurrent: false })
      .where(eq(resumes.id, id)).run();
    if (existing.isCurrent) promoteLatestReadyResume(tx, existing.profileId);
    return existing;
  }, { behavior: "immediate" });

  deleteResumeFile(resume.filePath);
  if (resume.stagingPath) deleteResumeFile(resume.stagingPath);
  await db.delete(resumes).where(eq(resumes.id, id));
  return { success: true as const };
}

export async function uploadResume(file: File, shouldAutofill: boolean, signal: AbortSignal) {
  const fileName = file.name.toLowerCase();
  if (file.size > MAX_RESUME_FILE_SIZE) throw new ValidationError("File too large. Maximum resume size is 5MB.", "resume_file_too_large", 413);
  if (![".pdf", ".docx", ".doc", ".txt", ".md"].some((extension) => fileName.endsWith(extension))) {
    throw new ValidationError("Unsupported file format. Please upload PDF, DOCX, DOC, TXT, or MD.", "unsupported_resume_format");
  }
  let resumeText = "";
  let resumeFileType: "pdf" | "doc" | "docx" | "txt" | "md" | undefined;
  if (shouldAutofill && fileName.endsWith(".doc") && !fileName.endsWith(".docx")) {
    throw new ValidationError(
      "Legacy .doc files cannot be auto-parsed. Please upload PDF, DOCX, TXT, or MD for autofill, or turn autofill off.",
      "unsupported_resume_autofill_format"
    );
  }
  if (shouldAutofill) {
    try {
      const extracted = await extractResumeText(file);
      resumeText = extracted.text;
      resumeFileType = extracted.format === "text"
        ? fileName.endsWith(".md") ? "md" : "txt"
        : extracted.format;
    } catch {
      throw new ValidationError("Could not extract resume text.", "resume_text_extraction_failed");
    }
    if (resumeText.trim().length < 50) throw new ValidationError("Could not extract text from file. Please ensure the file contains readable text.", "resume_text_empty");
    if (resumeText.length > MAX_RESUME_TEXT_LENGTH) throw new ValidationError("Resume text is too long to parse safely. Please upload a shorter resume.", "resume_text_too_long");
  }
  const parseResult = shouldAutofill
    ? await parseResumeWithProvenance(resumeText, {
      signal,
      fileType: resumeFileType,
      fileName: file.name,
      fileSizeBytes: file.size,
    })
    : null;
  const parsedData = parseResult?.parsedData ?? null;
  const stagedFile = await stageResumeFile(file);
  let resumeRecord: ResumeRecord | null = null;
  try {
    const currentProfile = db.transaction((tx) => {
      tx.insert(profile).values({
        singletonKey: "local",
        name: parsedData?.name || "New User",
        email: parsedData?.email,
        phone: parsedData?.phone,
        summary: parsedData?.summary,
      }).onConflictDoNothing({ target: profile.singletonKey }).run();
      return tx.select().from(profile).where(eq(profile.singletonKey, "local")).get();
    }, { behavior: "immediate" });
    if (!currentProfile) throw new Error("Local profile could not be initialized");
    resumeRecord = persistResumeVersion(db, {
      profileId: currentProfile.id,
      fileName: file.name,
      filePath: stagedFile.finalPath,
      parsedData,
      aiRunId: parseResult?.aiRunId ?? null,
      parserVersion: parseResult?.parserVersion ?? null,
      warnings: parseResult?.warnings ?? [],
      storageState: "staging",
      stagingPath: stagedFile.stagingPath,
      isCurrent: false,
    });
  } catch (error) {
    deleteResumeFile(stagedFile.stagingPath);
    throw error;
  }

  finalizeResumeFile(stagedFile.stagingPath, stagedFile.finalPath);
  resumeRecord = markResumeReady(resumeRecord);
  return {
    parsedData,
    resumeRecord: toResumeResponse(resumeRecord),
    aiRunId: parseResult?.aiRunId ?? null,
    parserVersion: parseResult?.parserVersion ?? null,
    warnings: parseResult?.warnings ?? [],
  };
}

export async function reconcileResumeStorage(): Promise<{
  ready: number;
  deleted: number;
  missing: number;
  orphanedDeleted: number;
  failed: number;
}> {
  const records = await db.select().from(resumes).orderBy(resumes.version);
  let ready = 0;
  let deleted = 0;
  let missing = 0;
  let orphanedDeleted = 0;
  let failed = 0;
  for (const record of records) {
    try {
      if (record.storageState === "deleting") {
        deleteResumeFile(record.filePath);
        if (record.stagingPath) deleteResumeFile(record.stagingPath);
        db.transaction((tx) => {
          tx.delete(resumes).where(eq(resumes.id, record.id)).run();
          if (record.isCurrent) promoteLatestReadyResume(tx, record.profileId);
        }, { behavior: "immediate" });
        deleted += 1;
        continue;
      }
      if (record.storageState === "staging") {
        if (!resumeFileExists(record.filePath) && record.stagingPath && resumeFileExists(record.stagingPath)) {
          finalizeResumeFile(record.stagingPath, record.filePath);
        }
        if (resumeFileExists(record.filePath)) {
          markResumeReady(record);
          ready += 1;
        } else {
          markResumeMissing(record);
          missing += 1;
        }
        continue;
      }
      if (record.storageState === "ready" && !resumeFileExists(record.filePath)) {
        markResumeMissing(record);
        missing += 1;
      } else if (record.storageState === "missing" && resumeFileExists(record.filePath)) {
        markResumeReady(record);
        ready += 1;
      }
    } catch {
      failed += 1;
      console.error("[Resume storage] Reconciliation failed", {
        code: "resume_record_reconciliation_failed",
        resumeId: record.id,
      });
    }
  }

  try {
    const referencedStagingPaths = new Set(
      records.flatMap(({ stagingPath }) => stagingPath ? [stagingPath] : [])
    );
    const orphanCutoff = Date.now() - ORPHANED_STAGING_GRACE_MS;
    for (const stagedFile of listResumeStagingFiles()) {
      if (!referencedStagingPaths.has(stagedFile.path) && stagedFile.modifiedAtMs <= orphanCutoff) {
        deleteResumeFile(stagedFile.path);
        orphanedDeleted += 1;
      }
    }
  } catch {
    failed += 1;
    console.error("[Resume storage] Reconciliation failed", {
      code: "resume_orphan_reconciliation_failed",
    });
  }
  return { ready, deleted, missing, orphanedDeleted, failed };
}

export async function downloadResume(id: number) {
  const [resume] = await db.select().from(resumes).where(eq(resumes.id, id));
  if (!resume || resume.storageState !== "ready") throw new NotFoundError("Resume not found", "resume_not_found");
  const fullPath = getResumeFilePath(resume.filePath);
  if (!fs.existsSync(fullPath)) {
    markResumeMissing(resume);
    throw new NotFoundError("File not found", "resume_file_not_found");
  }
  const extension = resume.fileName.split(".").pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword", txt: "text/plain", md: "text/markdown",
  };
  const safeFilename = resume.fileName.replace(/[\r\n"]/g, "") || "resume";
  const encodedFilename = encodeURIComponent(resume.fileName).replace(/['()]/g, escape);
  return {
    body: fs.readFileSync(fullPath),
    headers: {
      "Content-Type": contentTypes[extension ?? ""] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
    },
  };
}
