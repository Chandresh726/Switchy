import { NextRequest, NextResponse } from "next/server";
import { parseResume } from "@/lib/ai/resume-parser";
import { extractText } from "unpdf";
import { saveFile } from "@/lib/storage/files";
import { db } from "@/lib/db";
import { profile, resumes, education } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Save file to disk
    const savedFile = await saveFile(file, "resumes");

    // Get file extension
    const fileName = file.name.toLowerCase();
    let resumeText = "";

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
        { error: "Unsupported file format. Please upload PDF, DOCX, or TXT." },
        { status: 400 }
      );
    }

    if (!resumeText || resumeText.trim().length < 50) {
      return NextResponse.json(
        { error: "Could not extract text from file. Please ensure the file contains readable text." },
        { status: 400 }
      );
    }

    // Parse resume with AI
    const parsedData = await parseResume(resumeText);

    // Get or create profile
    let currentProfile = await db.query.profile.findFirst();

    if (!currentProfile) {
      const [newProfile] = await db.insert(profile).values({
        name: parsedData.name || "New User",
        email: parsedData.email,
        phone: parsedData.phone,
        summary: parsedData.summary,
      }).returning();
      currentProfile = newProfile;
    }

    // Atomically determine version, clear isCurrent, and insert new resume
    const resumeRecord = db.transaction((tx) => {
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

    // Sync education from resume to database (merge strategy)
    if (parsedData.education && parsedData.education.length > 0 && currentProfile.id) {
      // Get existing education entries
      const existingEducation = await db
        .select()
        .from(education)
        .where(eq(education.profileId, currentProfile.id));

      // Filter out education entries that already exist (by institution + degree + field)
      const existingKeys = new Set(
        existingEducation.map(
          (e) => `${e.institution.toLowerCase()}-${e.degree.toLowerCase()}-${(e.field || "").toLowerCase()}`
        )
      );

      const newEducation = parsedData.education.filter(
        (edu) =>
          !existingKeys.has(
            `${edu.institution.toLowerCase()}-${edu.degree.toLowerCase()}-${(edu.field || "").toLowerCase()}`
          )
      );

      // Insert new education entries
      if (newEducation.length > 0) {
        await db.insert(education).values(
          newEducation.map((edu) => ({
            profileId: currentProfile.id,
            institution: edu.institution,
            degree: edu.degree,
            field: edu.field || null,
            startDate: edu.startDate || "",
            endDate: edu.endDate || null,
            gpa: edu.gpa || null,
            honors: edu.honors || null,
          }))
        );
      }
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
