/**
 * Run the collector once, from the command line.
 *
 * Same work as the cron endpoint, but without needing the dev server up or the
 * CRON_SECRET to hand. Useful for an immediate first collection right after
 * connecting, and for topping up history while developing.
 */

import { getDb } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";
import { finishSyncRun, ingestRecentlyPlayed, startSyncRun } from "../src/lib/ingest/ingest";
import { getAccessToken, getAccount } from "../src/lib/spotify/tokens";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function main() {
  const db = await getDb();
  await migrate(db, false);

  const account = await getAccount(db);
  if (!account?.refresh_token) {
    console.error(`${RED}No connected Spotify account.${RESET}`);
    console.error(`${DIM}Start the app and click Connect Spotify first.${RESET}`);
    await db.close();
    process.exit(1);
  }

  const runId = await startSyncRun(db, account.id);
  try {
    const accessToken = await getAccessToken(db, account);
    const result = await ingestRecentlyPlayed(db, account.id, accessToken);
    await finishSyncRun(db, runId, { rows: result.playsInserted });

    console.log(
      `${GREEN}✓${RESET} fetched ${result.playsFetched}, inserted ${result.playsInserted} new` +
        `, enriched ${result.artistsEnriched} artist(s)`,
    );
    if (result.firstPlayAt && result.lastPlayAt) {
      console.log(
        `${DIM}  window ${result.firstPlayAt.toISOString()} → ${result.lastPlayAt.toISOString()}${RESET}`,
      );
    }
    // Spotify only exposes the 50 most recent plays; a full page means older
    // ones may already have aged out unrecoverably.
    if (result.saturated) {
      console.log(
        `${YELLOW}!${RESET} Full 50-item page — plays may have been missed. Poll more often.`,
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishSyncRun(db, runId, { error: message });
    console.error(`${RED}✗ Ingest failed:${RESET} ${message}`);
    await db.close();
    process.exit(1);
  }

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
