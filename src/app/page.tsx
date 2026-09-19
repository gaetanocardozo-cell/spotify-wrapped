import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Stats {
  plays: number;
  minutes: number;
  artists: number;
  tracks: number;
  genres: number;
  first: string | null;
  last: string | null;
}

interface TopRow {
  name: string;
  streams: number;
  minutes: number;
}

async function loadStats(): Promise<{ stats: Stats; topArtists: TopRow[]; topGenres: TopRow[] } | null> {
  try {
    const db = await getDb();
    const { rows: s } = await db.query<Record<string, string | null>>(`
      select
        (select count(*) from plays)                                  as plays,
        (select coalesce(round(sum(est_ms_played)/60000.0), 0) from plays) as minutes,
        (select count(*) from artists)                                as artists,
        (select count(*) from tracks)                                 as tracks,
        (select count(distinct g) from artists, unnest(genres) g)     as genres,
        (select min(played_at)::text from plays)                      as first,
        (select max(played_at)::text from plays)                      as last
    `);

    const { rows: topArtists } = await db.query<TopRow>(`
      select a.name,
             count(*)::int as streams,
             round(sum(p.est_ms_played)/60000.0)::int as minutes
      from plays p
      join track_artists ta on ta.track_id = p.track_id
      join artists a on a.id = ta.artist_id
      group by a.name
      order by streams desc
      limit 5
    `);

    const { rows: topGenres } = await db.query<TopRow>(`
      select g.genre as name,
             round(sum(1.0 / cardinality(a.genres)))::int as streams,
             round(sum(p.est_ms_played / cardinality(a.genres)) / 60000.0)::int as minutes
      from plays p
      join track_artists ta on ta.track_id = p.track_id
      join artists a on a.id = ta.artist_id
      cross join lateral unnest(a.genres) g(genre)
      group by g.genre
      order by streams desc
      limit 5
    `);

    const stats: Stats = {
      plays: Number(s[0].plays),
      minutes: Number(s[0].minutes),
      artists: Number(s[0].artists),
      tracks: Number(s[0].tracks),
      genres: Number(s[0].genres),
      first: s[0].first,
      last: s[0].last,
    };

    return { stats, topArtists, topGenres };
  } catch (err) {
    console.error("[status page] database unavailable:", err);
    return null;
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-xs uppercase tracking-widest text-white/40">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-white/40">{sub}</div>}
    </div>
  );
}

const PHASES = [
  { n: 0, title: "Scaffold, env config, DB layer", done: true },
  { n: 1, title: "Schema, migrations, synthetic data generator", done: true },
  { n: 2, title: "Spotify OAuth + encrypted token storage", done: false },
  { n: 3, title: "Ingest worker + cron (start collecting history)", done: false },
  { n: 4, title: "Query engine: top artists / songs / genres / compare", done: false },
  { n: 5, title: "App shell: calendar range picker, metric toggle", done: false },
  { n: 6, title: "Tabs: Top Artists, Top Songs, Top Genres", done: false },
  { n: 7, title: "Overall Stats: comparisons + visualizations", done: false },
  { n: 8, title: "Polish: shareable cards, mobile, caching", done: false },
];

export default async function Home() {
  const data = await loadStats();
  const fmt = (n: number) => n.toLocaleString("en-US");
  const day = (s: string | null) => (s ? s.slice(0, 10) : "—");

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-400">
          Phase 0 + 1 complete
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Your own Spotify Wrapped
        </h1>
        <p className="mt-4 max-w-2xl text-white/50">
          Foundation is in place: schema, migrations, a dual-driver database layer, and a
          synthetic history generator so the interface can be built before real data accrues.
        </p>

        {data ? (
          <>
            <section className="mt-12">
              <h2 className="text-sm font-medium uppercase tracking-widest text-white/40">
                Synthetic dataset
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="Plays" value={fmt(data.stats.plays)} />
                <Stat
                  label="Listening"
                  value={fmt(Math.round(data.stats.minutes / 60)) + "h"}
                  sub={fmt(data.stats.minutes) + " minutes"}
                />
                <Stat label="Artists" value={fmt(data.stats.artists)} />
                <Stat label="Tracks" value={fmt(data.stats.tracks)} />
                <Stat label="Genres" value={fmt(data.stats.genres)} />
              </div>
              <p className="mt-3 text-xs text-white/30">
                Covering {day(data.stats.first)} → {day(data.stats.last)}, with circadian
                rhythm, weekday/weekend shapes, sessions, taste drift, skips and vacation gaps.
              </p>
            </section>

            <section className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-medium uppercase tracking-widest text-white/40">
                  Top artists
                </h3>
                <ol className="mt-4 space-y-2.5">
                  {data.topArtists.map((a, i) => (
                    <li key={a.name} className="flex items-baseline gap-3 text-sm">
                      <span className="w-4 tabular-nums text-white/30">{i + 1}</span>
                      <span className="flex-1 font-medium">{a.name}</span>
                      <span className="tabular-nums text-white/50">{fmt(a.streams)} streams</span>
                      <span className="w-20 text-right tabular-nums text-white/30">
                        {fmt(a.minutes)} min
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-medium uppercase tracking-widest text-white/40">
                  Top genres
                </h3>
                <ol className="mt-4 space-y-2.5">
                  {data.topGenres.map((g, i) => (
                    <li key={g.name} className="flex items-baseline gap-3 text-sm">
                      <span className="w-4 tabular-nums text-white/30">{i + 1}</span>
                      <span className="flex-1 font-medium">{g.name}</span>
                      <span className="tabular-nums text-white/50">{fmt(g.streams)} streams</span>
                      <span className="w-20 text-right tabular-nums text-white/30">
                        {fmt(g.minutes)} min
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 text-xs text-white/30">
                  Genre credit is fractional (1/n per artist tag), so heavily-tagged artists
                  don&apos;t dominate. Toggleable later.
                </p>
              </div>
            </section>
          </>
        ) : (
          <div className="mt-12 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-amber-200/80">
            No database yet. Run{" "}
            <code className="rounded bg-black/40 px-1.5 py-0.5">npm run db:seed</code> to
            create one and load a synthetic history.
          </div>
        )}

        <section className="mt-14">
          <h2 className="text-sm font-medium uppercase tracking-widest text-white/40">Roadmap</h2>
          <ol className="mt-4 space-y-1.5">
            {PHASES.map((p) => (
              <li key={p.n} className="flex items-center gap-3 text-sm">
                <span
                  className={
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
                    (p.done ? "bg-emerald-500 text-black" : "border border-white/15 text-white/40")
                  }
                >
                  {p.done ? "✓" : p.n}
                </span>
                <span className={p.done ? "text-white/70" : "text-white/40"}>{p.title}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
