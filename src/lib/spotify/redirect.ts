/**
 * Resolving the OAuth redirect URI.
 *
 * Spotify requires the redirect_uri in the token exchange to match the one
 * used in the authorize step *exactly*, and both must be pre-registered in the
 * app dashboard. Rules since the Nov 2025 OAuth migration:
 *
 *   - `localhost` is rejected outright; use the literal 127.0.0.1.
 *   - HTTP is permitted only for loopback addresses; everything else HTTPS.
 *
 * We derive it from the incoming request so the same build works on your
 * machine, in a preview sandbox, and on Vercel — with an explicit
 * SPOTIFY_REDIRECT_URI override when you need to pin it.
 */

const CALLBACK_PATH = "/api/auth/callback";

export function resolveRedirectUri(request: Request): string {
  const override = process.env.SPOTIFY_REDIRECT_URI;
  if (override) return override;

  const url = new URL(request.url);

  // Behind a proxy (Vercel, e2b preview) the outer scheme/host live in headers.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  let host = forwardedHost ?? request.headers.get("host") ?? url.host;
  let proto = forwardedProto ?? url.protocol.replace(":", "");

  // Spotify rejects "localhost" — rewrite to the loopback literal it accepts.
  if (host === "localhost" || host.startsWith("localhost:")) {
    host = host.replace("localhost", "127.0.0.1");
  }

  const isLoopback = /^(127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!isLoopback) proto = "https";

  return `${proto}://${host}${CALLBACK_PATH}`;
}
