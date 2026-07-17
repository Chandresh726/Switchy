import path from "path";
import os from "os";
import fs from "fs";

/**
 * Centralized state paths for Switchy application.
 * All application state is stored in ~/.switchy to ensure persistence
 * across git operations and project directory changes.
 * 
 * Environment-specific structure:
 * - Development: ~/.switchy/dev/ (switchy.db, uploads/, etc.)
 * - Production: ~/.switchy/ (switchy.db, uploads/, etc.)
 */

const isDev = process.env.NODE_ENV === "development";
const baseDirectory = path.join(os.homedir(), ".switchy");
const coordinationDirectory = `${baseDirectory}.coordination`;
const stateDirectory = isDev ? path.join(baseDirectory, "dev") : baseDirectory;
const uploadsDirectory = path.join(stateDirectory, "uploads");
const databasePath = path.join(stateDirectory, "switchy.db");
const encryptionSecretPath = path.join(stateDirectory, "encryption.secret");

export function getStateCoordinationDir(): string {
  return coordinationDirectory;
}

/**
 * Get the database file path
 */
export function getDbPath(): string {
  return databasePath;
}

/**
 * Get the encryption secret file path
 */
export function getEncryptionSecretPath(): string {
  return encryptionSecretPath;
}

/**
 * Get full path for a specific upload file
 * @param relativePath - path relative to uploads dir (e.g., "resumes/file.pdf")
 */
export function getUploadFilePath(relativePath: string): string {
  const resolvedPath = path.resolve(uploadsDirectory, relativePath);
  const uploadRoot = path.resolve(uploadsDirectory);
  if (resolvedPath !== uploadRoot && !resolvedPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Upload path escapes uploads directory");
  }
  return resolvedPath;
}

/**
 * Ensure the state directory structure exists
 * Creates ~/.switchy/dev (or ~/.switchy) and ~/.switchy/dev/uploads if missing
 */
export function ensureStateDir(): void {
  if (!fs.existsSync(stateDirectory)) {
    fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(uploadsDirectory)) {
    fs.mkdirSync(uploadsDirectory, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get the directory for a specific upload type
 * @param type - upload type (e.g., "resumes", "documents")
 */
export function getUploadTypeDir(type: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(type)) {
    throw new Error("Invalid upload type");
  }
  const typeDir = getUploadFilePath(type);
  if (!fs.existsSync(typeDir)) {
    fs.mkdirSync(typeDir, { recursive: true, mode: 0o700 });
  }
  return typeDir;
}
