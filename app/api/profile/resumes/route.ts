import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteFile } from "@/lib/storage/files";

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Resume ID is required" },
        { status: 400 }
      );
    }

    const resumeId = parseInt(id, 10);
    if (isNaN(resumeId)) {
      return NextResponse.json(
        { error: "Invalid resume ID" },
        { status: 400 }
      );
    }

    // Get the resume to find the file path
    const [resume] = await db
      .select()
      .from(resumes)
      .where(eq(resumes.id, resumeId));

    if (!resume) {
      return NextResponse.json(
        { error: "Resume not found" },
        { status: 404 }
      );
    }

    // Delete the file from storage
    if (resume.filePath) {
      try {
        await deleteFile(resume.filePath);
      } catch (error) {
        console.error("Failed to delete resume file:", error);
        // Continue with DB deletion even if file deletion fails
      }
    }

    // Delete from database
    await db.delete(resumes).where(eq(resumes.id, resumeId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete resume:", error);
    return NextResponse.json(
      { error: "Failed to delete resume" },
      { status: 500 }
    );
  }
}
