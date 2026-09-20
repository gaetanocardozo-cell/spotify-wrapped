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


---

# Troubleshooting: "I can't connect my Spotify account"

Run the diagnostic first — it checks each failure mode in the order it bites:

```bash
npm run spotify:doctor
```

It verifies your credentials against Spotify's token endpoint, probes whether the
redirect URI is registered, and prints the development-mode rules that silently
block OAuth. Nothing is printed in full: secrets are shown only as fingerprints.

## The two rules that break this for almost everyone

Spotify tightened **Development Mode** in February/March 2026. Both of these are
mandatory, and neither produces an obvious error message.

### 1. The app owner needs Spotify Premium

Development-mode apps **stop working entirely** if the owner's Premium subscription
lapses. A Free account cannot use the Web API at all. This is new as of March 2026.

### 2. You must add yourself to the app's allowlist

This is the one that catches everybody. Even as the app's creator, **your own
account is not automatically authorized.**

1. <https://developer.spotify.com/dashboard> → your app
2. **User Management** tab
3. Add your **full name** and the **exact email** on your Spotify account
4. Get that email from <https://spotify.com/account/profile> — copy it, don't type it

Changes can take **up to ~15 minutes** to take effect.

If you are not allowlisted, the consent screen appears to work, then the callback
fails with `403 User not approved for app` when the app calls `/v1/me`.

Development mode now allows a maximum of **5 users** per app.

## Other things worth checking

| Symptom | Cause |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` | The URI isn't registered, or doesn't match character for character. Check the trailing slash, the port, and `http` vs `https`. |
| Browser shows `localhost` in the URL bar | Spotify rejects `localhost`. Open `http://127.0.0.1:3000` instead. |
| `invalid_client` from the token endpoint | Wrong Client ID/Secret. If you rotated the secret, the old one died instantly. |
| Nothing changes after editing `.env.local` | Next.js reads env only at boot — **restart the dev server**. |
| Worked before, fails now | Refresh tokens now expire **6 months** after the original authorization (2026 change). Reconnect. |
| Stale consent | Remove the app at <https://spotify.com/account/apps>, clear cookies, try a private window. |

## Still stuck?

Run this and send me the output — it reveals the real error, which the browser
usually hides behind a generic redirect:

```bash
npm run spotify:doctor
```

Plus the exact URL you land on when it fails (the `error=` query parameter is the
useful part), and anything logged in the terminal running `npm run dev`.

### "localhost rejected the connection" when I click Connect Spotify

The site loads fine, but clicking Connect gives a browser connection error.

Spotify forbids `localhost` as a redirect host, so the callback always returns
to `127.0.0.1`. Browsers treat `localhost` and `127.0.0.1` as **different
origins**, so starting the flow on one and finishing on the other loses the
state cookie — and if your dev server is bound IPv4-only while the browser
resolves `localhost` to IPv6 `::1`, the connection is refused outright.

The login route now bounces you to `127.0.0.1` before the handshake begins, so
either address works. To avoid it entirely, browse to
**http://127.0.0.1:3000** rather than `http://localhost:3000`.

If it persists, confirm the dev server really is on port 3000 — plain
`next dev` silently moves to 3001 when the port is taken, which sends a
`redirect_uri` you never registered. `npm run dev` now pins `-p 3000` so a
collision fails loudly instead.

### Running in GitHub Codespaces

Codespaces does not expose the app on `127.0.0.1` from your browser's point of
view — it serves it from a forwarded-port hostname like:

    https://<codespace-name>-3000.app.github.dev

That hostname is the redirect URI Spotify will be given, so **it is the one you
must register**, in addition to (or instead of) the loopback one:

    https://<codespace-name>-3000.app.github.dev/api/auth/callback

Two extra requirements:

1. **Set the port to Public.** In the Ports panel, right-click port 3000 →
   Port Visibility → Public. If it stays Private, Spotify's redirect back lands
   on the GitHub login wall and the flow dies with the code still unexchanged.
2. **The hostname changes if the Codespace is rebuilt.** When that happens the
   old redirect URI stops matching and you must register the new one. To avoid
   re-registering, pin it instead:

       SPOTIFY_REDIRECT_URI=https://<codespace-name>-3000.app.github.dev/api/auth/callback

`npm run spotify:doctor` now detects Codespaces and prints the exact URI to
register.

---

## Going live: persistent database + continuous collection

Until both of these are done, listening history is being lost. Spotify only
exposes the **50 most recent plays**, so any gap longer than 50 plays is
unrecoverable — there is no backfill.

### Step 1 — Move off the local file database

`DATABASE_DRIVER=pglite` writes to a file inside your dev environment. In a
Codespace that disappears when the container is rebuilt. Switch to Supabase:

```bash
# .env.local
DATABASE_DRIVER=postgres
```

Then verify and create the schema:

```bash
npm run db:check     # confirms DATABASE_URL connects
npm run db:migrate   # creates the tables in Supabase
npm run spotify:status
```

`db:check` failing with `ECONNRESET` usually means the connection string is the
direct one (IPv6-only) rather than the **Session pooler** string. Copy it fresh
from Supabase → Connect → Session pooler.

Reconnect Spotify once after switching, since the tokens live in the database
you just moved away from.

### Step 2 — Deploy to Vercel

```bash
npx vercel --prod
```

Set these environment variables in the Vercel project (Settings → Environment
Variables) — they are NOT read from `.env.local`:

| Variable | Notes |
| --- | --- |
| `DATABASE_DRIVER` | `postgres` |
| `DATABASE_URL` | Supabase session-pooler string |
| `SPOTIFY_CLIENT_ID` | |
| `SPOTIFY_CLIENT_SECRET` | |
| `TOKEN_ENCRYPTION_KEY` | **Must match** whatever encrypted the stored tokens |
| `CRON_SECRET` | Protects the ingest endpoint |
| `APP_TIMEZONE` | `America/Bogota` |

Then add the production redirect URI in the Spotify dashboard:

    https://<your-app>.vercel.app/api/auth/callback

and click **Connect Spotify** once on the deployed site.

### Step 3 — Schedule collection every 15 minutes

Vercel's **Hobby plan rejects any cron more frequent than once per day** — the
deploy fails outright with "Hobby accounts are limited to daily Cron Jobs". A
daily poll is not enough: more than 50 plays in a day means permanent loss.

So `vercel.json` keeps a daily run as a safety net, and the real cadence comes
from the GitHub Actions workflow in `.github/workflows/collect.yml`, which calls
the same endpoint every 15 minutes for free.

Add two repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `INGEST_URL` | `https://<your-app>.vercel.app/api/cron/ingest` |
| `CRON_SECRET` | Same value as the Vercel env var |

Then run it once manually from the **Actions** tab (**Collect listening
history** → Run workflow) to confirm it returns HTTP 200 rather than 401
(wrong secret) or 428 (Spotify not connected on the deployment).

> GitHub delays or drops scheduled runs when its infrastructure is busy, so
> treat 15 minutes as approximate. If you are a heavy listener, Vercel Pro's
> per-minute cron is the more reliable option.
