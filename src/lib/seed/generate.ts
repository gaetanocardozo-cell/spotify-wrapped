/**
 * Synthetic play-history generator.
 *
 * Produces a plausible listening history so every chart, comparison and edge
 * case in the UI can be exercised before real data exists. Realism that
 * actually matters for the visualizations:
 *
 *   - Circadian rhythm: commute peaks, an afternoon work block, a night tail.
 *   - Weekday vs weekend shapes differ.
 *   - Sessions, not isolated plays: tracks arrive in runs from one context.
 *   - Taste drift: per-artist `trend` shifts share across the window, which is
 *     what makes the period-over-period winners/losers tables meaningful.
 *   - Skips: some plays are cut short, producing real completion ratios.
 *   - Vacation gaps and binge days, so streak/heatmap logic gets tested.
 *
 * Fully deterministic given a seed, so runs are reproducible.
 */

import { buildCatalog, type SeedTrack } from "./catalog";
import { MIN_PLAY_MS } from "../ingest/estimate";

export interface GeneratedPlay {
  playedAt: Date;
  trackId: string;
  contextType: string | null;
  contextUri: string | null;
  estMsPlayed: number;
}

/** Milliseconds a zone is ahead of UTC at a given instant (negative west of UTC). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(at).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second,
  );
  return asUtc - at.getTime();
}

/** mulberry32 — small, fast, deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Relative likelihood of starting a session at a given local hour. */
function hourWeight(hour: number, isWeekend: boolean): number {
  if (isWeekend) {
    if (hour < 9) return 0.05;
    if (hour < 12) return 0.5;
    if (hour < 18) return 1.0;
    if (hour < 23) return 1.2;
    return 0.3;
  }
  if (hour < 6) return 0.03;
  if (hour < 9) return 1.1;   // morning commute
  if (hour < 12) return 0.9;  // deep work
  if (hour < 14) return 0.6;  // lunch
  if (hour < 18) return 1.0;  // afternoon work block
  if (hour < 20) return 1.2;  // evening commute
  if (hour < 23) return 0.8;
  return 0.2;
}

const CONTEXTS: Array<[string, string, number]> = [
  ["playlist", "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", 0.45],
  ["album", "", 0.3],
  ["artist", "", 0.12],
  ["collection", "spotify:user:collection", 0.13],
];

export interface GenerateOptions {
  from: Date;
  to: Date;
  seed?: number;
  /** Average sessions per day; actual count varies day to day. */
  sessionsPerDay?: number;
  /** IANA zone used to shape the circadian rhythm. */
  timeZone?: string;
}

export function generatePlays(opts: GenerateOptions): GeneratedPlay[] {
  const { from, to, seed = 42, sessionsPerDay = 4.6, timeZone = "America/Bogota" } = opts;
  // Offset between UTC and the listener's zone, so the circadian curve below
  // describes *their* local clock rather than the server's.
  const tzOffsetMs = zoneOffsetMs(from, timeZone);
  const rand = rng(seed);
  const catalog = buildCatalog();
  const { tracks } = catalog;
  const tracksByArtist = new Map<string, SeedTrack[]>();
  for (const t of tracks) {
    const list = tracksByArtist.get(t.artistId) ?? [];
    list.push(t);
    tracksByArtist.set(t.artistId, list);
  }

  const plays: GeneratedPlay[] = [];
  const totalDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));

  // Multi-day gaps (travel, illness) to exercise streak + heatmap logic.
  const gapDays = new Set<number>();
  for (let g = 0; g < Math.floor(totalDays / 70); g++) {
    const start = Math.floor(rand() * totalDays);
    const len = 3 + Math.floor(rand() * 6);
    for (let d = 0; d < len; d++) gapDays.add(start + d);
  }

  for (let day = 0; day < totalDays; day++) {
    if (gapDays.has(day)) continue;

    const dayStart = new Date(from.getTime() + day * 86_400_000);
    const dow = new Date(dayStart.getTime() + tzOffsetMs).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    // How far through the window we are; drives taste drift.
    const progress = day / totalDays;

    // Binge days: occasional 2-3x listening.
    const binge = rand() < 0.06 ? 2 + rand() : 1;
    const sessions = Math.max(0, Math.round((sessionsPerDay * (isWeekend ? 1.15 : 1) * binge) + (rand() - 0.5) * 2));

    for (let s = 0; s < sessions; s++) {
      // Pick a session start hour weighted by the circadian curve.
      let hour = 12;
      for (let attempt = 0; attempt < 12; attempt++) {
        const h = Math.floor(rand() * 24);
        if (rand() < hourWeight(h, isWeekend) / 1.2) {
          hour = h;
          break;
        }
      }

      // Weighted artist choice, with trend applied over the window.
      const weights = catalog.artists.map((a) => {
        const trend = a.trend ?? 0;
        // Share moves smoothly from (1 - trend/2) to (1 + trend/2).
        const drift = 1 + trend * (progress - 0.5);
        return Math.max(0.05, a.weight * drift);
      });
      const totalWeight = weights.reduce((x, y) => x + y, 0);

      const pickArtist = () => {
        let r = rand() * totalWeight;
        for (let i = 0; i < catalog.artists.length; i++) {
          r -= weights[i];
          if (r <= 0) return catalog.artists[i];
        }
        return catalog.artists[catalog.artists.length - 1];
      };

      let artist = pickArtist();
      const [contextType, contextUriBase] = (() => {
        let r = rand();
        for (const [type, uri, p] of CONTEXTS) {
          if (r < p) return [type, uri] as const;
          r -= p;
        }
        return ["playlist", CONTEXTS[0][1]] as const;
      })();

      const sessionLength = 1 + Math.floor(rand() * (contextType === "album" ? 9 : 6));
      // Build the instant such that it renders as `hour` in the listener's zone.
      let cursor = new Date(
        Date.UTC(
          dayStart.getUTCFullYear(),
          dayStart.getUTCMonth(),
          dayStart.getUTCDate(),
          hour,
          Math.floor(rand() * 60),
          Math.floor(rand() * 60),
          0,
        ) - tzOffsetMs,
      );

      for (let i = 0; i < sessionLength; i++) {
        // Album/artist sessions stay with one artist; playlists wander.
        if (contextType === "playlist" || contextType === "collection") {
          if (i > 0 && rand() < 0.7) artist = pickArtist();
        }
        const pool = tracksByArtist.get(artist.id) ?? [];
        if (pool.length === 0) continue;

        // Weighted track pick — hits dominate, deep cuts appear occasionally.
        const tw = pool.reduce((acc, t) => acc + t.weight, 0);
        let r = rand() * tw;
        let track = pool[0];
        for (const t of pool) {
          r -= t.weight;
          if (r <= 0) {
            track = t;
            break;
          }
        }

        // Skips: ~18% of plays are cut short.
        const skipped = rand() < 0.18;
        const estMs = skipped
          ? Math.max(MIN_PLAY_MS, Math.round(track.durationMs * (0.15 + rand() * 0.5)))
          : track.durationMs;

        plays.push({
          playedAt: new Date(cursor),
          trackId: track.id,
          contextType,
          contextUri:
            contextType === "album"
              ? `spotify:album:${track.albumId}`
              : contextType === "artist"
                ? `spotify:artist:${artist.id}`
                : contextUriBase,
          estMsPlayed: estMs,
        });

        // Next play starts when this one ends, plus a little friction.
        cursor = new Date(cursor.getTime() + estMs + Math.floor(rand() * 4000));
      }
    }
  }

  plays.sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

  // Enforce the unique(user, played_at, track) constraint: nudge collisions.
  const seen = new Set<string>();
  for (const p of plays) {
    let key = `${p.playedAt.getTime()}|${p.trackId}`;
    while (seen.has(key)) {
      p.playedAt = new Date(p.playedAt.getTime() + 1000);
      key = `${p.playedAt.getTime()}|${p.trackId}`;
    }
    seen.add(key);
  }

  return plays.filter((p) => p.playedAt >= from && p.playedAt <= to);
}

