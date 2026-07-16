import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getUploadTypeDir, getUploadFilePath } from "../state/paths";

const RESUME_UPLOAD_TYPE = "resumes";

export async function saveResumeFile(
  file: File
): Promise<{ path: string; filename: string }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const typeDir = getUploadTypeDir(RESUME_UPLOAD_TYPE);

  // Generate unique filename
  const ext = path.extname(file.name);
  const filename = `${randomUUID()}${ext}`;
  const filePath = path.join(typeDir, filename);

  // Write file
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });

  // Return relative path from uploads directory
  const relativePath = path.join(RESUME_UPLOAD_TYPE, filename);

  return {
    path: relativePath,
    filename: file.name,
  };
}

export async function deleteResumeFile(relativePath: string): Promise<void> {
  const fullPath = getUploadFilePath(relativePath);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function getResumeFilePath(relativePath: string): string {
  return getUploadFilePath(relativePath);
}
