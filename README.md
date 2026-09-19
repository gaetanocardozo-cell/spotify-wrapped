# Personal Spotify Wrapped

A calendar-driven alternative to Spotify Wrapped: pick **any** date range, on every tab,
and get top artists / songs / genres plus period-over-period comparisons and listening
analytics.

See [`PLAN.md`](./PLAN.md) for the full architecture and roadmap.

---

## Status

| Phase | | |
|---|---|---|
| 0 | Scaffold, env config, dual-driver DB layer | ✅ |
| 1 | Schema, migrations, synthetic data generator | ✅ |
| 2 | Spotify OAuth + encrypted token storage | ⬜ |
| 3 | Ingest worker + cron | ⬜ |
| 4 | Query engine | ⬜ |
| 5 | App shell: calendar + metric toggle | ⬜ |
| 6 | Top Artists / Songs / Genres tabs | ⬜ |
| 7 | Overall Stats: comparisons + visualizations | ⬜ |
| 8 | Polish | ⬜ |

## Quick start

```bash
npm install
cp .env.example .env.local
npm run db:seed      # creates a local Postgres (PGlite) and loads ~540 days of synthetic history
npm run dev
```

Open http://localhost:3000.

### Scripts

| Command | |
|---|---|
| `npm run dev` | Dev server |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Migrate + load synthetic data (`-- --days 540 --seed 42`) |
| `npm run db:reset` | Wipe the local DB and re-seed |
| `npm test` | Unit tests |
| `npm run typecheck` | `tsc --noEmit` |

---

## The central constraint

**Spotify's API cannot answer "who were my top artists between March 3 and June 12."**

- `/me/top/{artists,tracks}` supports only `short_term` (~4wk), `medium_term` (~6mo),
  `long_term` (~1yr+), capped at 50 items.
- `/me/player/recently-played` returns **at most 50 plays**; its `before`/`after` cursors
  cannot page beyond that window. It is not a history endpoint.
- A play only enters history after **~30 seconds** — which happily matches Wrapped's own
  counting rule.

So this app is its own data warehouse: a cron job polls `recently-played` every 15–30 min
and accumulates plays into Postgres permanently. **The calendar is accurate from the day
tracking begins.** Before that, we show clearly-labelled estimates derived from the three
fixed `top/*` windows captured at first login, and every tab carries a coverage banner.

If you ever request Spotify's *Extended Streaming History* export, `plays.source` lets us
backfill your entire listening life behind the tracking start date with true `ms_played`.

---

## Architecture

**Database.** One SQL dialect, two drivers, chosen by `DATABASE_DRIVER`:

- `pglite` — real Postgres compiled to WASM, stored in `./.pglite`. Zero setup for dev.
- `postgres` — Supabase (or any Postgres) via `DATABASE_URL`.

Because PGlite *is* Postgres, migrations and queries are byte-identical across both, so
local development is a faithful rehearsal of production.

**Schema** (`supabase/migrations/0001_init.sql`): `spotify_accounts`, `artists`, `albums`,
`tracks`, `track_artists`, `plays`, `legacy_snapshots`, `sync_runs`.

Two deliberate choices:

- `plays` has `unique (user_id, played_at, track_id)`, so re-polling an overlapping window
  can never create duplicates. Ingest is idempotent by construction, and tolerant of the
  out-of-order timestamps that offline listening produces.
- `track_artists` records the full credit list, so features are attributed properly rather
  than silently handed to the primary artist.

### Estimating listening time

The API never reports how long you actually listened. We estimate it from the gap to your
next play:

```
est = clamp(next.played_at − this.played_at, 30s, duration_ms)
```

Upper clamp because a long gap means you stopped, not that the track looped; lower clamp
because 30s is the threshold for entering history at all. The newest play falls back to
its full duration. This is far better than summing durations, which over-counts every
skip — and it yields a genuine completion-rate signal for free. It is an estimate, and
the UI will say so. (`src/lib/ingest/estimate.ts`)

### Genre weighting

Spotify tags genres on **artists**, as a flat unranked array. An artist tagged
`["reggaeton","urbano latino","trap latino"]` would otherwise triple-count, so genre credit
is **fractional** (1/n per tag) by default, with a full-credit toggle planned.

### Ranking

Wrapped ranks by **stream count** (plays ≥30s), so that's the default. A header toggle
re-ranks everything by **minutes**. Both numbers always display; only the sort changes.

---

## Synthetic data

`npm run db:seed` generates a realistic history so the entire UI can be built and judged
before real data accrues. It is deterministic given a seed and models:

- circadian rhythm, with distinct weekday and weekend shapes, in `APP_TIMEZONE`
- sessions rather than isolated plays, with album sessions staying on one artist
- **taste drift** — per-artist trends over the window, which is what makes the
  period-over-period winners/losers tables meaningful rather than noise
- skips (~18%), producing real completion ratios
- multi-day gaps and binge days, to exercise streak and heatmap logic

A default run is ~10k plays / ~640 hours over 540 days across 24 artists and 119 tracks.

---

## Deploying to Supabase

1. Create a Supabase project.
2. Copy the connection string (Project Settings → Database → URI, session pooler) into
   `DATABASE_URL`.
3. Set `DATABASE_DRIVER=postgres`.
4. `npm run db:migrate`.

The `postgres.js` driver runs with `prepare: false`, which Supabase's poolers require.
