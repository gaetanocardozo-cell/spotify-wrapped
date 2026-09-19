# Personal Spotify Wrapped — Build Plan

A self-hosted, calendar-driven alternative to Spotify Wrapped, with arbitrary date
ranges, period-over-period comparisons, and listening-time analytics.

---

## 1. The core constraint (read this first)

Spotify's Web API **cannot** answer "who were my top artists between March 3 and June 12."

| What we want | What the API gives |
|---|---|
| Top artists/tracks for any date range | Only `short_term` (~4 wks), `medium_term` (~6 mo), `long_term` (~1 yr+), max 50 items |
| Full play history | `/me/player/recently-played` — **max 50 items**, cursors cannot page past that window |
| Exact listening time | Not exposed; only `played_at` + track `duration_ms` |
| Genres | Not on tracks. Only on **artist** objects — we derive genres via the artist. |

Also: a play only enters history after **~30s** of playback. This conveniently matches
Wrapped's own counting rule.

### Consequence
We become our own data warehouse. A scheduled job polls `recently-played` and
**accumulates** plays into Postgres forever. The calendar is fully accurate from
**day 1 of tracking onward**. There is no way around this without the Extended
Streaming History export (which we will still support later — see §9).

### Mitigations so the app isn't empty on day one
1. **Seed snapshots.** On first login we capture all three `top/*` windows and store
   them as `legacy_snapshots`. The UI can render an "Estimated / pre-tracking" view for
   dates before tracking began, clearly labelled as approximate.
2. **Coverage banner.** Every tab shows "Tracked data available from {date}". Selecting a
   range that predates it triggers an explicit warning instead of silently lying.
3. **Poll generously.** Every 15–30 min. 50 tracks ≈ 2.5h of audio, so a 30-min cadence
   cannot overflow the buffer even during continuous listening.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Server components for heavy aggregation, route handlers for OAuth/cron |
| Styling | Tailwind + shadcn/ui | Fast, good dark theme, `react-day-picker` range calendar built in |
| DB | **Supabase Postgres** | Your pick. Also gives us `pg_cron` + Auth if wanted |
| DB access | `postgres.js` or Supabase JS, SQL-first | Aggregations are genuinely easier in raw SQL than an ORM |
| Migrations | Supabase CLI (`supabase/migrations`) | Versioned, reproducible |
| Charts | Recharts | Composable, good enough for heatmaps + areas + bars |
| Scheduling | Vercel Cron (or Supabase `pg_cron` → Edge Function) | Whichever we deploy to |
| Deploy | Vercel | Matches Supabase well |

Single-user by default. Schema carries a `user_id` from the start so multi-user is a
config flip, not a rewrite.

---

## 3. Data model

```
spotify_accounts   id, spotify_user_id, display_name, refresh_token(enc),
                   access_token, expires_at, tracking_started_at

plays              id, user_id, played_at timestamptz, track_id,
                   context_type, context_uri,
                   est_ms_played int,              -- see §4
                   UNIQUE (user_id, played_at, track_id)   -- idempotent ingest

tracks             id, name, duration_ms, album_id, popularity, explicit,
                   primary_artist_id, fetched_at

track_artists      track_id, artist_id, position     -- features handled properly

artists            id, name, genres text[], popularity, followers,
                   image_url, fetched_at

albums             id, name, release_date, image_url, album_type

legacy_snapshots   user_id, captured_at, time_range, kind(artist|track),
                   rank, entity_id            -- the pre-tracking seed

sync_runs          id, started_at, finished_at, rows_ingested, status, error
```

Indexes: `plays(user_id, played_at DESC)`, `plays(track_id)`, GIN on `artists.genres`.

**Genre weighting.** Spotify puts genres on artists, as a flat unranked array. A play of
an artist tagged `["reggaeton","urbano latino","trap latino"]` contributes to all three.
Default: **fractional** credit (1/n per genre) so prolific-tagged artists don't dominate;
toggleable to full credit. This will be a documented, visible choice in the UI.

---

## 4. Estimating listening time

The API never tells us how long you actually listened. Best available estimator:

```
est_ms_played = clamp( played_at[next] - played_at[current], 30_000, duration_ms )
```

Rationale: if the next play started 2:10 after this one, you listened ~2:10 of it. Clamp
at the track duration (gaps mean you stopped listening, not that you looped) and at 30s
(the minimum for it to be in history at all). The last play in a batch falls back to
`duration_ms`. This is recomputed on ingest as a backfill pass over the tail.

It's an estimate, and the UI will say so on hover. It is dramatically better than naively
summing durations, which over-counts every skip.

---

## 5. Ranking logic ("the same logic Wrapped follows")

Wrapped ranks primarily by **stream count**, where a stream counts at ≥30s. We match that
as the default, with a global toggle you asked for:

- **By streams** (default, Wrapped-compatible) — `COUNT(*)`
- **By minutes** — `SUM(est_ms_played)`

The toggle lives in the sticky header next to the calendar and applies to all four tabs.
Both metrics are always displayed on the cards; only the sort order changes.

Artists: credited per play, **all** credited artists on a track (with a "primary artist
only" toggle, since features distort things). Songs: by `track_id`, with an option to
merge duplicate recordings (same name + same primary artist across album/single/remaster).

---

## 6. UI

**Shell.** Sticky header: range calendar (`react-day-picker` two-month range view) +
presets (Last 7d / 4 weeks / 3 months / 6 months / YTD / Last year / All tracked /
Custom) + metric toggle + comparison-period selector. Range lives in the URL
(`?from=&to=&metric=`) so it persists across tabs, is shareable and back-button friendly.

### Tab 1 — Top Artists
Podium for top 3 (large art, Wrapped-style gradient), then ranked list: rank, image,
name, streams, minutes, share-of-total bar, rank delta vs comparison period, sparkline.
Click → drawer with that artist's per-day timeline, top tracks by you, genre tags,
first-ever play, longest listening streak.

### Tab 2 — Top Songs
Same structure. Extra columns: artist, album art, completion rate
(`est_ms_played / duration_ms` — a real skip signal), first & last play. Filter by artist.

### Tab 3 — Top Genres
Ranked genres + share-of-listening. A treemap and a stacked-area "genre mix over time"
chart, which is the most interesting view here — it shows taste drift. Click a genre →
the artists driving it.

### Tab 4 — Overall Stats
This is where your specific asks land.

**A. Period-over-period.** Comparison window defaults to the immediately preceding window
of equal length; overridable to a fully custom second range (e.g. this June vs last June).
Three "Winners & Losers" tables — artists, songs, genres — each with:
- biggest risers (rank + minutes delta)
- biggest fallers
- **new entries** (0 plays before → charting now)
- **dropped** (was charting → 0 plays now)
- stable core (your actual constants)

**B. Listening time.** Total hours/minutes + delta vs comparison. Broken out by artist, by
song, by genre — each as a share table and a stacked bar.

**C. Visualizations.**
- Minutes per day, area chart with 7-day rolling average
- Calendar heatmap (GitHub-contributions style) for the range
- Hour-of-day × day-of-week heatmap — your listening clock
- Discovery: count of first-ever-heard artists/tracks per week, plus new-vs-familiar ratio
- Repetition/diversity: unique tracks, unique artists, Gini or effective-N on the play
  distribution (are you a rotation listener or an explorer?)
- Skip rate over time, from completion ratios
- Top day, longest session, longest streak of consecutive days
- Context breakdown: playlist vs album vs artist radio, from `context_type`

---

## 7. Build phases

| Phase | Deliverable | Notes |
|---|---|---|
| 0 | Next.js + TS + Tailwind + shadcn scaffold, env config, Supabase project wired, migrations running | |
| 1 | Schema + migrations + typed DB layer + seeded synthetic data generator | Lets us build UI before real data accrues |
| 2 | Spotify OAuth (Authorization Code + PKCE), encrypted refresh-token storage, auto-refresh | |
| 3 | Ingest worker: poll recently-played, dedupe, enrich tracks/artists/albums in batches (50/req), `est_ms_played` backfill, `sync_runs` logging; cron wired | **Ship this early — every day it runs is a day of history you own** |
| 4 | Query engine: pure, tested SQL functions `topArtists/topTracks/topGenres/summary(range, metric)` + `compare(rangeA, rangeB)` | |
| 5 | App shell: calendar, presets, metric toggle, URL state, coverage banner | |
| 6 | Tabs 1–3 | |
| 7 | Tab 4: comparisons + all visualizations | |
| 8 | Polish: shareable Wrapped-style story cards (export to PNG), empty/loading states, mobile, caching | |

**Priority note:** Phase 3 is the long pole in wall-clock terms, not engineering terms.
I want the collector deployed and running as early as possible so your dataset starts
growing while we build everything else on top of synthetic data.

---

## 8. Things worth deciding as we go

- **Timezone.** All aggregation in `America/Bogota` so "days" match your lived days.
  Stored UTC, bucketed local.
- **Spotify app quota mode.** A personal dev-mode app allows up to 25 users — fine. No
  quota-extension review needed.
- **Deprecated endpoints.** `audio-features`, `recommendations`, and `related-artists` are
  no longer available to new apps, so no danceability/energy/valence charts. Genres,
  popularity, and images are unaffected.
- **Podcasts.** `recently-played` is tracks-only; episodes won't appear. Fine for Wrapped.
- **Offline listening** syncs to Spotify late; ingest must therefore be tolerant of
  out-of-order `played_at` (it is — dedupe is on the unique key, not on a high-water mark).

---

## 9. Future: Extended Streaming History

If you ever request the export from Spotify Privacy Settings (takes up to ~30 days), it
contains **every stream since account creation** with true `ms_played`. Phase 9 would add
a drag-and-drop importer that backfills `plays` behind your tracking start date, with
`source = 'export' | 'api'` on each row and real `ms_played` overriding our estimates.
This retroactively makes the calendar span your entire Spotify life.

Cost to keep this door open now: one `source` column. Worth it.
