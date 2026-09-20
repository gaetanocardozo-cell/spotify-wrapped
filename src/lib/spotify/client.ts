/**
 * Spotify Web API client.
 *
 * Deliberately small and injectable: every network call goes through a single
 * `fetch`-shaped function, so tests can drive the whole ingest pipeline from
 * recorded fixtures without touching the network.
 *
 * ## February 2026 Dev Mode restrictions
 *
 * Spotify removed the batch catalog endpoints (`GET /artists?ids=`,
 * `GET /tracks?ids=`, `GET /albums?ids=`) for development-mode apps. We must
 * fetch each entity individually, which makes enrichment far more expensive in
 * request count. Consequences baked into the design here:
 *
 *   - Aggressive caching: an artist/track is fetched once and never re-fetched
 *     (see `fetched_at`), so cost is bounded by catalog size, not play count.
 *   - Concurrency limiting + retry/backoff on 429, since we now issue many
 *     small requests instead of few large ones.
 *   - `artists.popularity` / `followers` are no longer returned in dev mode,
 *     so those columns stay null. Genres — what we actually need — survive.
 */

export const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
export const SPOTIFY_API = "https://api.spotify.com/v1";

/** Read-only scopes. Nothing here can modify the account. */
export const SCOPES = [
  "user-read-recently-played",
  "user-top-read",
  "user-read-private",
] as const;

export type FetchLike = typeof fetch;

export class SpotifyError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`Spotify ${status} for ${url}: ${body.slice(0, 300)}`);
    this.name = "SpotifyError";
  }

  /** Actionable explanation for the failure modes that actually occur. */
  get hint(): string | null {
    if (this.status === 403) {
      return (
        "403 usually means this Spotify account is not on the app's " +
        "development-mode allowlist. Add it under Dashboard -> your app -> " +
        "User Management (exact email), and confirm the app owner has Premium."
      );
    }
    if (this.status === 401) {
      return "401 means the access token is invalid or expired.";
    }
    if (this.status === 429) {
      return "429 means rate-limited or the development-mode quota is exhausted.";
    }
    return null;
  }
}

export interface TokenSet {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

function basicAuth(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set");
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

export function authorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: SCOPES.join(" "),
    // Force the consent screen so switching accounts is possible.
    show_dialog: "false",
  });
  return `${SPOTIFY_ACCOUNTS}/authorize?${params}`;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  const res = await fetchImpl(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new SpotifyError(res.status, text, "/api/token");
  return JSON.parse(text) as TokenSet;
}

export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  const res = await fetchImpl(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new SpotifyError(res.status, text, "/api/token(refresh)");
  return JSON.parse(text) as TokenSet;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET with retry. Honours Retry-After on 429 (quota/rate limit) and retries
 * 5xx with exponential backoff. Returns null on 404 so a delisted track
 * doesn't abort a whole ingest run.
 */
export async function apiGet<T>(
  path: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
  opts: { retries?: number; onRetry?: (info: { attempt: number; waitMs: number; status: number }) => void } = {},
): Promise<T | null> {
  const retries = opts.retries ?? 4;
  const url = path.startsWith("http") ? path : `${SPOTIFY_API}${path}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as T;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new SpotifyError(res.status, await res.text().catch(() => ""), url);
    }

    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30_000, 500 * 2 ** attempt);

    opts.onRetry?.({ attempt, waitMs, status: res.status });
    await sleep(waitMs);
  }
}

/** Runs tasks with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Response shapes (only the fields we consume)
// ---------------------------------------------------------------------------

export interface SpotifyArtistRef {
  id: string;
  name: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  explicit?: boolean;
  external_ids?: { isrc?: string };
  artists: SpotifyArtistRef[];
  album?: {
    id: string;
    name: string;
    album_type?: string;
    release_date?: string;
    total_tracks?: number;
    images?: Array<{ url: string; width: number; height: number }>;
  };
}

export interface RecentlyPlayedItem {
  track: SpotifyTrack;
  played_at: string;
  context: { type?: string; uri?: string } | null;
}

export interface RecentlyPlayedPage {
  items: RecentlyPlayedItem[];
  next: string | null;
  cursors: { after?: string; before?: string } | null;
}

export interface SpotifyArtistFull {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;      // absent in dev mode since Feb 2026
  followers?: { total: number }; // absent in dev mode since Feb 2026
  images?: Array<{ url: string; width: number; height: number }>;
}

export interface SpotifyMe {
  id: string;
  display_name: string | null;
  email?: string;   // removed in dev mode since Feb 2026
  country?: string; // removed in dev mode since Feb 2026
  product?: string; // removed in dev mode since Feb 2026
}

// ---------------------------------------------------------------------------
// Endpoint wrappers
// ---------------------------------------------------------------------------

export function getMe(accessToken: string, fetchImpl: FetchLike = fetch) {
  return apiGet<SpotifyMe>("/me", accessToken, fetchImpl);
}

/**
 * Recently played. `after` is a Unix ms timestamp — only plays strictly after
 * it are returned, which is how we poll incrementally.
 *
 * Hard ceiling of 50 items with no deep pagination: the cursors move only
 * within that window. Polling cadence must stay under ~2.5h of listening.
 */
export function getRecentlyPlayed(
  accessToken: string,
  opts: { after?: number; limit?: number } = {},
  fetchImpl: FetchLike = fetch,
) {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.after) params.set("after", String(opts.after));
  return apiGet<RecentlyPlayedPage>(`/me/player/recently-played?${params}`, accessToken, fetchImpl);
}

/** Single-artist fetch. Batch `GET /artists?ids=` is gone in dev mode. */
export function getArtist(id: string, accessToken: string, fetchImpl: FetchLike = fetch) {
  return apiGet<SpotifyArtistFull>(`/artists/${id}`, accessToken, fetchImpl);
}

export interface TopItemsPage<T> {
  items: T[];
  total: number;
}

export function getTopItems<T>(
  type: "artists" | "tracks",
  timeRange: "short_term" | "medium_term" | "long_term",
  accessToken: string,
  fetchImpl: FetchLike = fetch,
) {
  const params = new URLSearchParams({ time_range: timeRange, limit: "50" });
  return apiGet<TopItemsPage<T>>(`/me/top/${type}?${params}`, accessToken, fetchImpl);
}
