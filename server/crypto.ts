/**
 * AES-256-GCM encryption for sensitive user data (e.g. BYOK API keys).
 *
 * Storage format (all hex): iv:authTag:ciphertext
 * The encryption key is derived from ENCRYPTION_KEY env var (32 bytes hex)
 * or falls back to the first 32 bytes of JWT_SECRET.
 */
import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "";
  // Derive a consistent 32-byte key via SHA-256 of the secret
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptString(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, tagHex, cipherHex] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Returns a masked display version like gsk_...****abc */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 7) + "..." + "****" + key.slice(-3);
}
