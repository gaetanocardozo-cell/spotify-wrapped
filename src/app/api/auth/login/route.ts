import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/spotify/client";
import { resolveRedirectUri } from "@/lib/spotify/redirect";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!process.env.SPOTIFY_CLIENT_ID) {
    return NextResponse.json(
      { error: "SPOTIFY_CLIENT_ID is not set. See SETUP.md." },
      { status: 500 },
    );
  }

  // CSRF protection: a random state echoed back by Spotify and compared.
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("spotify_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 600,
  });

  const redirectUri = resolveRedirectUri(request);
  // Remember which URI we used: the token exchange must present an identical one.
  jar.set("spotify_redirect_uri", redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(state, redirectUri));
}
