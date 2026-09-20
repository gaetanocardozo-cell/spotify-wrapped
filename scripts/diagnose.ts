/**
 * Spotify connection diagnostics.
 *
 *   npm run spotify:doctor
 *
 * Run this on your own machine (the Arena sandbox cannot reach Spotify).
 * It checks every failure mode that blocks OAuth, in the order they bite,
 * and tells you exactly what to change.
 */

import { createHash } from "node:crypto";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

let failures = 0;

function ok(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}
function bad(msg: string, fix?: string) {
  failures++;
  console.log(`  ${RED}✗${RESET} ${msg}`);
  if (fix) console.log(`    ${DIM}→ ${fix}${RESET}`);
}
function warn(msg: string, fix?: string) {
  console.log(`  ${YELLOW}!${RESET} ${msg}`);
  if (fix) console.log(`    ${DIM}→ ${fix}${RESET}`);
}
function section(title: string) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

/** Show a secret's shape without revealing it. */
function fingerprint(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${value.length} chars, sha256:${hash}`;
}

async function main() {
  console.log(`${BOLD}Spotify connection doctor${RESET}`);

  // -------------------------------------------------------------------------
  section("1. Environment variables");

  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim();

  if (!clientId) {
    bad("SPOTIFY_CLIENT_ID is not set", "Add it to .env.local from the Spotify dashboard.");
  } else if (!/^[0-9a-f]{32}$/i.test(clientId)) {
    bad(
      `SPOTIFY_CLIENT_ID looks malformed (${fingerprint(clientId)})`,
      "It should be exactly 32 hex characters. Check for stray spaces or quotes.",
    );
  } else {
    ok(`SPOTIFY_CLIENT_ID present (${clientId.slice(0, 6)}…${clientId.slice(-4)})`);
  }

  if (!clientSecret) {
    bad("SPOTIFY_CLIENT_SECRET is not set", "Dashboard → Settings → View client secret.");
  } else if (!/^[0-9a-f]{32}$/i.test(clientSecret)) {
    bad(
      `SPOTIFY_CLIENT_SECRET looks malformed (${fingerprint(clientSecret)})`,
      "It should be exactly 32 hex characters.",
    );
  } else {
    ok(`SPOTIFY_CLIENT_SECRET present (${fingerprint(clientSecret)})`);
  }

  if (clientId && clientSecret && clientId === clientSecret) {
    bad("CLIENT_ID and CLIENT_SECRET are identical", "You pasted the same value twice.");
  }

  if (redirectUri) {
    if (redirectUri.includes("localhost")) {
      bad(
        `SPOTIFY_REDIRECT_URI uses "localhost": ${redirectUri}`,
        "Spotify rejects localhost. Use http://127.0.0.1:3000/api/auth/callback",
      );
    } else {
      ok(`SPOTIFY_REDIRECT_URI = ${redirectUri}`);
    }
  } else {
    ok("SPOTIFY_REDIRECT_URI not pinned (derived per-request — fine)");
  }

  if (!clientId || !clientSecret) {
    console.log(`\n${RED}Stopping: credentials missing.${RESET}`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  section("2. Network reachability");

  try {
    const res = await fetch("https://accounts.spotify.com/api/token", { method: "HEAD" });
    ok(`accounts.spotify.com reachable (HTTP ${res.status})`);
  } catch (e) {
    bad(
      `Cannot reach accounts.spotify.com: ${(e as Error).message}`,
      "Check your network / VPN / firewall.",
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  section("3. Client credentials valid?");

  // client_credentials proves the ID+secret pair is real, independently of
  // any user, redirect URI, or allowlist.
  let appTokenWorks = false;
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    const body = (await res.json()) as Record<string, unknown>;

    if (res.ok) {
      ok("Client ID + secret are valid (got an app token)");
      appTokenWorks = true;
    } else if (body.error === "invalid_client") {
      bad(
        "Spotify rejected the credentials: invalid_client",
        "The Client ID or Secret is wrong. Re-copy both from the dashboard. " +
          "If you rotated the secret, the old one stopped working immediately.",
      );
    } else {
      bad(`Token request failed: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    bad(`Token request threw: ${(e as Error).message}`);
  }

  // -------------------------------------------------------------------------
  section("4. Redirect URI registered?");

  // Spotify validates redirect_uri *before* asking the user to log in, so a
  // HEAD on /authorize distinguishes "not registered" from other problems.
  const testUri = redirectUri ?? "http://127.0.0.1:3000/api/auth/callback";
  const authorizeUrl =
    "https://accounts.spotify.com/authorize?" +
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: testUri,
      scope: "user-read-recently-played",
      state: "doctor",
    });

  try {
    const res = await fetch(authorizeUrl, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const text = res.status < 400 ? "" : await res.text().catch(() => "");

    if (location.includes("error=invalid_redirect_uri") || text.includes("INVALID_CLIENT")) {
      bad(
        `Redirect URI not registered: ${testUri}`,
        "Dashboard → Settings → Edit → Redirect URIs → add it exactly, then Save.",
      );
    } else if (res.status === 200 || location.includes("accounts.spotify.com")) {
      ok(`Redirect URI accepted: ${testUri}`);
    } else {
      warn(`Unexpected authorize response (HTTP ${res.status})`, location || text.slice(0, 200));
    }
  } catch (e) {
    warn(`Could not probe /authorize: ${(e as Error).message}`);
  }

  // -------------------------------------------------------------------------
  section("5. Development-mode requirements (2026 rules)");

  console.log(
    `  ${DIM}Spotify tightened Development Mode in Feb/Mar 2026. These are the\n` +
      `  two rules that silently block OAuth with a 403:${RESET}`,
  );

  warn(
    "The APP OWNER must have an active Spotify Premium subscription",
    "Dev-mode apps stop working entirely if the owner's Premium lapses. Free accounts cannot use the Web API.",
  );

  warn(
    "Every user must be on the app's allowlist — including YOU",
    "Dashboard → your app → User Management → Add user. " +
      "Enter the full name and the EXACT email on the Spotify account. " +
      "Changes can take up to ~15 minutes to apply.",
  );

  console.log(
    `\n  ${DIM}Not being allowlisted produces 403 "User not approved for app" on\n` +
      `  /v1/me — typically after the consent screen appears to succeed.${RESET}`,
  );

  // -------------------------------------------------------------------------
  section("Summary");

  if (failures === 0 && appTokenWorks) {
    console.log(`  ${GREEN}Credentials and redirect URI check out.${RESET}`);
    console.log(
      `\n  If connecting still fails, it is almost certainly one of the two\n` +
        `  development-mode rules above. Verify in the dashboard:\n` +
        `    1. Your Spotify account (the app owner) has Premium.\n` +
        `    2. You are listed under User Management, with the exact email\n` +
        `       shown at spotify.com/account/profile.\n`,
    );
    console.log(
      `  ${DIM}Then: restart the dev server, open http://127.0.0.1:3000 in a\n` +
        `  private window, and click Connect Spotify.${RESET}`,
    );
  } else {
    console.log(`  ${RED}${failures} problem(s) found — fix the ✗ items above.${RESET}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
