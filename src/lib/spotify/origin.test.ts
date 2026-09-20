import { describe, it, expect } from "vitest";
import { resolveAppOrigin, isSecureRequest } from "./origin";

const codespace = "humble-waffle-p7g7jgjgqrv7f6v5g-3000.app.github.dev";

function req(headers: Record<string, string>) {
  // Next reports the bind address in request.url behind a proxy.
  return new Request("http://0.0.0.0:3000/api/auth/callback", { headers });
}

describe("resolveAppOrigin", () => {
  it("never returns the 0.0.0.0 bind address when forwarded headers exist", () => {
    const origin = resolveAppOrigin(
      req({ host: codespace, "x-forwarded-host": codespace, "x-forwarded-proto": "https" }),
    );
    expect(origin).toBe(`https://${codespace}`);
    expect(origin).not.toContain("0.0.0.0");
  });

  it("forces https for non-loopback hosts even if the proxy says http", () => {
    expect(resolveAppOrigin(req({ "x-forwarded-host": codespace, "x-forwarded-proto": "http" })))
      .toBe(`https://${codespace}`);
  });

  it("takes the first value of a comma-joined x-forwarded-proto", () => {
    expect(
      resolveAppOrigin(req({ "x-forwarded-host": codespace, "x-forwarded-proto": "https, http" })),
    ).toBe(`https://${codespace}`);
  });

  it("keeps http for loopback development", () => {
    expect(resolveAppOrigin(req({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
  });

  it("marks proxied https requests as secure and loopback as not", () => {
    expect(isSecureRequest(req({ "x-forwarded-host": codespace }))).toBe(true);
    expect(isSecureRequest(req({ host: "127.0.0.1:3000" }))).toBe(false);
  });
});
