/**
 * Access-token lifecycle.
 *
 * Access tokens last an hour; refresh tokens are effectively permanent. We
 * store the refresh token encrypted, and mint access tokens on demand with a
 * safety margin so a token can't expire mid-run.
 *
 * Spotify occasionally issues a *new* refresh token during a refresh. If we
 * ignored it the old one could eventually be invalidated and the collector
 * would silently stop, so we always persist it when present.
 */

import type { Db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { refreshAccessToken, type FetchLike } from "./client";

/** Refresh this long before actual expiry. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

export interface AccountRow {
  id: string;
  display_name: string | null;
  refresh_token: string | null;
  access_token: string | null;
  token_expires_at: Date | string | null;
  tracking_started_at: Date | string | null;
}

export async function getAccount(db: Db, userId?: string): Promise<AccountRow | null> {
  const { rows } = userId
    ? await db.query<AccountRow>(`select * from spotify_accounts where id = $1`, [userId])
    : await db.query<AccountRow>(`select * from spotify_accounts order by created_at limit 1`);
  return rows[0] ?? null;
}

export async function saveTokens(
  db: Db,
  userId: string,
  tokens: { access_token: string; expires_in: number; refresh_token?: string; scope?: string },
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  if (tokens.refresh_token) {
    await db.query(
      `update spotify_accounts
         set access_token = $2, token_expires_at = $3,
             refresh_token = $4, scopes = coalesce($5, scopes), updated_at = now()
       where id = $1`,
      [userId, tokens.access_token, expiresAt, encrypt(tokens.refresh_token), tokens.scope ?? null],
    );
  } else {
    await db.query(
      `update spotify_accounts
         set access_token = $2, token_expires_at = $3, updated_at = now()
       where id = $1`,
      [userId, tokens.access_token, expiresAt],
    );
  }
}

/**
 * Returns a valid access token, refreshing if needed. Throws a clear error if
 * the account was never connected.
 */
export async function getAccessToken(
  db: Db,
  account: AccountRow,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const stillValid = account.access_token && expiresAt - EXPIRY_MARGIN_MS > Date.now();
  if (stillValid) return account.access_token!;

  if (!account.refresh_token) {
    throw new Error(
      `Account ${account.id} has no refresh token. Visit /api/auth/login to connect Spotify.`,
    );
  }

  const tokens = await refreshAccessToken(decrypt(account.refresh_token), fetchImpl);
  await saveTokens(db, account.id, tokens);
  return tokens.access_token;
}
