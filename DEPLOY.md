# Deploying to Vercel

The app is a stock Next.js project inside an npm-workspaces monorepo. Two
settings and one env var are all it needs.

## 1. Import the repo

In the Vercel dashboard: **Add New → Project → Import** `jonrave/workoutapp`,
and pick the branch you want (`claude/type-defs-test-fixtures-8m4aq7`, or
`main` once it is merged).

## 2. Set the root directory

**Root Directory: `apps/web`** — recommended. Leave "Include files outside the
root directory" **on**; the app imports `packages/*` and the subject fixture
from the repo root.

If you leave Root Directory at the default (`./`), the repo-root `vercel.json`
now covers you: it declares `framework: nextjs`, builds the web workspace, and
points at `apps/web/.next`. Either configuration deploys.

### Why this setting bites

Before that `vercel.json` existed, a default Root Directory produced a **404 on
every path with no failed build**. The repo root has no `next.config`, no
`build` script, and no `index.html`, so Vercel detected no framework, had
nothing to build, and published an empty output directory. An empty deployment
is a *successful* deployment that serves nothing — which is why the dashboard
showed green while every URL returned `NOT_FOUND`.

That is the signature to remember: **404 on every path, including `/`, with a
green build, means the deployment is empty — not that routing is broken.**

## 3. Attach Postgres

Without a database the app runs in demo mode: the event log is in memory, so on
serverless **nothing you log persists** — each request may hit a fresh
instance. The app says so in a banner rather than silently losing writes.

1. **Storage → Create Database → Postgres** (Neon and Supabase both work; any
   Postgres does).
2. Vercel injects `DATABASE_URL` automatically for its own integration; for an
   external database add it under **Settings → Environment Variables**.

That's it — the app migrates itself. On first touch of the database it runs
the idempotent schema (embedded in `packages/store/src/postgres.ts` and kept
in sync with `packages/store/migrations/001_init.sql` by a test): the
append-only `events` table and the INSERT-only `pre_registered_thresholds`
table, revoking `UPDATE`/`DELETE` from the `peakspan_app` role if that role
exists (I10: a registered threshold can never be edited after the fact).
Running the migration manually with `psql` still works and is equivalent.

**Use a pooled connection string.** Serverless functions open many short-lived
connections; Neon's pooler endpoint or Supabase's `6543` pooler port avoids
exhausting the server's connection limit. A direct connection will work in
testing and fall over under real traffic.

## 4. Optional: free-text parsing

Add `ANTHROPIC_API_KEY` to use the Claude-backed activity parser. Without it
the deterministic keyword stub runs instead, so the confirm-before-log flow
still works offline — the LLM is never in the decision path either way (I2).

## 5. Optional: device sync (Oura + Strava)

With these set, the Log page grows a **Sync last 30 days** button and
`POST /api/sync` pulls raw signals into the event log. Only raw signals cross
the boundary — Oura Readiness and Strava Relative Effort are never imported
(I4). Pulls are idempotent (deterministic event ids), so syncing overlapping
windows never duplicates anything.

**Oura** — nightly HRV (rMSSD), resting HR, sleep duration and midpoint:

1. Log in at `cloud.ouraring.com` → **Personal Access Tokens** → create one.
2. Set `OURA_TOKEN=<token>`.

**Strava** — runs, rides, hikes as classified activities:

1. `strava.com/settings/api` → create an API application → note the
   **Client ID** and **Client Secret**.
2. Authorize your own app once to get a refresh token with `activity:read`
   scope (Strava's "Getting Started" OAuth flow; a one-time browser + curl
   dance).
3. Set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`.

To sync on a schedule instead of on demand, point a Vercel cron job at
`POST /api/sync` (e.g. daily at 07:00).

No tokens? The client-side app (and this one) also accept **export files**:
Oura's trends CSV / API JSON and Strava's `activities.csv` bulk export can be
dropped into the Sync tab and are parsed entirely in the browser.

## What deploys

| Route | Notes |
|---|---|
| `/today` | Server-rendered per request (`force-dynamic`) — the decision is computed from the log on every load. |
| `/log`, `/levers`, `/plan`, `/blocks`, `/trends`, `/onboarding` | Same. |
| `/api/events`, `/api/blocks`, `/api/parse`, `/api/decision` | Serverless functions. |

No route is statically cached, because every page is a function of the current
event log and today's date.

## Known limits of a demo deployment

- **Single user.** There is no auth and no per-user scoping; the event log is
  global. Do not put real personal health data on a public URL.
- **Profile and standing plan come from the seed fixture,** not the event log —
  editing them needs a `ProfileUpdatedEvent` that does not exist yet.
