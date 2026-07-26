import fs from "node:fs";
import path from "node:path";

import { getStatePaths } from "./environment-paths";
import { ensureSwitchyLayoutSync } from "./layout";

const isDev = process.env.NODE_ENV === "development";
const environment = isDev ? "development" : "production";
const paths = getStatePaths(environment);
const coordinationDirectory = paths.coordinationDirectory;
const stateDirectory = paths.stateDirectory;
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
  const resolvedPath = path.resolve(
    uploadsDirectory,
    /* turbopackIgnore: true */
    relativePath
  );
  const uploadRoot = path.normalize(uploadsDirectory);
  if (resolvedPath !== uploadRoot && !resolvedPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Upload path escapes uploads directory");
  }
  return resolvedPath;
}

/**
 * Ensure the state directory structure exists
 * Creates the unified ~/.switchy layout and the active environment's uploads directory
 */
export function ensureStateDir(): void {
  ensureSwitchyLayoutSync(paths.rootStateDirectory);
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
