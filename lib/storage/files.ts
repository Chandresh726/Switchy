import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function saveFile(
  file: File,
  type: string = "uploads"
): Promise<{ path: string; filename: string }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Create subdirectory for type
  const typeDir = path.join(UPLOADS_DIR, type);
  if (!fs.existsSync(typeDir)) {
    fs.mkdirSync(typeDir, { recursive: true });
  }

  // Generate unique filename
  const ext = path.extname(file.name);
  const filename = `${randomUUID()}${ext}`;
  const filePath = path.join(typeDir, filename);

  // Write file
  fs.writeFileSync(filePath, buffer);

  // Return relative path from data directory
  const relativePath = path.join("uploads", type, filename);

  return {
    path: relativePath,
    filename: file.name,
  };
}

export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = path.join(process.cwd(), "data", relativePath);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function getFilePath(relativePath: string): string {
  return path.join(process.cwd(), "data", relativePath);
}
