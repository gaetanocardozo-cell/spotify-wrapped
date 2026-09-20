/**
 * Remove the synthetic seed data, keeping real collected history.
 *
 * Phase 1 seeded ~10k plays under 'demo-user' so the UI had something to render
 * before any real data existed. Once a real account is connected that data is
 * actively misleading, because the dashboards would blend it with yours.
 *
 * Deletes plays for every user_id that is not a connected Spotify account, plus
 * the demo account row. Catalog rows (tracks/artists) are left alone: they are
 * shared, harmless, and re-referenced if the same music is played for real.
 */

import { getDb } from "../src/lib/db";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function main() {
  const db = await getDb();

  // Anything not backed by a real stored token is synthetic by definition.
  const { rows: before } = await db.query<{ user_id: string; n: string }>(
    `select p.user_id, count(*)::text as n
       from plays p
      where p.user_id not in (
              select id from spotify_accounts where refresh_token is not null
            )
      group by p.user_id`,
  );

  if (before.length === 0) {
    console.log(`${GREEN}✓${RESET} No synthetic plays found — nothing to clear.`);
    await db.close();
    return;
  }

  for (const r of before) {
    console.log(`${DIM}  removing ${r.n} plays under '${r.user_id}'${RESET}`);
  }

  await db.query(
    `delete from plays
      where user_id not in (
              select id from spotify_accounts where refresh_token is not null
            )`,
  );

  // Drop the placeholder account rows too, so /me-style queries stay clean.
  await db.query(`delete from spotify_accounts where refresh_token is null`);

  const { rows: after } = await db.query<{ n: string }>(`select count(*)::text as n from plays`);
  console.log(`${GREEN}✓${RESET} Done. ${after[0].n} real plays remain.`);

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
