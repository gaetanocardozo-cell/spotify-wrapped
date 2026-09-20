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
  // Codespaces / devcontainers: the forwarded-port hostname is the only URL
  // that reaches the app, so that is what must be registered with Spotify.
  const csName = process.env.CODESPACE_NAME;
  const csDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (csName && csDomain) {
    const csUri = `https://${csName}-3000.${csDomain}/api/auth/callback`;
    warn(
      "GitHub Codespaces detected — 127.0.0.1 will NOT work here.",
      `Register this redirect URI in the Spotify dashboard:\n    ${csUri}\n` +
        "  Also set the forwarded port's visibility to Public, or Spotify's\n" +
        "  redirect back will hit the Codespaces login wall.",
    );
  }

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
    const body = res.status >= 400 || location ? await res.text().catch(() => "") : "";
    const haystack = `${location} ${body}`;

    // Spotify signals an unregistered/mismatched URI several different ways
    // depending on which layer rejects it.
    if (/INVALID_CLIENT|invalid_redirect_uri|Invalid redirect URI/i.test(haystack)) {
      bad(
        `Redirect URI REJECTED: ${testUri}`,
        "Dashboard → your app → Settings → Edit → Redirect URIs. Add it exactly " +
          "(no trailing slash, port 3000, http not https), press Add, then SAVE.",
      );
    } else if (/error=/.test(location)) {
      const err = new URL(location, "https://accounts.spotify.com").searchParams.get("error");
      bad(`Authorize rejected with error=${err}`, "See the Spotify docs for this error code.");
    } else {
      // A login page (200) or a redirect to the login flow both mean the
      // client_id + redirect_uri pair was accepted.
      ok(`Redirect URI accepted: ${testUri}`);
    }
  } catch (e) {
    warn(`Could not probe /authorize: ${(e as Error).message}`);
  }

  // Warn about URIs that are registered but won't be the one actually used.
  if (!redirectUri) {
    console.log(
      `  ${DIM}Note: the app derives the redirect URI from each request. Running on\n` +
        `  a port other than 3000 will send a URI you may not have registered.${RESET}`,
    );
  }

  // -------------------------------------------------------------------------
  section("5. Is an existing token stored? (tests the allowlist directly)");

  // If a refresh token is already stored we can call /v1/me and observe the
  // real 403, which is the only definitive test for allowlist membership.
  try {
    const { getDb } = await import("../src/lib/db");
    const { getAccount } = await import("../src/lib/spotify/tokens");
    const { decrypt } = await import("../src/lib/crypto");

    const db = await getDb();
    const account = await getAccount(db);

    if (!account?.refresh_token) {
      console.log(`  ${DIM}No stored token yet — nothing to test. Expected before first connect.${RESET}`);
    } else {
      const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: decrypt(account.refresh_token),
        }),
      });

      if (!refreshRes.ok) {
        const err = (await refreshRes.json()) as Record<string, unknown>;
        bad(
          `Stored refresh token rejected: ${JSON.stringify(err)}`,
          "Reconnect. Note refresh tokens now expire 6 months after the original authorization.",
        );
      } else {
        const { access_token } = (await refreshRes.json()) as { access_token: string };
        const meRes = await fetch("https://api.spotify.com/v1/me", {
          headers: { Authorization: `Bearer ${access_token}` },
        });

        if (meRes.status === 403) {
          bad(
            "403 from /v1/me — YOUR ACCOUNT IS NOT ON THE ALLOWLIST",
            "Dashboard → your app → User Management → add your full name and the " +
              "exact email from spotify.com/account/profile. Wait ~15 minutes.",
          );
        } else if (meRes.ok) {
          const me = (await meRes.json()) as { id: string; display_name?: string };
          ok(`/v1/me works — connected as ${me.display_name ?? me.id}. Allowlist is fine.`);
        } else {
          bad(`/v1/me returned ${meRes.status}`, (await meRes.text()).slice(0, 200));
        }
      }
    }
    await db.close();
  } catch (e) {
    console.log(`  ${DIM}Could not check stored token: ${(e as Error).message}${RESET}`);
  }

  // -------------------------------------------------------------------------
  section("6. Development-mode requirements (2026 rules)");

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
