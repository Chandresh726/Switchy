import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resumes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getFilePath } from "@/lib/storage/files";
import fs from "fs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resumeId = parseInt(id, 10);

    if (isNaN(resumeId)) {
      return NextResponse.json(
        { error: "Invalid resume ID" },
        { status: 400 }
      );
    }

    // Get the resume
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

    // Get the full file path
    const fullPath = getFilePath(resume.filePath);

    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Read the file
    const fileBuffer = fs.readFileSync(fullPath);

    // Determine content type based on file extension
    const ext = resume.fileName.split('.').pop()?.toLowerCase();
    let contentType = 'application/octet-stream';
    switch (ext) {
      case 'pdf':
        contentType = 'application/pdf';
        break;
      case 'docx':
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        break;
      case 'doc':
        contentType = 'application/msword';
        break;
      case 'txt':
        contentType = 'text/plain';
        break;
      case 'md':
        contentType = 'text/markdown';
        break;
    }

    // Sanitize filename for Content-Disposition header to prevent header injection
    const sanitizeFilename = (filename: string): string => {
      // Remove CR/LF and double-quote characters
      return filename.replace(/[\r\n"]/g, '');
    };

    const safeFilename = sanitizeFilename(resume.fileName) || 'resume';
    const rfc5987Filename = encodeURIComponent(resume.fileName).replace(/['()]/g, escape);

    // Return the file with appropriate headers for download
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${rfc5987Filename}`,
      },
    });
  } catch (error) {
    console.error("Failed to download resume:", error);
    return NextResponse.json(
      { error: "Failed to download resume" },
      { status: 500 }
    );
  }
}
