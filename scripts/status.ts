/**
 * Connection status check.
 *
 * Answers "are we actually set?" against the database and the live Spotify API,
 * rather than against a URL parameter. Safe to run repeatedly.
 */

import { getDb } from "../src/lib/db";
import { getAccount, getAccessToken } from "../src/lib/spotify/tokens";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const ok = (m: string) => console.log(`  ${GREEN}✓${RESET} ${m}`);
const bad = (m: string, hint?: string) => {
  console.log(`  ${RED}✗${RESET} ${m}`);
  if (hint) console.log(`    ${DIM}→ ${hint}${RESET}`);
};
const warn = (m: string, hint?: string) => {
  console.log(`  ${YELLOW}!${RESET} ${m}`);
  if (hint) console.log(`    ${DIM}→ ${hint}${RESET}`);
};

async function main() {
  console.log(`\n${BOLD}Spotify Wrapped — status${RESET}\n`);
  const db = await getDb();

  // 1. Is an account stored, with usable tokens?
  console.log(`${BOLD}1. Stored account${RESET}`);
  const account = await getAccount(db);

  if (!account) {
    bad("No connected account in the database.", "Click Connect Spotify in the app.");
    await db.close();
    return;
  }

  ok(`Account: ${account.display_name ?? account.id} (${account.id})`);
  ok(`Tracking since: ${account.tracking_started_at ?? "unknown"}`);

  // 2. Do the stored tokens actually work? This is the real test.
  console.log(`\n${BOLD}2. Live API call${RESET}`);
  let tokenWorks = false;
  try {
    const token = await getAccessToken(db, account);
    const res = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const me = (await res.json()) as { display_name?: string; id: string };
      ok(`/v1/me works — authenticated as ${me.display_name ?? me.id}`);
      tokenWorks = true;
    } else if (res.status === 403) {
      bad(
        "403 — account is not on the app's allowlist.",
        "Dashboard → User Management → add your exact Spotify email.",
      );
    } else {
      bad(`/v1/me returned ${res.status}`, (await res.text()).slice(0, 200));
    }
  } catch (e) {
    bad(`Could not reach Spotify: ${(e as Error).message}`);
  }

  // 3. Can we read play history? This is what the collector depends on.
  if (tokenWorks) {
    console.log(`\n${BOLD}3. Recently-played access${RESET}`);
    try {
      const token = await getAccessToken(db, account);
      const res = await fetch(
        "https://api.spotify.com/v1/me/player/recently-played?limit=5",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const body = (await res.json()) as { items: { track: { name: string } }[] };
        ok(`Readable — Spotify is returning ${body.items.length} recent track(s).`);
        for (const it of body.items.slice(0, 3)) {
          console.log(`    ${DIM}· ${it.track.name}${RESET}`);
        }
        if (body.items.length === 0) {
          warn("No recent plays yet.", "Play something on Spotify for >30s, then re-run.");
        }
      } else {
        bad(`recently-played returned ${res.status}`, "The scope may be missing; reconnect.");
      }
    } catch (e) {
      bad(`Request failed: ${(e as Error).message}`);
    }
  }

  // 4. What has actually landed in our database so far?
  console.log(`\n${BOLD}4. Collected so far${RESET}`);
  const { rows } = await db.query<{ plays: string; minutes: string; last: string | null }>(`
    select count(*)::text                                         as plays,
           coalesce(round(sum(est_ms_played)/60000.0),0)::text     as minutes,
           max(played_at)::text                                    as last
    from plays
  `);
  const r = rows[0];
  if (Number(r.plays) === 0) {
    warn(
      "0 plays stored — normal right after connecting.",
      "Run the collector: npm run ingest",
    );
  } else {
    ok(`${r.plays} plays / ${r.minutes} minutes, most recent ${r.last}`);
  }

  console.log(
    `\n${DIM}Remember: history only accrues while the collector runs. Spotify only\n` +
      `exposes the 50 most recent plays, so a gap longer than that loses data.${RESET}\n`,
  );

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
