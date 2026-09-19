/**
 * Refresh tokens are long-lived credentials to your Spotify account, so they
 * are encrypted at rest with AES-256-GCM rather than stored in plaintext.
 * A leaked database dump is then useless without TOKEN_ENCRYPTION_KEY.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set (openssl rand -base64 32)");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

/** Returns "iv.ciphertext.authTag", all base64url. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, enc, cipher.getAuthTag()].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Malformed ciphertext");
  const [iv, enc, tag] = parts.map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
