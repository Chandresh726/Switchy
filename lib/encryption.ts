import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;

function getKey(salt: Buffer): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || "switchy-local-secret";
  return scryptSync(secret, salt, KEY_LENGTH);
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

    return decipher.update(encrypted) + decipher.final("utf8");
  } catch (error) {
    if (error instanceof DecryptionError) {
      throw error;
    }
    throw new DecryptionError("Failed to decrypt API key", error instanceof Error ? error : undefined);
  }
}
