import { afterEach, describe, expect, it } from "vitest";
import { resolveRedirectUri } from "./redirect";

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

afterEach(() => {
  delete process.env.SPOTIFY_REDIRECT_URI;
});

describe("resolveRedirectUri", () => {
  it("rewrites localhost to the loopback literal Spotify accepts", () => {
    // Spotify rejects the hostname "localhost" outright.
    expect(resolveRedirectUri(req("http://localhost:3000/api/auth/login"))).toBe(
      "http://127.0.0.1:3000/api/auth/callback",
    );
  });

  it("keeps http for loopback addresses", () => {
    expect(resolveRedirectUri(req("http://127.0.0.1:3000/api/auth/login"))).toBe(
      "http://127.0.0.1:3000/api/auth/callback",
    );
  });

  it("forces https for any non-loopback host", () => {
    const r = req("http://example.com/api/auth/login", { host: "example.com" });
    expect(resolveRedirectUri(r)).toBe("https://example.com/api/auth/callback");
  });

  it("honours proxy headers so previews and Vercel work", () => {
    const r = req("http://internal:3000/api/auth/login", {
      "x-forwarded-host": "3000-abc123.e2b.app",
      "x-forwarded-proto": "https",
    });
    expect(resolveRedirectUri(r)).toBe("https://3000-abc123.e2b.app/api/auth/callback");
  });

  it("lets an explicit override win", () => {
    process.env.SPOTIFY_REDIRECT_URI = "https://pinned.example/api/auth/callback";
    expect(resolveRedirectUri(req("http://127.0.0.1:3000/api/auth/login"))).toBe(
      "https://pinned.example/api/auth/callback",
    );
  });
});

describe("localhost / 127.0.0.1 origin split", () => {
  it("rewrites a localhost host to the loopback literal Spotify accepts", () => {
    const req = new Request("http://localhost:3000/api/auth/login", {
      headers: { host: "localhost:3000" },
    });
    expect(resolveRedirectUri(req)).toBe("http://127.0.0.1:3000/api/auth/callback");
  });

  it("preserves a non-default port when rewriting", () => {
    const req = new Request("http://localhost:4123/api/auth/login", {
      headers: { host: "localhost:4123" },
    });
    expect(resolveRedirectUri(req)).toBe("http://127.0.0.1:4123/api/auth/callback");
  });
});
