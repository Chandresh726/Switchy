import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest, handleApiError, ValidationError } from "@/lib/api";
import { persistResumeVersion } from "@/lib/ai/resume/repository";
import { extractResumeText } from "@/lib/ai/resume/text-extraction";
import { parseResumeWithProvenance } from "@/lib/ai/resume-parser";
import { MAX_RESUME_FILE_SIZE, MAX_RESUME_TEXT_LENGTH } from "@/lib/constants";
import { resumeUploadFormSchema } from "@/lib/api/contracts/profile";
import { db } from "@/lib/db";
import { profile } from "@/lib/db/schema";
import { deleteResumeFile, saveResumeFile } from "@/lib/storage/files";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const formData = await request.formData();
    const { file, autofill: shouldAutofill } = resumeUploadFormSchema.parse({
      file: formData.get("file"),
      autofill: formData.get("autofill") ?? undefined,
    });

    const fileName = file.name.toLowerCase();

    if (file.size > MAX_RESUME_FILE_SIZE) {
      throw new ValidationError(
        "File too large. Maximum resume size is 5MB.",
        "resume_file_too_large",
        413
      );
    }

    if (!fileName.endsWith(".pdf") && !fileName.endsWith(".docx") && !fileName.endsWith(".doc") && !fileName.endsWith(".txt") && !fileName.endsWith(".md")) {
      throw new ValidationError(
        "Unsupported file format. Please upload PDF, DOCX, DOC, TXT, or MD.",
        "unsupported_resume_format"
      );
    }

    let resumeText = "";

    if (shouldAutofill) {
      try {
        resumeText = (await extractResumeText(file)).text;
      } catch {
        throw new ValidationError(
          "Could not extract resume text.",
          "resume_text_extraction_failed"
        );
      }

      if (!resumeText || resumeText.trim().length < 50) {
        throw new ValidationError(
          "Could not extract text from file. Please ensure the file contains readable text.",
          "resume_text_empty"
        );
      }

      if (resumeText.length > MAX_RESUME_TEXT_LENGTH) {
        throw new ValidationError(
          "Resume text is too long to parse safely. Please upload a shorter resume.",
          "resume_text_too_long"
        );
      }
    }

    const parseResult = shouldAutofill
      ? await parseResumeWithProvenance(resumeText, { signal: request.signal })
      : null;
    const parsedData = parseResult?.parsedData ?? null;

    // Save file to disk after validation so rejected files are not stored.
    const savedFile = await saveResumeFile(file);

    // Get or create profile
    let currentProfile = await db.query.profile.findFirst();

    if (!currentProfile) {
      const [newProfile] = await db.insert(profile).values({
        name: parsedData?.name || "New User",
        email: parsedData?.email,
        phone: parsedData?.phone,
        summary: parsedData?.summary,
      }).returning();
      currentProfile = newProfile;
    }

    let resumeRecord;
    try {
      resumeRecord = persistResumeVersion(db, {
        profileId: currentProfile.id,
        fileName: file.name,
        filePath: savedFile.path,
        parsedData,
        aiRunId: parseResult?.aiRunId ?? null,
        parserVersion: parseResult?.parserVersion ?? null,
        warnings: parseResult?.warnings ?? [],
      });
    } catch (error) {
      await deleteResumeFile(savedFile.path);
      throw error;
    }

    return NextResponse.json({
      parsedData,
      resumeRecord,
      aiRunId: parseResult?.aiRunId ?? null,
      parserVersion: parseResult?.parserVersion ?? null,
      warnings: parseResult?.warnings ?? [],
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to parse resume", fallbackCode: "resume_parse_failed" });
  }
}
