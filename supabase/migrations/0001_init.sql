-- Personal Spotify Wrapped — initial schema
-- Targets Postgres 15+ (Supabase) and PGlite for local dev.

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists spotify_accounts (
  id                  text primary key,              -- spotify user id
  display_name        text,
  email               text,
  country             text,
  product             text,
  refresh_token       text,                          -- encrypted at rest (app-layer)
  access_token        text,
  token_expires_at    timestamptz,
  scopes              text,
  -- The moment we began collecting plays. Everything before this is NOT
  -- covered by real data; the UI must warn instead of silently lying.
  tracking_started_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table if not exists artists (
  id          text primary key,
  name        text not null,
  genres      text[] not null default '{}',
  popularity  int,
  followers   int,
  image_url   text,
  fetched_at  timestamptz
);

create table if not exists albums (
  id           text primary key,
  name         text not null,
  album_type   text,
  release_date text,
  total_tracks int,
  image_url    text,
  fetched_at   timestamptz
);

create table if not exists tracks (
  id                text primary key,
  name              text not null,
  duration_ms       int not null,
  album_id          text references albums(id) on delete set null,
  primary_artist_id text references artists(id) on delete set null,
  popularity        int,
  explicit          boolean,
  isrc              text,
  fetched_at        timestamptz
);

-- Full credit list for a track, so features are handled properly.
create table if not exists track_artists (
  track_id  text not null references tracks(id) on delete cascade,
  artist_id text not null references artists(id) on delete cascade,
  position  int  not null default 0,
  primary key (track_id, artist_id)
);

-- ---------------------------------------------------------------------------
-- Plays — the heart of the warehouse
-- ---------------------------------------------------------------------------
do $$ begin
  create type play_source as enum ('api', 'export', 'synthetic');
exception when duplicate_object then null; end $$;

create table if not exists plays (
  id             bigserial primary key,
  user_id        text not null references spotify_accounts(id) on delete cascade,
  played_at      timestamptz not null,
  track_id       text not null references tracks(id) on delete cascade,
  context_type   text,          -- playlist | album | artist | collection | null
  context_uri    text,
  -- Estimated listening time. The API never tells us this; see est_ms_played
  -- derivation in src/lib/ingest/estimate.ts. Export rows carry the real value.
  est_ms_played  int,
  source         play_source not null default 'api',
  created_at     timestamptz not null default now(),
  -- Idempotent ingest: re-polling the same window can never duplicate a play.
  unique (user_id, played_at, track_id)
);

create index if not exists plays_user_played_at_idx on plays (user_id, played_at desc);
create index if not exists plays_track_idx          on plays (track_id);
create index if not exists artists_genres_gin       on artists using gin (genres);

-- ---------------------------------------------------------------------------
-- Pre-tracking seed: the three fixed windows the API *does* expose.
-- Rendered as "estimated" for dates before tracking_started_at.
-- ---------------------------------------------------------------------------
do $$ begin
  create type snapshot_kind as enum ('artist', 'track');
exception when duplicate_object then null; end $$;

create table if not exists legacy_snapshots (
  id          bigserial primary key,
  user_id     text not null references spotify_accounts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  time_range  text not null,   -- short_term | medium_term | long_term
  kind        snapshot_kind not null,
  rank        int not null,
  entity_id   text not null,
  unique (user_id, captured_at, time_range, kind, rank)
);

-- ---------------------------------------------------------------------------
-- Observability for the collector
-- ---------------------------------------------------------------------------
create table if not exists sync_runs (
  id            bigserial primary key,
  user_id       text references spotify_accounts(id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  rows_ingested int not null default 0,
  status        text not null default 'running',  -- running | ok | error
  error         text
);

create index if not exists sync_runs_user_started_idx on sync_runs (user_id, started_at desc);
