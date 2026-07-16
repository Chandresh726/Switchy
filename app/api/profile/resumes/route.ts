import { NextRequest, NextResponse } from "next/server";
import {
  assertAppRequest,
  createApiRequestContext,
  handleApiError,
  logApiFailure,
  NotFoundError,
} from "@/lib/api";
import { childIdQuerySchema } from "@/lib/api/contracts/profile";
import { db } from "@/lib/db";
import { resumes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteResumeFile } from "@/lib/storage/files";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { id: resumeId } = childIdQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    // Get the resume to find the file path
    const [resume] = await db
      .select()
      .from(resumes)
      .where(eq(resumes.id, resumeId));

    if (!resume) {
      throw new NotFoundError("Resume not found", "resume_not_found");
    }

    // Delete the file from storage
    if (resume.filePath) {
      try {
        await deleteResumeFile(resume.filePath);
      } catch (error) {
        logApiFailure(createApiRequestContext(request), "resume_file_delete_failed", 500, error);
        // Continue with DB deletion even if file deletion fails
      }
    }

    // Delete from database
    await db.delete(resumes).where(eq(resumes.id, resumeId));

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete resume", fallbackCode: "resume_delete_failed" });
  }
}
