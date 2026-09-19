import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { createMemoryDb, type Db } from "../db";
import { migrate } from "../db/migrate";
import { encrypt, decrypt } from "../crypto";
import { createFakeSpotify, sampleCatalog } from "./fixtures";
import { getAccessToken, getAccount, saveTokens } from "./tokens";

const USER = "test-user";
const { artists, tracks } = sampleCatalog();

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SPOTIFY_CLIENT_ID = "client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
});

async function dbWithAccount(fields: Record<string, unknown> = {}): Promise<Db> {
  const db = await createMemoryDb();
  await migrate(db, false);
  await db.query(
    `insert into spotify_accounts (id, display_name, refresh_token, access_token, token_expires_at)
     values ($1,$2,$3,$4,$5)`,
    [
      USER,
      "Test",
      fields.refresh_token ?? encrypt("stored-refresh-token"),
      fields.access_token ?? null,
      fields.token_expires_at ?? null,
    ],
  );
  return db;
}

describe("token lifecycle", () => {
  let api: ReturnType<typeof createFakeSpotify>;
  beforeEach(() => {
    api = createFakeSpotify({ artists, tracks, plays: [] });
  });

  it("reuses a still-valid access token without hitting the network", async () => {
    const db = await dbWithAccount({
      access_token: "valid-token",
      token_expires_at: new Date(Date.now() + 60 * 60_000),
    });
    const account = (await getAccount(db))!;
    const token = await getAccessToken(db, account, api.fetch);

    expect(token).toBe("valid-token");
    expect(api.callCount("/api/token")).toBe(0);
  });

  it("refreshes when the token is expired", async () => {
    const db = await dbWithAccount({
      access_token: "stale-token",
      token_expires_at: new Date(Date.now() - 60_000),
    });
    const account = (await getAccount(db))!;
    const token = await getAccessToken(db, account, api.fetch);

    expect(token).toBe("fresh-access-token");
    expect(api.callCount("/api/token")).toBe(1);
  });

  it("refreshes early, inside the safety margin", async () => {
    // Two minutes left is within the 5-minute margin, so it should refresh
    // rather than risk expiring mid-run.
    const db = await dbWithAccount({
      access_token: "about-to-expire",
      token_expires_at: new Date(Date.now() + 2 * 60_000),
    });
    const account = (await getAccount(db))!;
    expect(await getAccessToken(db, account, api.fetch)).toBe("fresh-access-token");
  });

  it("persists a rotated refresh token", async () => {
    const db = await dbWithAccount({ token_expires_at: new Date(Date.now() - 1000) });
    const account = (await getAccount(db))!;
    await getAccessToken(db, account, api.fetch);

    const { rows } = await db.query<{ refresh_token: string }>(
      `select refresh_token from spotify_accounts where id = $1`,
      [USER],
    );
    // Spotify may rotate it; dropping the new one would eventually break auth.
    expect(decrypt(rows[0].refresh_token)).toBe("rotated-refresh-token");
  });

  it("stores refresh tokens encrypted, never in plaintext", async () => {
    const db = await dbWithAccount();
    await saveTokens(db, USER, {
      access_token: "a",
      expires_in: 3600,
      refresh_token: "super-secret-value",
    });

    const { rows } = await db.query<{ refresh_token: string }>(
      `select refresh_token from spotify_accounts where id = $1`,
      [USER],
    );
    expect(rows[0].refresh_token).not.toContain("super-secret-value");
    expect(decrypt(rows[0].refresh_token)).toBe("super-secret-value");
  });

  it("gives an actionable error when the account was never connected", async () => {
    const db = await createMemoryDb();
    await migrate(db, false);
    await db.query(`insert into spotify_accounts (id, display_name) values ($1,'x')`, [USER]);
    const account = (await getAccount(db))!;

    await expect(getAccessToken(db, account, api.fetch)).rejects.toThrow(/auth\/login/);
  });
});
