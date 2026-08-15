import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM at-rest encryption for Google OAuth tokens.
 * Key material comes from the server-only NEXUS_TOKEN_ENC_KEY secret.
 */
function key(): Buffer {
  const raw = process.env["NEXUS_TOKEN_ENC_KEY"];
  if (!raw) throw new Error("NEXUS_TOKEN_ENC_KEY is not configured");
  // The secret is a random ASCII string; hash it to exactly 32 bytes.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}