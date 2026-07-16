import fs from "node:fs";

import { eq } from "drizzle-orm";

import { persistResumeVersion } from "@/lib/ai/resume/repository";
import { extractResumeText } from "@/lib/ai/resume/text-extraction";
import { parseResumeWithProvenance } from "@/lib/ai/resume-parser";
import { NotFoundError, ValidationError, logApiFailure, type ApiRequestContext } from "@/lib/api";
import { MAX_RESUME_FILE_SIZE, MAX_RESUME_TEXT_LENGTH } from "@/lib/constants";
import { db } from "@/lib/db";
import { profile, resumes } from "@/lib/db/schema";
import { deleteResumeFile, getResumeFilePath, saveResumeFile } from "@/lib/storage/files";

export async function deleteResume(id: number, context: ApiRequestContext) {
  const [resume] = await db.select().from(resumes).where(eq(resumes.id, id));
  if (!resume) throw new NotFoundError("Resume not found", "resume_not_found");
  if (resume.filePath) {
    try { await deleteResumeFile(resume.filePath); } catch (error) {
      logApiFailure(context, "resume_file_delete_failed", 500, error);
    }
  }
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
  if (shouldAutofill) {
    try { resumeText = (await extractResumeText(file)).text; } catch {
      throw new ValidationError("Could not extract resume text.", "resume_text_extraction_failed");
    }
    if (resumeText.trim().length < 50) throw new ValidationError("Could not extract text from file. Please ensure the file contains readable text.", "resume_text_empty");
    if (resumeText.length > MAX_RESUME_TEXT_LENGTH) throw new ValidationError("Resume text is too long to parse safely. Please upload a shorter resume.", "resume_text_too_long");
  }
  const parseResult = shouldAutofill ? await parseResumeWithProvenance(resumeText, { signal }) : null;
  const parsedData = parseResult?.parsedData ?? null;
  const savedFile = await saveResumeFile(file);
  let currentProfile = await db.query.profile.findFirst();
  if (!currentProfile) {
    [currentProfile] = await db.insert(profile).values({
      name: parsedData?.name || "New User", email: parsedData?.email,
      phone: parsedData?.phone, summary: parsedData?.summary,
    }).returning();
  }
  try {
    const resumeRecord = persistResumeVersion(db, {
      profileId: currentProfile.id, fileName: file.name, filePath: savedFile.path,
      parsedData, aiRunId: parseResult?.aiRunId ?? null,
      parserVersion: parseResult?.parserVersion ?? null, warnings: parseResult?.warnings ?? [],
    });
    return {
      parsedData, resumeRecord, aiRunId: parseResult?.aiRunId ?? null,
      parserVersion: parseResult?.parserVersion ?? null, warnings: parseResult?.warnings ?? [],
    };
  } catch (error) {
    await deleteResumeFile(savedFile.path);
    throw error;
  }
}

export async function downloadResume(id: number) {
  const [resume] = await db.select().from(resumes).where(eq(resumes.id, id));
  if (!resume) throw new NotFoundError("Resume not found", "resume_not_found");
  const fullPath = getResumeFilePath(resume.filePath);
  if (!fs.existsSync(fullPath)) throw new NotFoundError("File not found", "resume_file_not_found");
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
