/**
 * The collector.
 *
 * Polls /me/player/recently-played, upserts catalog rows, and appends plays.
 * This is the only source of true date-ranged history, so correctness and
 * idempotency matter more here than anywhere else in the app.
 *
 * Design notes:
 *
 *  - **Idempotent.** Plays are inserted with ON CONFLICT DO NOTHING against
 *    unique(user_id, played_at, track_id), so overlapping polls are harmless.
 *    We deliberately re-request a small overlap rather than risk a gap.
 *
 *  - **Gap-aware.** The endpoint returns at most 50 items and cannot paginate
 *    deeper. If a run comes back saturated (50 items) we flag it: the poll
 *    cadence is too slow and plays may have been missed permanently.
 *
 *  - **Cheap enrichment.** Feb 2026 removed batch catalog endpoints for dev
 *    mode, so artists are fetched one at a time — but only once ever, and
 *    only for artists we haven't already cached.
 *
 *  - **Estimate backfill.** est_ms_played depends on the *next* play, so the
 *    previously-last play is recomputed once its successor arrives.
 */

import type { Db } from "../db";
import {
  getArtist,
  getRecentlyPlayed,
  mapLimit,
  type FetchLike,
  type RecentlyPlayedItem,
  type SpotifyTrack,
} from "../spotify/client";
import { estimateMsPlayed } from "./estimate";

export interface IngestResult {
  playsFetched: number;
  playsInserted: number;
  artistsEnriched: number;
  saturated: boolean;
  firstPlayAt: Date | null;
  lastPlayAt: Date | null;
}

/** Overlap re-requested each poll, to tolerate clock skew and late sync. */
const OVERLAP_MS = 10 * 60_000;

export async function ingestRecentlyPlayed(
  db: Db,
  userId: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<IngestResult> {
  // Resume from the newest play we already hold, minus an overlap.
  const { rows: latest } = await db.query<{ played_at: Date | null }>(
    `select max(played_at) as played_at from plays where user_id = $1`,
    [userId],
  );
  const lastSeen = latest[0]?.played_at ? new Date(latest[0].played_at).getTime() : null;
  const after = lastSeen ? lastSeen - OVERLAP_MS : undefined;

  const page = await getRecentlyPlayed(accessToken, { after, limit: 50 }, fetchImpl);
  const items = page?.items ?? [];

  const result: IngestResult = {
    playsFetched: items.length,
    playsInserted: 0,
    artistsEnriched: 0,
    // A full page means we may have lost plays beyond the 50-item ceiling.
    saturated: items.length >= 50,
    firstPlayAt: null,
    lastPlayAt: null,
  };
  if (items.length === 0) return result;

  // API returns newest-first; we reason chronologically.
  const asc = [...items].sort(
    (a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime(),
  );
  result.firstPlayAt = new Date(asc[0].played_at);
  result.lastPlayAt = new Date(asc[asc.length - 1].played_at);

  await upsertCatalog(db, asc.map((i) => i.track));
  result.artistsEnriched = await enrichArtists(db, asc, accessToken, fetchImpl);
  result.playsInserted = await insertPlays(db, userId, asc);
  await backfillPreviousEstimate(db, userId, asc[0]);

  return result;
}

async function upsertCatalog(db: Db, tracks: SpotifyTrack[]): Promise<void> {
  const seenTracks = new Set<string>();

  for (const track of tracks) {
    if (seenTracks.has(track.id)) continue;
    seenTracks.add(track.id);

    if (track.album) {
      const image = pickImage(track.album.images);
      await db.query(
        `insert into albums (id, name, album_type, release_date, total_tracks, image_url, fetched_at)
         values ($1,$2,$3,$4,$5,$6, now())
         on conflict (id) do update set
           name = excluded.name, image_url = coalesce(excluded.image_url, albums.image_url)`,
        [
          track.album.id,
          track.album.name,
          track.album.album_type ?? null,
          track.album.release_date ?? null,
          track.album.total_tracks ?? null,
          image,
        ],
      );
    }

    // Artist stubs first, to satisfy the track FK. Genres arrive in enrichment.
    for (const a of track.artists) {
      await db.query(
        `insert into artists (id, name) values ($1,$2)
         on conflict (id) do update set name = excluded.name`,
        [a.id, a.name],
      );
    }

    await db.query(
      `insert into tracks (id, name, duration_ms, album_id, primary_artist_id, explicit, isrc, fetched_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (id) do update set
         name = excluded.name, duration_ms = excluded.duration_ms`,
      [
        track.id,
        track.name,
        track.duration_ms,
        track.album?.id ?? null,
        track.artists[0]?.id ?? null,
        track.explicit ?? null,
        track.external_ids?.isrc ?? null,
      ],
    );

    for (const [i, a] of track.artists.entries()) {
      await db.query(
        `insert into track_artists (track_id, artist_id, position) values ($1,$2,$3)
         on conflict do nothing`,
        [track.id, a.id, i],
      );
    }
  }
}

/**
 * Fetches genres for artists we haven't enriched yet. Batch endpoints were
 * removed for dev-mode apps in Feb 2026, so this is one request per artist —
 * but each artist is only ever fetched once.
 */
async function enrichArtists(
  db: Db,
  items: RecentlyPlayedItem[],
  accessToken: string,
  fetchImpl: FetchLike,
): Promise<number> {
  const ids = [...new Set(items.flatMap((i) => i.track.artists.map((a) => a.id)))];
  if (ids.length === 0) return 0;

  const { rows } = await db.query<{ id: string }>(
    `select id from artists where id = any($1) and fetched_at is not null`,
    [ids],
  );
  const known = new Set(rows.map((r) => r.id));
  const todo = ids.filter((id) => !known.has(id));
  if (todo.length === 0) return 0;

  let enriched = 0;
  await mapLimit(todo, 4, async (id) => {
    const artist = await getArtist(id, accessToken, fetchImpl);
    if (!artist) return;
    await db.query(
      `update artists set
         name = $2,
         genres = coalesce($3, genres),
         popularity = coalesce($4, popularity),
         followers = coalesce($5, followers),
         image_url = coalesce($6, image_url),
         fetched_at = now()
       where id = $1`,
      [
        id,
        artist.name,
        artist.genres ?? null,
        // Absent in dev mode since Feb 2026; coalesce keeps any older value.
        artist.popularity ?? null,
        artist.followers?.total ?? null,
        pickImage(artist.images),
      ],
    );
    enriched++;
  });

  return enriched;
}

async function insertPlays(db: Db, userId: string, asc: RecentlyPlayedItem[]): Promise<number> {
  let inserted = 0;

  for (const [i, item] of asc.entries()) {
    const next = asc[i + 1];
    const est = estimateMsPlayed(
      { played_at: item.played_at, duration_ms: item.track.duration_ms },
      next ? { played_at: next.played_at, duration_ms: next.track.duration_ms } : undefined,
    );

    // A play we already hold may have been stored as a full listen because it
    // was the newest at the time. If this batch reveals its successor, the
    // estimate genuinely improves, so overwrite it. Without a successor the
    // stored value is at least as good, so leave it alone.
    const refine = Boolean(next);

    const { rows } = await db.query<{ inserted: boolean }>(
      `insert into plays (user_id, played_at, track_id, context_type, context_uri, est_ms_played, source)
       values ($1,$2,$3,$4,$5,$6,'api')
       on conflict (user_id, played_at, track_id) do update
         set est_ms_played = case when $7::boolean
                                  then excluded.est_ms_played
                                  else plays.est_ms_played end,
             context_type  = coalesce(plays.context_type, excluded.context_type),
             context_uri   = coalesce(plays.context_uri,  excluded.context_uri)
       returning (xmax = 0) as inserted`,
      [
        userId,
        new Date(item.played_at),
        item.track.id,
        item.context?.type ?? null,
        item.context?.uri ?? null,
        est,
        refine,
      ],
    );
    if (rows[0]?.inserted) inserted++;
  }

  return inserted;
}

/**
 * The previously-newest play was estimated as a full listen because it had no
 * successor. Now that one exists, recompute it.
 */
async function backfillPreviousEstimate(
  db: Db,
  userId: string,
  earliestNew: RecentlyPlayedItem,
): Promise<void> {
  const { rows } = await db.query<{ played_at: Date; track_id: string; duration_ms: number }>(
    `select p.played_at, p.track_id, t.duration_ms
       from plays p join tracks t on t.id = p.track_id
      where p.user_id = $1 and p.played_at < $2
      order by p.played_at desc
      limit 1`,
    [userId, new Date(earliestNew.played_at)],
  );
  const prev = rows[0];
  if (!prev) return;

  const est = estimateMsPlayed(
    { played_at: prev.played_at, duration_ms: prev.duration_ms },
    { played_at: earliestNew.played_at, duration_ms: earliestNew.track.duration_ms },
  );

  await db.query(
    `update plays set est_ms_played = $3
      where user_id = $1 and played_at = $2`,
    [userId, prev.played_at, est],
  );
}

function pickImage(images?: Array<{ url: string; width: number }>): string | null {
  if (!images || images.length === 0) return null;
  // Prefer ~300px: sharp enough for cards, small enough to stay snappy.
  const sorted = [...images].sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300));
  return sorted[0].url;
}

// ---------------------------------------------------------------------------
// Run logging
// ---------------------------------------------------------------------------

export async function startSyncRun(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into sync_runs (user_id, status) values ($1, 'running') returning id`,
    [userId],
  );
  return rows[0].id;
}

export async function finishSyncRun(
  db: Db,
  id: string,
  outcome: { rows?: number; error?: string },
): Promise<void> {
  await db.query(
    `update sync_runs
        set finished_at = now(),
            rows_ingested = $2,
            status = $3,
            error = $4
      where id = $1`,
    [id, outcome.rows ?? 0, outcome.error ? "error" : "ok", outcome.error ?? null],
  );
}
