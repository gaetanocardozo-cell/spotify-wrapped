/**
 * Seeds the database with the synthetic catalog and a generated play history.
 *
 *   npm run db:seed -- --days 540 --seed 42
 *
 * Safe to re-run: plays use ON CONFLICT DO NOTHING against the unique key.
 */

import { getDb } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";
import { buildCatalog } from "../src/lib/seed/catalog";
import { generatePlays } from "../src/lib/seed/generate";

const DEMO_USER = "demo-user";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

async function main() {
  const days = arg("days", 540);
  const seed = arg("seed", 42);

  const db = await getDb();

  console.log("Running migrations...");
  await migrate(db);

  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  console.log(`Seeding demo account (tracking since ${from.toISOString().slice(0, 10)})...`);
  await db.query(
    `insert into spotify_accounts (id, display_name, country, product, tracking_started_at)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set tracking_started_at = excluded.tracking_started_at`,
    [DEMO_USER, "Demo Listener", "CO", "premium", from],
  );

  const { artists, albums, tracks } = buildCatalog();

  console.log(`Inserting ${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks...`);
  for (const a of artists) {
    await db.query(
      `insert into artists (id, name, genres, popularity, followers, image_url, fetched_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (id) do update set
         name = excluded.name, genres = excluded.genres,
         popularity = excluded.popularity, followers = excluded.followers`,
      [a.id, a.name, a.genres, a.popularity, a.followers, null],
    );
  }

  for (const al of albums) {
    await db.query(
      `insert into albums (id, name, album_type, release_date, total_tracks, image_url, fetched_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (id) do update set name = excluded.name`,
      [al.id, al.name, al.albumType, al.releaseDate, 10, null],
    );
  }

  for (const t of tracks) {
    await db.query(
      `insert into tracks (id, name, duration_ms, album_id, primary_artist_id, popularity, explicit, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (id) do update set name = excluded.name, duration_ms = excluded.duration_ms`,
      [t.id, t.name, t.durationMs, t.albumId, t.artistId, t.popularity, false],
    );
    await db.query(
      `insert into track_artists (track_id, artist_id, position) values ($1, $2, 0)
       on conflict do nothing`,
      [t.id, t.artistId],
    );
    for (const [i, feat] of (t.featuring ?? []).entries()) {
      await db.query(
        `insert into track_artists (track_id, artist_id, position) values ($1, $2, $3)
         on conflict do nothing`,
        [t.id, feat, i + 1],
      );
    }
  }

  console.log(`Generating plays over ${days} days...`);
  const plays = generatePlays({ from, to, seed });
  console.log(`Inserting ${plays.length.toLocaleString()} plays...`);

  const CHUNK = 500;
  for (let i = 0; i < plays.length; i += CHUNK) {
    const batch = plays.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((p, j) => {
      const b = j * 6;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
      params.push(DEMO_USER, p.playedAt, p.trackId, p.contextType, p.contextUri, p.estMsPlayed);
    });
    await db.query(
      `insert into plays (user_id, played_at, track_id, context_type, context_uri, est_ms_played)
       values ${values.join(",")}
       on conflict (user_id, played_at, track_id) do nothing`,
      params,
    );
  }

  const { rows } = await db.query<{ count: string; minutes: string; first: Date; last: Date }>(
    `select count(*) as count,
            round(sum(est_ms_played) / 60000.0) as minutes,
            min(played_at) as first,
            max(played_at) as last
     from plays where user_id = $1`,
    [DEMO_USER],
  );

  const r = rows[0];
  console.log("\nDone.");
  console.log(`  plays:    ${Number(r.count).toLocaleString()}`);
  console.log(`  minutes:  ${Number(r.minutes).toLocaleString()} (${Math.round(Number(r.minutes) / 60).toLocaleString()} hours)`);
  console.log(`  range:    ${new Date(r.first).toISOString().slice(0, 10)} → ${new Date(r.last).toISOString().slice(0, 10)}`);

  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
