import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getUploadsDir, getUploadTypeDir, getUploadFilePath } from "../state/paths";

export async function saveFile(
  file: File,
  type: string = "uploads"
): Promise<{ path: string; filename: string }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Create subdirectory for type
  const typeDir = getUploadTypeDir(type);

  // Generate unique filename
  const ext = path.extname(file.name);
  const filename = `${randomUUID()}${ext}`;
  const filePath = path.join(typeDir, filename);

  // Write file
  fs.writeFileSync(filePath, buffer);

  // Return relative path from uploads directory
  const relativePath = path.join(type, filename);

  return {
    path: relativePath,
    filename: file.name,
  };
}

export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = getUploadFilePath(relativePath);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function getFilePath(relativePath: string): string {
  return getUploadFilePath(relativePath);
}
