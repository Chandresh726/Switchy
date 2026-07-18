import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/state/paths", async () => {
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const directory = join(tmpdir(), `switchy-encryption-${process.pid}`);
  return {
    ensureStateDir: () => mkdirSync(directory, { recursive: true, mode: 0o700 }),
    getEncryptionSecretPath: () => join(directory, "encryption.secret"),
  };
});

import {
  decryptApiKey,
  decryptSecret,
  encryptApiKey,
  encryptSecret,
} from "@/lib/encryption";

const stateDirectory = join(tmpdir(), `switchy-encryption-${process.pid}`);

afterAll(() => {
  rmSync(stateDirectory, { recursive: true, force: true });
});

describe("authenticated local encryption", () => {
  it("keeps API-key and generalized secret ciphertext mutually compatible", () => {
    const apiKeyCiphertext = encryptApiKey("api-key-secret");
    const headerCiphertext = encryptSecret(JSON.stringify({ Authorization: "header-secret" }));

    expect(apiKeyCiphertext).not.toContain("api-key-secret");
    expect(headerCiphertext).not.toContain("header-secret");
    expect(decryptSecret(apiKeyCiphertext)).toBe("api-key-secret");
    expect(decryptApiKey(headerCiphertext)).toBe(JSON.stringify({
      Authorization: "header-secret",
    }));
  });

  it("rejects tampered authenticated ciphertext", () => {
    const ciphertext = encryptSecret("sensitive-value");
    const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;

    expect(() => decryptSecret(tampered)).toThrow();
  });
});
