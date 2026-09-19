/**
 * Database layer.
 *
 * Two drivers, one SQL dialect:
 *   - PGlite  (real Postgres compiled to WASM) for local dev / tests / CI
 *   - postgres.js against Supabase Postgres in production
 *
 * Selected by DATABASE_DRIVER ("pglite" | "postgres"). Because PGlite *is*
 * Postgres, migrations and queries are byte-identical across both.
 */

export type QueryResult<T> = { rows: T[] };

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

let cached: Promise<Db> | null = null;

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  // A directory path persists between runs; omit for pure in-memory.
  const dir = process.env.PGLITE_DATA_DIR ?? ".pglite";
  const pg = new PGlite(dir);
  await pg.waitReady;
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query<T>(text, params as never[]);
      return { rows: res.rows as T[] };
    },
    async exec(text: string) {
      await pg.exec(text);
    },
    async close() {
      await pg.close();
    },
  };
}

async function createPostgres(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required when DATABASE_DRIVER=postgres");
  const { default: postgres } = await import("postgres");
  // Supabase poolers don't support prepared statements; disable them.
  const sql = postgres(url, { prepare: false, max: 5 });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as never[]);
      return { rows: rows as unknown as T[] };
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
    async close() {
      await sql.end();
    },
  };
}

export function getDb(): Promise<Db> {
  if (!cached) {
    const driver = process.env.DATABASE_DRIVER ?? "pglite";
    cached = driver === "postgres" ? createPostgres() : createPglite();
  }
  return cached;
}

/** Test/CLI helper: a throwaway in-memory database with migrations applied. */
export async function createMemoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.waitReady;
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query<T>(text, params as never[]);
      return { rows: res.rows as T[] };
    },
    async exec(text: string) {
      await pg.exec(text);
    },
    async close() {
      await pg.close();
    },
  };
}
