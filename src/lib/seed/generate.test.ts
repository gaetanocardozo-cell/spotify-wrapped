import { describe, expect, it } from "vitest";
import { generatePlays } from "./generate";
import { buildCatalog } from "./catalog";

const DAY = 86_400_000;
const to = new Date("2026-09-01T00:00:00Z");
const from = new Date(to.getTime() - 180 * DAY);

describe("generatePlays", () => {
  const plays = generatePlays({ from, to, seed: 7 });

  it("produces a substantial, in-range, chronologically sorted history", () => {
    expect(plays.length).toBeGreaterThan(1000);
    for (const p of plays) {
      expect(p.playedAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(p.playedAt.getTime()).toBeLessThanOrEqual(to.getTime());
    }
    const times = plays.map((p) => p.playedAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("never violates the (played_at, track_id) uniqueness constraint", () => {
    const keys = plays.map((p) => `${p.playedAt.getTime()}|${p.trackId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const again = generatePlays({ from, to, seed: 7 });
    expect(again.length).toBe(plays.length);
    expect(again[0].playedAt.getTime()).toBe(plays[0].playedAt.getTime());

    const other = generatePlays({ from, to, seed: 8 });
    expect(other.length).not.toBe(plays.length);
  });

  it("only references tracks that exist in the catalog", () => {
    const ids = new Set(buildCatalog().tracks.map((t) => t.id));
    for (const p of plays) expect(ids.has(p.trackId)).toBe(true);
  });

  it("respects the 30s floor and the track duration ceiling", () => {
    const byId = new Map(buildCatalog().tracks.map((t) => [t.id, t]));
    for (const p of plays) {
      expect(p.estMsPlayed).toBeGreaterThanOrEqual(30_000);
      expect(p.estMsPlayed).toBeLessThanOrEqual(byId.get(p.trackId)!.durationMs);
    }
  });

  it("peaks during waking hours in the listener's local zone", () => {
    const byHour = new Array(24).fill(0);
    for (const p of plays) {
      const local = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Bogota",
        hour: "2-digit",
        hour12: false,
      }).format(p.playedAt);
      byHour[Number(local) % 24]++;
    }
    const peak = byHour.indexOf(Math.max(...byHour));
    expect(peak).toBeGreaterThanOrEqual(7);
    expect(peak).toBeLessThanOrEqual(23);
    // The dead of night should be quiet.
    const night = byHour[3] + byHour[4] + byHour[5];
    expect(night).toBeLessThan(plays.length * 0.05);
  });

  it("produces taste drift, so period-over-period comparisons are meaningful", () => {
    const mid = from.getTime() + (to.getTime() - from.getTime()) / 2;
    const tracks = new Map(buildCatalog().tracks.map((t) => [t.id, t]));
    const count = (pred: (ms: number) => boolean, artistId: string) =>
      plays.filter((p) => pred(p.playedAt.getTime()) && tracks.get(p.trackId)!.artistId === artistId).length;

    // Bad Bunny has the strongest positive trend in the catalog.
    const before = count((ms) => ms < mid, "ar_bad_bunny");
    const after = count((ms) => ms >= mid, "ar_bad_bunny");
    expect(after).toBeGreaterThan(before);

    // Sufjan Stevens has a strong negative trend.
    const sufjanBefore = count((ms) => ms < mid, "ar_sufjan");
    const sufjanAfter = count((ms) => ms >= mid, "ar_sufjan");
    expect(sufjanAfter).toBeLessThan(sufjanBefore);
  });

  it("generates skips, so completion rate is a usable signal", () => {
    const byId = new Map(buildCatalog().tracks.map((t) => [t.id, t]));
    const skipped = plays.filter((p) => p.estMsPlayed < byId.get(p.trackId)!.durationMs * 0.9);
    const rate = skipped.length / plays.length;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.3);
  });

  it("leaves multi-day gaps so streak logic has something to find", () => {
    const days = new Set(plays.map((p) => Math.floor(p.playedAt.getTime() / DAY)));
    const span = Math.round((to.getTime() - from.getTime()) / DAY);
    expect(days.size).toBeLessThan(span);
  });
});
