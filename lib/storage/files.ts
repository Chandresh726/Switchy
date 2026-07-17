import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getUploadTypeDir, getUploadFilePath } from "../state/paths";

const RESUME_UPLOAD_TYPE = "resumes";
const RESUME_STAGING_DIRECTORY = ".staging";

export async function stageResumeFile(
  file: File
): Promise<{ finalPath: string; stagingPath: string; filename: string }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const typeDir = getUploadTypeDir(RESUME_UPLOAD_TYPE);
  const stagingDir = path.join(typeDir, RESUME_STAGING_DIRECTORY);
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  const ext = path.extname(file.name);
  const filename = `${randomUUID()}${ext}`;
  const finalPath = path.join(RESUME_UPLOAD_TYPE, filename);
  const stagingPath = path.join(RESUME_UPLOAD_TYPE, RESUME_STAGING_DIRECTORY, `${filename}.tmp`);
  fs.writeFileSync(getUploadFilePath(stagingPath), buffer, { mode: 0o600 });
  return {
    finalPath,
    stagingPath,
    filename: file.name,
  };
}

export function finalizeResumeFile(stagingPath: string, finalPath: string): void {
  const source = getUploadFilePath(stagingPath);
  const destination = getUploadFilePath(finalPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.renameSync(source, destination);
  fs.chmodSync(destination, 0o600);
}

export function deleteResumeFile(relativePath: string): void {
  const fullPath = getUploadFilePath(relativePath);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function resumeFileExists(relativePath: string): boolean {
  return fs.existsSync(getUploadFilePath(relativePath));
}

export function listResumeStagingFiles(): Array<{ path: string; modifiedAtMs: number }> {
  const stagingDir = path.join(getUploadTypeDir(RESUME_UPLOAD_TYPE), RESUME_STAGING_DIRECTORY);
  if (!fs.existsSync(stagingDir)) return [];
  return fs.readdirSync(stagingDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return [];
    const relativePath = path.join(RESUME_UPLOAD_TYPE, RESUME_STAGING_DIRECTORY, entry.name);
    const stats = fs.statSync(getUploadFilePath(relativePath));
    return [{ path: relativePath, modifiedAtMs: stats.mtimeMs }];
  });
}

export function getResumeFilePath(relativePath: string): string {
  return getUploadFilePath(relativePath);
}
