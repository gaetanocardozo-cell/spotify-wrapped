/**
 * Estimating listening time.
 *
 * Spotify's Web API never tells us how long a track was actually played. The
 * best available estimator is the gap to the *next* play:
 *
 *   est = clamp(next.played_at - this.played_at, MIN_PLAY_MS, duration_ms)
 *
 *   - Upper clamp at duration_ms: a long gap means you stopped listening, not
 *     that the track looped.
 *   - Lower clamp at 30s: a play only enters Spotify's history at all after
 *     ~30 seconds, so anything shorter is an artifact of clock skew.
 *   - The most recent play has no successor, so it falls back to duration_ms.
 *
 * This is dramatically better than naively summing durations, which
 * over-counts every single skip. It is still an estimate and the UI says so.
 */

export const MIN_PLAY_MS = 30_000;

export interface PlayForEstimate {
  played_at: Date | string;
  duration_ms: number;
}

export function estimateMsPlayed(
  current: PlayForEstimate,
  next: PlayForEstimate | undefined,
): number {
  const duration = current.duration_ms;
  if (!next) return duration;

  const start = new Date(current.played_at).getTime();
  const nextStart = new Date(next.played_at).getTime();
  const gap = nextStart - start;

  // Out-of-order or duplicate timestamps (offline sync can do this).
  if (!Number.isFinite(gap) || gap <= 0) return Math.min(duration, MIN_PLAY_MS);

  return Math.max(MIN_PLAY_MS, Math.min(gap, duration));
}

/**
 * Applies the estimator across a chronologically ascending list of plays.
 * Returns est_ms_played aligned to the input order.
 */
export function estimateSeries(playsAsc: PlayForEstimate[]): number[] {
  return playsAsc.map((p, i) => estimateMsPlayed(p, playsAsc[i + 1]));
}

/** Completion ratio, a usable skip signal. Clamped to [0, 1]. */
export function completionRatio(estMsPlayed: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, estMsPlayed / durationMs));
}
