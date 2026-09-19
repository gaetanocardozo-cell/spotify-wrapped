/**
 * Verifies DATABASE_URL actually connects, and reports what it found.
 * Run this on your own machine:  npm run db:check
 *
 * (It cannot be run from the Arena sandbox: outbound network there is
 * allowlisted to npm/GitHub, so Supabase and Spotify are unreachable.)
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local");
  process.exit(1);
}

const redacted = url.replace(/:([^:@/]+)@/, ":****@");
console.log(`Connecting to ${redacted}\n`);

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });

try {
  const [info] = await sql`
    select current_user as "user",
           current_database() as db,
           version() as version,
           current_setting('server_version_num')::int as version_num
  `;
  console.log("  connected");
  console.log(`  user:     ${info.user}`);
  console.log(`  database: ${info.db}`);
  console.log(`  server:   ${String(info.version).split(" on ")[0]}`);

  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from information_schema.tables where table_schema = 'public'
  `;
  console.log(`  public tables: ${count}`);
  console.log("\nLooks good. Next: DATABASE_DRIVER=postgres npm run db:migrate");
} catch (e) {
  const msg = (e as Error).message;
  console.error(`  FAILED: ${msg}\n`);
  if (/ECONNRESET/.test(msg)) {
    console.error("  ECONNRESET usually means the pooler rejected the tenant:");
    console.error("   - wrong region in the hostname, or");
    console.error("   - username must be postgres.<project-ref>, not plain postgres, or");
    console.error("   - the project is paused (free tier pauses after ~1 week idle).");
    console.error("  Copy the string fresh from Dashboard -> Connect -> Session pooler.");
  } else if (/password authentication failed/.test(msg)) {
    console.error("  Wrong password. Settings -> Database -> Reset database password.");
  } else if (/ENOTFOUND/.test(msg)) {
    console.error("  Hostname does not resolve. Check the region portion of the host.");
  }
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 }).catch(() => {});
}
