import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "../db";
import { migrate } from "../db/migrate";
import { createFakeSpotify, sampleCatalog, type FakePlay } from "../spotify/fixtures";
import { ingestRecentlyPlayed } from "./ingest";

const USER = "test-user";
const { artists, tracks } = sampleCatalog();

async function freshDb(): Promise<Db> {
  const db = await createMemoryDb();
  await migrate(db, false);
  await db.query(
    `insert into spotify_accounts (id, display_name, tracking_started_at)
     values ($1, 'Test Listener', now())`,
    [USER],
  );
  return db;
}

const iso = (min: number) => new Date(Date.UTC(2026, 0, 10, 12, min, 0)).toISOString();

describe("ingestRecentlyPlayed", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("ingests plays and builds the catalog", async () => {
    const plays: FakePlay[] = [
      { trackId: "trk_1", playedAt: iso(0), contextType: "playlist" },
      { trackId: "trk_2", playedAt: iso(4), contextType: "album" },
      { trackId: "trk_3", playedAt: iso(9) },
    ];
    const api = createFakeSpotify({ artists, tracks, plays });

    const result = await ingestRecentlyPlayed(db, USER, "token", api.fetch);

    expect(result.playsFetched).toBe(3);
    expect(result.playsInserted).toBe(3);
    expect(result.saturated).toBe(false);

    const { rows } = await db.query<{ count: string }>(`select count(*) from plays`);
    expect(Number(rows[0].count)).toBe(3);

    const { rows: t } = await db.query<{ count: string }>(`select count(*) from tracks`);
    expect(Number(t[0].count)).toBe(3);

    // Collaboration credited to both artists.
    const { rows: ta } = await db.query<{ artist_id: string }>(
      `select artist_id from track_artists where track_id = 'trk_3' order by position`,
    );
    expect(ta.map((r) => r.artist_id)).toEqual(["art_c", "art_a"]);
  });

  it("enriches artists with genres, fetching each only once", async () => {
    const plays: FakePlay[] = [
      { trackId: "trk_1", playedAt: iso(0) },
      { trackId: "trk_1", playedAt: iso(5) },
      { trackId: "trk_3", playedAt: iso(10) },
    ];
    const api = createFakeSpotify({ artists, tracks, plays });

    const result = await ingestRecentlyPlayed(db, USER, "token", api.fetch);
    expect(result.artistsEnriched).toBe(2); // art_a, art_c

    const { rows } = await db.query<{ id: string; genres: string[] }>(
      `select id, genres from artists where fetched_at is not null order by id`,
    );
    expect(rows.find((r) => r.id === "art_a")?.genres).toEqual(["indie rock", "art pop"]);

    // Two distinct artists appeared, so exactly two artist requests.
    expect(api.callCount("/v1/artists/")).toBe(2);
  });

  it("does not re-fetch artists already enriched on a later run", async () => {
    const first = createFakeSpotify({
      artists, tracks,
      plays: [{ trackId: "trk_1", playedAt: iso(0) }],
    });
    await ingestRecentlyPlayed(db, USER, "token", first.fetch);
    expect(first.callCount("/v1/artists/")).toBe(1);

    const second = createFakeSpotify({
      artists, tracks,
      plays: [
        { trackId: "trk_1", playedAt: iso(0) },
        { trackId: "trk_1", playedAt: iso(30) },
      ],
    });
    await ingestRecentlyPlayed(db, USER, "token", second.fetch);
    // art_a is already cached, so no further artist requests.
    expect(second.callCount("/v1/artists/")).toBe(0);
  });

  it("is idempotent: re-running inserts nothing new", async () => {
    const plays: FakePlay[] = [
      { trackId: "trk_1", playedAt: iso(0) },
      { trackId: "trk_2", playedAt: iso(5) },
    ];
    const api = createFakeSpotify({ artists, tracks, plays });

    const a = await ingestRecentlyPlayed(db, USER, "token", api.fetch);
    expect(a.playsInserted).toBe(2);

    const b = await ingestRecentlyPlayed(db, USER, "token", api.fetch);
    expect(b.playsInserted).toBe(0);

    const { rows } = await db.query<{ count: string }>(`select count(*) from plays`);
    expect(Number(rows[0].count)).toBe(2);
  });

  it("estimates listening time from the gap to the next play", async () => {
    const plays: FakePlay[] = [
      // trk_1 is 200s long but the next play starts 60s later -> skipped.
      { trackId: "trk_1", playedAt: iso(0) },
      { trackId: "trk_2", playedAt: iso(1) },
    ];
    const api = createFakeSpotify({ artists, tracks, plays });
    await ingestRecentlyPlayed(db, USER, "token", api.fetch);

    const { rows } = await db.query<{ track_id: string; est_ms_played: number }>(
      `select track_id, est_ms_played from plays order by played_at`,
    );
    expect(rows[0]).toMatchObject({ track_id: "trk_1", est_ms_played: 60_000 });
    // The newest play has no successor yet, so it counts as a full listen.
    expect(rows[1]).toMatchObject({ track_id: "trk_2", est_ms_played: 180_000 });
  });

  it("backfills the previous tail estimate once a successor arrives", async () => {
    const one = createFakeSpotify({
      artists, tracks,
      plays: [{ trackId: "trk_1", playedAt: iso(0) }],
    });
    await ingestRecentlyPlayed(db, USER, "token", one.fetch);

    let { rows } = await db.query<{ est_ms_played: number }>(`select est_ms_played from plays`);
    expect(rows[0].est_ms_played).toBe(200_000); // full duration, no successor

    // A later poll reveals the next play started only 90s afterwards.
    const two = createFakeSpotify({
      artists, tracks,
      plays: [
        { trackId: "trk_1", playedAt: iso(0) },
        { trackId: "trk_2", playedAt: new Date(Date.UTC(2026, 0, 10, 12, 1, 30)).toISOString() },
      ],
    });
    await ingestRecentlyPlayed(db, USER, "token", two.fetch);

    ({ rows } = await db.query<{ est_ms_played: number }>(
      `select est_ms_played from plays order by played_at limit 1`,
    ));
    expect(rows[0].est_ms_played).toBe(90_000);
  });

  it("resumes from the newest stored play using the after cursor", async () => {
    const api1 = createFakeSpotify({
      artists, tracks,
      plays: [{ trackId: "trk_1", playedAt: iso(0) }],
    });
    await ingestRecentlyPlayed(db, USER, "token", api1.fetch);

    const api2 = createFakeSpotify({
      artists, tracks,
      plays: [
        { trackId: "trk_1", playedAt: iso(0) },
        { trackId: "trk_2", playedAt: iso(60) },
      ],
    });
    await ingestRecentlyPlayed(db, USER, "token", api2.fetch);

    const recentCall = api2.calls.find((c) => c.includes("recently-played"))!;
    expect(recentCall).toContain("after=");

    const { rows } = await db.query<{ count: string }>(`select count(*) from plays`);
    expect(Number(rows[0].count)).toBe(2);
  });

  it("flags saturation when a full 50-item page comes back", async () => {
    const plays: FakePlay[] = Array.from({ length: 60 }, (_, i) => ({
      trackId: "trk_1",
      playedAt: iso(i),
    }));
    const api = createFakeSpotify({ artists, tracks, plays });

    const result = await ingestRecentlyPlayed(db, USER, "token", api.fetch);
    expect(result.playsFetched).toBe(50);
    expect(result.saturated).toBe(true);
  });

  it("retries on 429 and honours Retry-After", async () => {
    const api = createFakeSpotify({
      artists, tracks,
      plays: [{ trackId: "trk_1", playedAt: iso(0) }],
      failures: [{ match: "recently-played", status: 429, times: 1, retryAfter: 0 }],
    });

    const result = await ingestRecentlyPlayed(db, USER, "token", api.fetch);
    expect(result.playsInserted).toBe(1);
    expect(api.callCount("recently-played")).toBe(2);
  });

  it("survives a 5xx during artist enrichment without losing plays", async () => {
    const api = createFakeSpotify({
      artists, tracks,
      plays: [{ trackId: "trk_1", playedAt: iso(0) }],
      failures: [{ match: "/v1/artists/", status: 503, times: 2 }],
    });

    const result = await ingestRecentlyPlayed(db, USER, "token", api.fetch);
    expect(result.playsInserted).toBe(1);
    expect(result.artistsEnriched).toBe(1);
  });

  it("tolerates dev-mode responses missing popularity and followers", async () => {
    const api = createFakeSpotify({
      artists, tracks,
      plays: [{ trackId: "trk_1", playedAt: iso(0) }],
      devMode: true,
    });
    await ingestRecentlyPlayed(db, USER, "token", api.fetch);

    const { rows } = await db.query<{ popularity: number | null; genres: string[] }>(
      `select popularity, genres from artists where id = 'art_a'`,
    );
    expect(rows[0].popularity).toBeNull();
    // Genres are what we actually need, and they survive.
    expect(rows[0].genres.length).toBeGreaterThan(0);
  });

  it("stores playback context for later breakdowns", async () => {
    const api = createFakeSpotify({
      artists, tracks,
      plays: [{ trackId: "trk_1", playedAt: iso(0), contextType: "playlist", contextUri: "spotify:playlist:abc" }],
    });
    await ingestRecentlyPlayed(db, USER, "token", api.fetch);

    const { rows } = await db.query<{ context_type: string; context_uri: string }>(
      `select context_type, context_uri from plays`,
    );
    expect(rows[0]).toMatchObject({ context_type: "playlist", context_uri: "spotify:playlist:abc" });
  });

  it("handles an empty response cleanly", async () => {
    const api = createFakeSpotify({ artists, tracks, plays: [] });
    const result = await ingestRecentlyPlayed(db, USER, "token", api.fetch);
    expect(result).toMatchObject({ playsFetched: 0, playsInserted: 0, saturated: false });
  });
});
