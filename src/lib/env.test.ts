import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { checkSpotifyEnv, spotifyConfigured } from "./env";

const KEYS = ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("checkSpotifyEnv", () => {
  it("reports every missing variable at once, not just the first", () => {
    const issues = checkSpotifyEnv();
    expect(issues.map((i) => i.key)).toEqual([
      "SPOTIFY_CLIENT_ID",
      "SPOTIFY_CLIENT_SECRET",
      "TOKEN_ENCRYPTION_KEY",
    ]);
    expect(spotifyConfigured()).toBe(false);
  });

  it("includes an actionable fix for each issue", () => {
    for (const issue of checkSpotifyEnv()) {
      expect(issue.fix.length).toBeGreaterThan(10);
    }
  });

  it("catches a wrongly-sized encryption key before it fails at runtime", () => {
    process.env.SPOTIFY_CLIENT_ID = "id";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("short").toString("base64");

    const issues = checkSpotifyEnv();
    expect(issues).toHaveLength(1);
    expect(issues[0].problem).toMatch(/32 bytes/);
  });

  it("passes when everything is set correctly", () => {
    process.env.SPOTIFY_CLIENT_ID = "id";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    expect(checkSpotifyEnv()).toEqual([]);
    expect(spotifyConfigured()).toBe(true);
  });
});
