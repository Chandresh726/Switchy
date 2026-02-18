import fs from "fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

import { ensureStateDir, getEncryptionSecretPath } from "@/lib/state/paths";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
let cachedSecret: string | null = null;

function readSecretFromFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const secret = fs.readFileSync(filePath, "utf8").trim();
  return secret.length > 0 ? secret : null;
}

function getOrCreateLocalSecret(): string {
  if (cachedSecret) {
    return cachedSecret;
  }

  ensureStateDir();
  const secretPath = getEncryptionSecretPath();
  const existingSecret = readSecretFromFile(secretPath);

  if (existingSecret) {
    cachedSecret = existingSecret;
    return existingSecret;
  }

  const generatedSecret = randomBytes(KEY_LENGTH).toString("base64");

  try {
    fs.writeFileSync(secretPath, generatedSecret, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    cachedSecret = generatedSecret;
    return generatedSecret;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      const concurrentSecret = readSecretFromFile(secretPath);
      if (concurrentSecret) {
        cachedSecret = concurrentSecret;
        return concurrentSecret;
      }
    }
    throw error;
  }
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

function getKey(salt: Buffer): Buffer {
  return deriveKey(getOrCreateLocalSecret(), salt);
}

export function encryptApiKey(apiKey: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = getKey(salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export class DecryptionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "DecryptionError";
  }
}

export function decryptApiKey(encryptedData: string): string {
  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 4) {
      throw new DecryptionError("Invalid encrypted data format");
    }
    
    const [saltB64, ivB64, tagB64, encryptedB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const encrypted = Buffer.from(encryptedB64, "base64");

    const key = getKey(salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (error) {
    if (error instanceof DecryptionError) {
      throw error;
    }
    throw new DecryptionError("Failed to decrypt API key", error instanceof Error ? error : undefined);
  }
}
