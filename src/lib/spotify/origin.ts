/**
 * Resolving the app's public origin.
 *
 * `new URL(request.url).origin` is NOT safe to use for redirects back to the
 * browser. Next populates request.url from the address the server is bound to,
 * so behind a proxy — GitHub Codespaces, e2b, Vercel — it reads
 * `http://0.0.0.0:3000`, an address the browser cannot reach.
 *
 * The forwarded headers carry the origin the user actually typed, so they take
 * priority, with the bind address as a last resort for direct local runs.
 */

export function resolveAppOrigin(request: Request): string {
  const url = new URL(request.url);

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;

  // A proxy that terminates TLS forwards plain http inside, so trust the
  // forwarded scheme over the connection's own.
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  let proto = forwardedProto ?? url.protocol.replace(":", "");

  // Anything that isn't loopback is reached over TLS in practice.
  const isLoopback = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/.test(host);
  if (!isLoopback) proto = "https";

  return `${proto}://${host}`;
}

/** Whether cookies set on this request should carry the Secure attribute. */
export function isSecureRequest(request: Request): boolean {
  return resolveAppOrigin(request).startsWith("https:");
}
