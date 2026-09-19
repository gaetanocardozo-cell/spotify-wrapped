# Setup — what you need to do

Two accounts to configure: **Spotify** (for API access) and **Supabase** (for the
database). Should take about 10 minutes. At the end you'll paste four values to me.

---

## Part 1 — Spotify app

### 1. Create the app

Go to <https://developer.spotify.com/dashboard> → log in → **Create app**.

| Field | Value |
|---|---|
| App name | `Wrapped` (anything) |
| App description | `Personal listening analytics` |
| Website | leave blank |
| **Redirect URIs** | see below — **this is the part people get wrong** |
| Which API/SDKs | tick **Web API** only |

### 2. Redirect URIs — read this carefully

Spotify tightened these rules in the November 2025 OAuth migration. Two hard rules:

- **`localhost` is rejected.** You must use the literal IP `127.0.0.1`.
- **HTTP is only allowed for loopback addresses.** Everything else must be HTTPS.

Add **both** of these, one at a time, clicking *Add* after each:

```
http://127.0.0.1:3000/api/auth/callback
https://3000-iwh9ryu6hojrbccrpgmiv.e2b.app/api/auth/callback
```

The first is for running on your own machine. The second is this sandbox's live preview,
so we can test the real OAuth flow together before you deploy anything.

> **Note:** the sandbox URL contains a session ID that changes if the sandbox is ever
> recreated. If OAuth suddenly fails with `INVALID_CLIENT: Invalid redirect URI`, tell me
> and I'll give you the new URL to add. You can register several — Spotify allows a list.

Later, when we deploy to Vercel, you'll add a third:
`https://<your-app>.vercel.app/api/auth/callback`

### 3. Copy the credentials

Open the app → **Settings**. You'll need:

- **Client ID** — shown directly
- **Client secret** — click *View client secret*

### 4. Do NOT request a quota extension

The dashboard may nudge you toward "extended quota mode". **Ignore it.** Development mode
allows up to 25 users, which is plenty, and extension requires a review process you don't
need. You *are* the user.

---

## Part 2 — Supabase

### 1. Create the project

<https://supabase.com/dashboard> → **New project**.

- **Region:** pick the closest one to you — `South America (São Paulo)` is nearest Bogotá.
- **Database password:** generate a strong one and save it; it goes in the connection string.

### 2. Get the connection string

**Project Settings → Database → Connection string → URI**, then:

- Choose the **Session pooler** tab (port `5432`), not "Direct connection". Direct
  connections are IPv6-only on the free tier and fail from most hosts, including Vercel.
- Copy the URI and **replace `[YOUR-PASSWORD]`** with the password from step 1.

It should look like:

```
postgresql://postgres.abcdefghijklm:YOURPASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

### 3. Don't paste any SQL

You guessed I'd hand you SQL to run — but I've set up versioned migrations instead, so
`npm run db:migrate` applies the schema for you and tracks what's already been applied in
a `schema_migrations` table. That way the schema stays in Git and in sync as we add to it,
rather than drifting from whatever got pasted into the SQL editor.

If you'd rather run it by hand the first time, the file is
`supabase/migrations/0001_init.sql` — paste it into the Supabase SQL editor. But the
migrate command is the better habit.

---

## Part 3 — Send me these four values

```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
DATABASE_URL=
```

Plus confirm which redirect URIs you registered.

I'll generate `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` myself — no need for you to make those.

### A note on secrets

`.env.local` is gitignored, so nothing you send lands in the repo. That said, a client
secret and DB password in chat is still a real secret in a place you don't fully control.
Your call, and both are rotatable at any time:

- Spotify: Settings → *Rotate client secret*
- Supabase: Settings → Database → *Reset database password*

If you'd rather not paste them, an alternative: create `.env.local` yourself with the
values, tell me it's done, and I'll write code against the variable names without ever
seeing them. Slightly slower to debug, but nothing sensitive leaves your hands.

---

## Scopes I'll request

When you first authorize, Spotify will ask you to approve these:

| Scope | Why |
|---|---|
| `user-read-recently-played` | **The whole point** — the play history we accumulate |
| `user-top-read` | The three fixed `top/*` windows, for the pre-tracking estimate |
| `user-read-private` | Your display name and country |

Read-only. Nothing that can modify your account, playlists, or playback.

---

## What happens next

1. You send the values (or confirm `.env.local` exists).
2. I build Phase 2 (OAuth) and Phase 3 (the collector).
3. You click "Connect Spotify" once in the live preview.
4. **The collector starts banking your listening history from that moment.**
5. We build the calendar and all four tabs on top, against synthetic data, while your real
   dataset grows underneath.

Step 4 is the one that matters today. Everything else we can build at any time; history
only accumulates once the collector is live — so the sooner it's running, the further back
your first real Wrapped will reach.

---

# Running the collector (do this next)

The Arena sandbox cannot reach Spotify or Supabase (its egress is allowlisted to
package registries), so the one-time connect must happen on your machine.

```bash
git pull
npm install
```

### 1. Create `.env.local`

It is gitignored, so it does not travel with the repo. Copy `.env.example` and fill in:

```bash
DATABASE_DRIVER=postgres
DATABASE_URL=<your session pooler string>

SPOTIFY_CLIENT_ID=<from the dashboard>
SPOTIFY_CLIENT_SECRET=<from the dashboard>

APP_TIMEZONE=America/Bogota
TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
CRON_SECRET=<openssl rand -hex 32>
```

### 2. Verify the database, then migrate

```bash
npm run db:check     # confirms the connection string actually works
npm run db:migrate   # creates the schema in Supabase
```

### 3. Connect Spotify

```bash
npm run dev
```

Open **http://127.0.0.1:3000** — not `localhost`, which Spotify rejects — and click
**Connect Spotify**. From this moment your listening history starts accumulating.

### 4. Confirm collection works

```bash
curl "http://127.0.0.1:3000/api/cron/ingest?secret=$CRON_SECRET"
```

Expect `{"ok":true,"playsFetched":N,...}`. Play something on Spotify for 30+ seconds,
wait a minute, and run it again — `playsInserted` should increase.

A `"warning"` about a saturated page means the 50-item ceiling was hit and some plays
were missed; poll more frequently.

### 5. Deploy so it runs without your laptop

Import the repo on Vercel, set the same environment variables, and add
`https://<your-app>.vercel.app/api/auth/callback` to the Spotify app's redirect URIs.
`vercel.json` already schedules the collector every 15 minutes.

You will need to click **Connect Spotify** once on the deployed URL too, since the
encrypted refresh token is tied to the redirect URI it was issued for.
