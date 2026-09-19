/**
 * A fake Spotify API, good enough to drive the real ingest pipeline end to end
 * without network access.
 *
 * It models the behaviours that actually bite:
 *   - newest-first ordering from recently-played
 *   - the hard 50-item ceiling
 *   - `after` filtering by Unix-ms timestamp
 *   - 429 with Retry-After, and 5xx, to exercise backoff
 *   - dev-mode (Feb 2026) responses: no popularity/followers on artists,
 *     no country/email/product on /me
 */

import type { FetchLike, RecentlyPlayedItem, SpotifyTrack } from "./client";

export interface FakeArtist {
  id: string;
  name: string;
  genres: string[];
}

export interface FakeTrackDef {
  id: string;
  name: string;
  durationMs: number;
  artistIds: string[];
  albumId: string;
  albumName: string;
}

export interface FakePlay {
  trackId: string;
  playedAt: string;
  contextType?: string;
  contextUri?: string;
}

export interface FakeSpotifyOptions {
  artists: FakeArtist[];
  tracks: FakeTrackDef[];
  plays: FakePlay[];
  /** Status codes to return before succeeding, per URL substring. */
  failures?: Array<{ match: string; status: number; times: number; retryAfter?: number }>;
  /** Dev-mode strips several fields; default true to match reality. */
  devMode?: boolean;
}

export interface FakeSpotify {
  fetch: FetchLike;
  calls: string[];
  callCount: (substring: string) => number;
}

export function createFakeSpotify(opts: FakeSpotifyOptions): FakeSpotify {
  const { artists, tracks, plays, devMode = true } = opts;
  const failures = (opts.failures ?? []).map((f) => ({ ...f, remaining: f.times }));
  const calls: string[] = [];

  const artistById = new Map(artists.map((a) => [a.id, a]));
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const toTrack = (def: FakeTrackDef): SpotifyTrack => ({
    id: def.id,
    name: def.name,
    duration_ms: def.durationMs,
    explicit: false,
    external_ids: { isrc: `ISRC${def.id}` },
    artists: def.artistIds.map((id) => ({ id, name: artistById.get(id)?.name ?? id })),
    album: {
      id: def.albumId,
      name: def.albumName,
      album_type: "album",
      release_date: "2024-01-01",
      total_tracks: 10,
      images: [
        { url: `https://img.test/${def.albumId}_640.jpg`, width: 640, height: 640 },
        { url: `https://img.test/${def.albumId}_300.jpg`, width: 300, height: 300 },
        { url: `https://img.test/${def.albumId}_64.jpg`, width: 64, height: 64 },
      ],
    },
  });

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

  const fetchImpl: FetchLike = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);

    const failure = failures.find((f) => url.includes(f.match) && f.remaining > 0);
    if (failure) {
      failure.remaining--;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (failure.retryAfter !== undefined) headers["retry-after"] = String(failure.retryAfter);
      return new Response(JSON.stringify({ error: { status: failure.status } }), {
        status: failure.status,
        headers,
      });
    }

    if (url.includes("/me/player/recently-played")) {
      const parsed = new URL(url);
      const after = Number(parsed.searchParams.get("after") ?? 0);
      const limit = Number(parsed.searchParams.get("limit") ?? 50);

      const selected = plays
        .filter((p) => !after || new Date(p.playedAt).getTime() > after)
        // Newest first, exactly like the real endpoint.
        .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
        .slice(0, Math.min(limit, 50));

      const items: RecentlyPlayedItem[] = selected.map((p) => ({
        track: toTrack(trackById.get(p.trackId)!),
        played_at: p.playedAt,
        context: p.contextType
          ? { type: p.contextType, uri: p.contextUri ?? `spotify:${p.contextType}:x` }
          : null,
      }));

      return json({ items, next: null, cursors: null });
    }

    const artistMatch = url.match(/\/v1\/artists\/([^/?]+)/);
    if (artistMatch) {
      const artist = artistById.get(artistMatch[1]);
      if (!artist) return json({ error: { status: 404 } }, 404);
      return json({
        id: artist.id,
        name: artist.name,
        genres: artist.genres,
        images: [{ url: `https://img.test/${artist.id}_320.jpg`, width: 320, height: 320 }],
        // Dev mode (Feb 2026) no longer returns these.
        ...(devMode ? {} : { popularity: 70, followers: { total: 1234 } }),
      });
    }

    if (url.endsWith("/v1/me")) {
      return json({
        id: "test-user",
        display_name: "Test Listener",
        ...(devMode ? {} : { email: "t@example.com", country: "CO", product: "premium" }),
      });
    }

    if (url.includes("/api/token")) {
      return json({
        access_token: "fresh-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
        scope: "user-read-recently-played user-top-read user-read-private",
      });
    }

    return json({ error: { status: 404, message: `unhandled ${url}` } }, 404);
  };

  return {
    fetch: fetchImpl,
    calls,
    callCount: (substring) => calls.filter((c) => c.includes(substring)).length,
  };
}

/** A small, deterministic catalog for tests. */
export function sampleCatalog() {
  const artists: FakeArtist[] = [
    { id: "art_a", name: "Alpha", genres: ["indie rock", "art pop"] },
    { id: "art_b", name: "Beta", genres: ["electronic", "downtempo", "idm"] },
    { id: "art_c", name: "Gamma", genres: ["hip hop"] },
  ];
  const tracks: FakeTrackDef[] = [
    { id: "trk_1", name: "One",   durationMs: 200_000, artistIds: ["art_a"],          albumId: "alb_a", albumName: "A Side" },
    { id: "trk_2", name: "Two",   durationMs: 180_000, artistIds: ["art_b"],          albumId: "alb_b", albumName: "B Side" },
    // A collaboration, to verify feature credit lands in track_artists.
    { id: "trk_3", name: "Three", durationMs: 240_000, artistIds: ["art_c", "art_a"], albumId: "alb_c", albumName: "C Side" },
  ];
  return { artists, tracks };
}
