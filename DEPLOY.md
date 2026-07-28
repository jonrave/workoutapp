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
3. Run the migration once against that database:

   ```sh
   psql "$DATABASE_URL" -f packages/store/migrations/001_init.sql
   ```

   It creates the append-only `events` table and the INSERT-only
   `pre_registered_thresholds` table, and revokes `UPDATE`/`DELETE` from the
   `peakspan_app` role if that role exists (I10: a registered threshold can
   never be edited after the fact).

**Use a pooled connection string.** Serverless functions open many short-lived
connections; Neon's pooler endpoint or Supabase's `6543` pooler port avoids
exhausting the server's connection limit. A direct connection will work in
testing and fall over under real traffic.

## 4. Optional: free-text parsing

Add `ANTHROPIC_API_KEY` to use the Claude-backed activity parser. Without it
the deterministic keyword stub runs instead, so the confirm-before-log flow
still works offline — the LLM is never in the decision path either way (I2).

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
