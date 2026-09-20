import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { migrate } from "@/lib/db/migrate";
import { exchangeCode, getMe } from "@/lib/spotify/client";
import { saveTokens } from "@/lib/spotify/tokens";
import { resolveRedirectUri } from "@/lib/spotify/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error)}`, url.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?auth_error=missing_code", url.origin));
  }

  const jar = await cookies();
  const expectedState = jar.get("spotify_oauth_state")?.value;
  if (!expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?auth_error=state_mismatch", url.origin));
  }

  // Must be byte-identical to the URI used in the authorize step.
  const redirectUri = jar.get("spotify_redirect_uri")?.value ?? resolveRedirectUri(request);

  try {
    const tokens = await exchangeCode(code, redirectUri);
    const me = await getMe(tokens.access_token);
    if (!me) throw new Error("Could not read Spotify profile");

    const db = await getDb();
    await migrate(db, false);

    // tracking_started_at is set once and never moved: it marks the boundary
    // before which we have no real data and must not pretend otherwise.
    await db.query(
      `insert into spotify_accounts (id, display_name, email, country, product, tracking_started_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (id) do update set
         display_name = excluded.display_name,
         email   = coalesce(excluded.email, spotify_accounts.email),
         country = coalesce(excluded.country, spotify_accounts.country),
         product = coalesce(excluded.product, spotify_accounts.product),
         updated_at = now()`,
      [
        me.id,
        me.display_name,
        // These three were removed from /me for dev-mode apps in Feb 2026.
        me.email ?? null,
        me.country ?? null,
        me.product ?? null,
      ],
    );

    await saveTokens(db, me.id, tokens);

    jar.delete("spotify_oauth_state");
    jar.delete("spotify_redirect_uri");

    return NextResponse.redirect(new URL("/?connected=1", url.origin));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // A 403 here almost always means the Spotify account isn't on the app's
    // development-mode allowlist. The raw message ("User not approved for
    // app") is too cryptic to act on, so translate it.
    const friendly = /403/.test(message)
      ? "Spotify returned 403. Your account is probably not on the app's allowlist. " +
        "Go to developer.spotify.com/dashboard → your app → User Management, and add " +
        "your full name plus the exact email from spotify.com/account/profile. " +
        "Also confirm the app owner has Premium. Changes take up to 15 minutes."
      : message;

    console.error("[oauth callback] FAILED:", message);
    console.error("[oauth callback] redirect_uri used:", redirectUri);
    console.error("[oauth callback] Run `npm run spotify:doctor` to diagnose.");

    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(friendly.slice(0, 400))}`, url.origin),
    );
  }
}
