import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("token encryption", () => {
  it("round-trips a refresh token", () => {
    const token = "AQD-long-spotify-refresh-token_value.123";
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("rejects tampered ciphertext instead of returning garbage", () => {
    const payload = encrypt("secret");
    const [iv, data, tag] = payload.split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 0xff;
    const tampered = [iv, flipped.toString("base64url"), tag].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decrypt("nonsense")).toThrow(/Malformed/);
  });

  it("requires a 32-byte key", () => {
    const original = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("too short").toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = original;
  });
});
