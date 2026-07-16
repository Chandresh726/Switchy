import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest } from "@/lib/api";
import { persistResumeVersion } from "@/lib/ai/resume/repository";
import { extractResumeText } from "@/lib/ai/resume/text-extraction";
import { parseResumeWithProvenance } from "@/lib/ai/resume-parser";
import { sanitizeAIError } from "@/lib/ai/shared/errors";
import { MAX_RESUME_FILE_SIZE, MAX_RESUME_TEXT_LENGTH } from "@/lib/constants";
import { db } from "@/lib/db";
import { profile } from "@/lib/db/schema";
import { deleteFile, saveFile } from "@/lib/storage/files";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const shouldAutofill = formData.get("autofill") !== "false";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();

    if (file.size > MAX_RESUME_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum resume size is 5MB." },
        { status: 400 }
      );
    }

    if (!fileName.endsWith(".pdf") && !fileName.endsWith(".docx") && !fileName.endsWith(".doc") && !fileName.endsWith(".txt") && !fileName.endsWith(".md")) {
      return NextResponse.json(
        { error: "Unsupported file format. Please upload PDF, DOCX, DOC, TXT, or MD." },
        { status: 400 }
      );
    }

    let resumeText = "";

    if (shouldAutofill) {
      try {
        resumeText = (await extractResumeText(file)).text;
      } catch {
        return NextResponse.json(
          { error: "Could not extract resume text." },
          { status: 400 }
        );
      }

      if (!resumeText || resumeText.trim().length < 50) {
        return NextResponse.json(
          { error: "Could not extract text from file. Please ensure the file contains readable text." },
          { status: 400 }
        );
      }

      if (resumeText.length > MAX_RESUME_TEXT_LENGTH) {
        return NextResponse.json(
          { error: "Resume text is too long to parse safely. Please upload a shorter resume." },
          { status: 400 }
        );
      }
    }

    const parseResult = shouldAutofill
      ? await parseResumeWithProvenance(resumeText, { signal: request.signal })
      : null;
    const parsedData = parseResult?.parsedData ?? null;

    // Save file to disk after validation so rejected files are not stored.
    const savedFile = await saveFile(file, "resumes");

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
      await deleteFile(savedFile.path);
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
    const sanitized = sanitizeAIError(error);
    console.error(`Failed to parse resume: [${sanitized.code}] ${sanitized.message}`);
    return NextResponse.json(
      { error: sanitized.message, code: sanitized.code },
      { status: 500 }
    );
  }
}
