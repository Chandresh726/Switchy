import { NextRequest, NextResponse } from "next/server";

import { desc, eq } from "drizzle-orm";
import { extractText } from "unpdf";

import { assertAppRequest } from "@/lib/api";
import { parseResume } from "@/lib/ai/resume-parser";
import { MAX_RESUME_FILE_SIZE, MAX_RESUME_TEXT_LENGTH } from "@/lib/constants";
import { deleteFile, saveFile } from "@/lib/storage/files";
import { db } from "@/lib/db";
import { profile, resumes } from "@/lib/db/schema";

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
      if (fileName.endsWith(".pdf")) {
        // Parse PDF using unpdf
        const arrayBuffer = await file.arrayBuffer();
        const result = await extractText(arrayBuffer);
        // unpdf returns { text: string, totalPages: number } or { text: string[] }
        if (Array.isArray(result.text)) {
          resumeText = result.text.join("\n\n");
        } else {
          resumeText = String(result.text || "");
        }
      } else if (fileName.endsWith(".docx")) {
        // Parse DOCX
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        resumeText = result.value;
      } else if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
        // Plain text
        resumeText = await file.text();
      } else {
        return NextResponse.json(
          { error: "Autofill supports PDF, DOCX, TXT, or MD files." },
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

    const parsedData = shouldAutofill ? await parseResume(resumeText) : null;

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

    // Atomically determine version, clear isCurrent, and insert new resume
    let resumeRecord;
    try {
      resumeRecord = db.transaction((tx) => {
        // Determine version number using core query API
        const lastResume = tx
          .select({ version: resumes.version })
          .from(resumes)
          .where(eq(resumes.profileId, currentProfile.id))
          .orderBy(desc(resumes.version))
          .get();

        const nextVersion = (lastResume?.version || 0) + 1;

        // Mark all previous resumes as not current
        if (nextVersion > 1) {
          tx
            .update(resumes)
            .set({ isCurrent: false })
            .where(eq(resumes.profileId, currentProfile.id))
            .run();
        }

        // Save resume record
        const record = tx
          .insert(resumes)
          .values({
            profileId: currentProfile.id,
            fileName: file.name,
            filePath: savedFile.path,
            parsedData: JSON.stringify(parsedData),
            version: nextVersion,
            isCurrent: true,
          })
          .returning()
          .get();

        return record;
      });
    } catch (error) {
      await deleteFile(savedFile.path);
      throw error;
    }

    return NextResponse.json({
      parsedData,
      resumeRecord
    });
  } catch (error) {
    console.error("Failed to parse resume:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse resume" },
      { status: 500 }
    );
  }
}
