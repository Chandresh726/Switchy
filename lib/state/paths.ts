import path from "path";
import os from "os";
import fs from "fs";

/**
 * Centralized state paths for Switchy application.
 * All application state is stored in ~/.switchy to ensure persistence
 * across git operations and project directory changes.
 */

const STATE_DIR = path.join(os.homedir(), ".switchy");
const UPLOADS_DIR = path.join(STATE_DIR, "uploads");
const DB_PATH = path.join(STATE_DIR, "switchy.db");

/**
 * Get the base state directory (~/.switchy)
 */
export function getStateDir(): string {
  return STATE_DIR;
}

/**
 * Get the database file path
 */
export function getDbPath(): string {
  return DB_PATH;
}

/**
 * Get the uploads directory path
 */
export function getUploadsDir(): string {
  return UPLOADS_DIR;
}

/**
 * Get full path for a specific upload file
 * @param relativePath - path relative to uploads dir (e.g., "resumes/file.pdf")
 */
export function getUploadFilePath(relativePath: string): string {
  return path.join(UPLOADS_DIR, relativePath);
}

/**
 * Ensure the state directory structure exists
 * Creates ~/.switchy and ~/.switchy/uploads if missing
 */
export function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

/**
 * Get the directory for a specific upload type
 * @param type - upload type (e.g., "resumes", "documents")
 */
export function getUploadTypeDir(type: string): string {
  const typeDir = path.join(UPLOADS_DIR, type);
  if (!fs.existsSync(typeDir)) {
    fs.mkdirSync(typeDir, { recursive: true });
  }
  return typeDir;
}
