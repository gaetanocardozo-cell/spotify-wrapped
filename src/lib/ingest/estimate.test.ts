import { describe, expect, it } from "vitest";
import { completionRatio, estimateMsPlayed, estimateSeries, MIN_PLAY_MS } from "./estimate";

const at = (iso: string) => new Date(iso);

describe("estimateMsPlayed", () => {
  it("uses the gap to the next play when the track was cut short", () => {
    const est = estimateMsPlayed(
      { played_at: at("2026-01-01T10:00:00Z"), duration_ms: 240_000 },
      { played_at: at("2026-01-01T10:01:00Z"), duration_ms: 200_000 },
    );
    expect(est).toBe(60_000);
  });

  it("clamps at the track duration when there is a long idle gap", () => {
    const est = estimateMsPlayed(
      { played_at: at("2026-01-01T10:00:00Z"), duration_ms: 180_000 },
      { played_at: at("2026-01-01T14:00:00Z"), duration_ms: 180_000 },
    );
    expect(est).toBe(180_000);
  });

  it("falls back to full duration for the most recent play", () => {
    const est = estimateMsPlayed({ played_at: at("2026-01-01T10:00:00Z"), duration_ms: 195_000 }, undefined);
    expect(est).toBe(195_000);
  });

  it("never returns less than the 30s history threshold", () => {
    const est = estimateMsPlayed(
      { played_at: at("2026-01-01T10:00:00Z"), duration_ms: 240_000 },
      { played_at: at("2026-01-01T10:00:05Z"), duration_ms: 240_000 },
    );
    expect(est).toBe(MIN_PLAY_MS);
  });

  it("tolerates out-of-order timestamps from late offline sync", () => {
    const est = estimateMsPlayed(
      { played_at: at("2026-01-01T10:00:00Z"), duration_ms: 240_000 },
      { played_at: at("2026-01-01T09:00:00Z"), duration_ms: 240_000 },
    );
    expect(est).toBe(MIN_PLAY_MS);
  });

  it("does not exceed duration even for a short track followed much later", () => {
    const est = estimateMsPlayed(
      { played_at: at("2026-01-01T10:00:00Z"), duration_ms: 45_000 },
      { played_at: at("2026-01-01T10:30:00Z"), duration_ms: 45_000 },
    );
    expect(est).toBe(45_000);
  });
});

describe("estimateSeries", () => {
  it("aligns estimates to input order and closes out the tail", () => {
    const series = estimateSeries([
      { played_at: at("2026-01-01T10:00:00Z"), duration_ms: 200_000 },
      { played_at: at("2026-01-01T10:02:00Z"), duration_ms: 300_000 },
      { played_at: at("2026-01-01T10:10:00Z"), duration_ms: 150_000 },
    ]);
    expect(series).toEqual([120_000, 300_000, 150_000]);
  });
});

describe("completionRatio", () => {
  it("reports a skip", () => {
    expect(completionRatio(30_000, 240_000)).toBeCloseTo(0.125);
  });

  it("clamps to 1 and handles bad durations", () => {
    expect(completionRatio(300_000, 240_000)).toBe(1);
    expect(completionRatio(1000, 0)).toBe(0);
  });
});
