import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/spotify/client";
import { resolveRedirectUri } from "@/lib/spotify/redirect";
import { checkSpotifyEnv } from "@/lib/env";
import { resolveAppOrigin, isSecureRequest } from "@/lib/spotify/origin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Fail with instructions rather than a bare "not set".
  const issues = checkSpotifyEnv();
  if (issues.length > 0) {
    const summary = issues.map((i) => `${i.key} ${i.problem}`).join("; ");
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(summary)}`, resolveAppOrigin(request)),
    );
  }

  // Spotify forbids "localhost" as a redirect host, so the callback always
  // comes back to 127.0.0.1. The browser treats those as *different origins*,
  // meaning the state cookie we are about to set on localhost would not be
  // readable by the callback. Move the user onto the loopback origin first so
  // the whole handshake happens on a single origin.
  // NB: request.url reports the *bind* address (e.g. 0.0.0.0:3000), not the
  // host the browser typed, so the Host header is the only reliable source.
  const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const isProxied = request.headers.get("x-forwarded-host") !== null;
  if (!isProxied && (hostHeader === "localhost" || hostHeader.startsWith("localhost:"))) {
    const here = new URL(request.url);
    here.protocol = "http:";
    here.host = hostHeader.replace("localhost", "127.0.0.1");
    return NextResponse.redirect(here, { status: 307 });
  }

  const secure = isSecureRequest(request);

  // CSRF protection: a random state echoed back by Spotify and compared.
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("spotify_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  const redirectUri = resolveRedirectUri(request);
  // Remember which URI we used: the token exchange must present an identical one.
  jar.set("spotify_redirect_uri", redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(state, redirectUri));
}
