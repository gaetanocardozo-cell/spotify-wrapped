import { describe, expect, it } from "vitest";
import { SpotifyError } from "./client";

describe("SpotifyError.hint", () => {
  it("explains the allowlist problem on 403, the most common blocker", () => {
    const err = new SpotifyError(403, '{"error":{"status":403}}', "/v1/me");
    expect(err.hint).toMatch(/allowlist/i);
    expect(err.hint).toMatch(/User Management/);
  });

  it("explains 401 and 429", () => {
    expect(new SpotifyError(401, "", "/v1/me").hint).toMatch(/expired/i);
    expect(new SpotifyError(429, "", "/v1/me").hint).toMatch(/quota|rate/i);
  });

  it("has no hint for unremarkable statuses", () => {
    expect(new SpotifyError(500, "", "/v1/me").hint).toBeNull();
  });
});
