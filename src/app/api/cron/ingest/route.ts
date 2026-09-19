import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { migrate } from "@/lib/db/migrate";
import { finishSyncRun, ingestRecentlyPlayed, startSyncRun } from "@/lib/ingest/ingest";
import { getAccessToken, getAccount } from "@/lib/spotify/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The collector endpoint. Invoked by Vercel Cron (see vercel.json) or manually.
 *
 * Protected by CRON_SECRET: either `Authorization: Bearer <secret>` (what
 * Vercel Cron sends) or `?secret=` for convenient manual runs.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(request.url);
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const provided = bearer ?? url.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const db = await getDb();
  await migrate(db, false);

  const account = await getAccount(db);
  // 428 Precondition Required: the operator must connect Spotify first. This
  // is a setup state, not a server fault, so don't report it as a 500.
  if (!account || !account.refresh_token) {
    return NextResponse.json(
      {
        ok: false,
        error: "No Spotify account connected. Visit /api/auth/login first.",
        connected: false,
      },
      { status: 428 },
    );
  }

  const runId = await startSyncRun(db, account.id);
  try {
    const accessToken = await getAccessToken(db, account);
    const result = await ingestRecentlyPlayed(db, account.id, accessToken);
    await finishSyncRun(db, runId, { rows: result.playsInserted });

    return NextResponse.json({
      ok: true,
      ...result,
      // A saturated page means the 50-item ceiling may have hidden older
      // plays: they are unrecoverable, so poll more often.
      warning: result.saturated
        ? "Fetched a full 50-item page; plays may have been missed. Increase poll frequency."
        : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishSyncRun(db, runId, { error: message });
    console.error("[cron/ingest]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
