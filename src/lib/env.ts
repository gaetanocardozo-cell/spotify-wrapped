/**
 * Environment preflight.
 *
 * Misconfiguration should be discovered on the home page with instructions,
 * not as a cryptic failure part-way through an OAuth redirect.
 */

export interface EnvIssue {
  key: string;
  problem: string;
  fix: string;
}

/** Problems that block connecting Spotify. Empty array means good to go. */
export function checkSpotifyEnv(): EnvIssue[] {
  const issues: EnvIssue[] = [];

  if (!process.env.SPOTIFY_CLIENT_ID) {
    issues.push({
      key: "SPOTIFY_CLIENT_ID",
      problem: "not set",
      fix: "Copy it from your app at developer.spotify.com/dashboard → Settings.",
    });
  }

  if (!process.env.SPOTIFY_CLIENT_SECRET) {
    issues.push({
      key: "SPOTIFY_CLIENT_SECRET",
      problem: "not set",
      fix: "Same page — click 'View client secret'.",
    });
  }

  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    issues.push({
      key: "TOKEN_ENCRYPTION_KEY",
      problem: "not set",
      fix: "Generate one: openssl rand -base64 32",
    });
  } else if (Buffer.from(key, "base64").length !== 32) {
    issues.push({
      key: "TOKEN_ENCRYPTION_KEY",
      problem: `must decode to 32 bytes, got ${Buffer.from(key, "base64").length}`,
      fix: "Regenerate it: openssl rand -base64 32",
    });
  }

  return issues;
}

/** True when .env.local looks complete enough to attempt OAuth. */
export function spotifyConfigured(): boolean {
  return checkSpotifyEnv().length === 0;
}
