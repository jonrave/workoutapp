# Restore the Oura readiness-gate sync

The scheduled job needs three **repository Actions secrets** and a one-time
Oura authorization stored in the **same PostgreSQL database**. Adding the client
ID and secret alone does not create an authorized token pair. Vercel environment
variables are separate from GitHub Actions secrets.

## Before enabling the schedule

The workflow commits `data/oura/gate_current.md` and `data/oura/gate_series.csv`
to this repository. They contain personal sleep, HRV, resting-heart-rate,
temperature, and readiness data. If the repository is public, so are these files
and their Git history. Make the repository private before adding secrets unless
that publication is intentional. The web app also needs access protection before
using real data; its current routes have no application authentication.

## 1. Choose the persistent database

Reuse the workoutapp production PostgreSQL database if the web app should see
the ingested events. Obtain its connection string directly from the database
provider or your Vercel project configuration. If no database is attached, create
one in your chosen provider and attach it to the app first.

- `DATABASE_URL` must connect from both your computer (one-time authorization)
  and GitHub-hosted runners. Keep the provider's TLS settings in the URL.
- Use the provider's pooled PostgreSQL URL if it is also used by the web app.
- The existing stores run idempotent migrations on first use. The database role
  must be able to run that schema initialization. Alternatively, run migrations
  `001_init.sql` and `003_oura_credentials.sql` as the database owner first and
  verify the runtime role can execute the stores' initialization statements.
- Event ingestion needs SELECT and INSERT on `events` and the existing event-log
  schema. Token rotation needs SELECT, INSERT, and UPDATE on `oura_credentials`.
  Migration 003 does not grant access to a separately created application role;
  the database owner must grant those table permissions if using one.
- Never grant UPDATE or DELETE on the event log or pre-registered thresholds to
  solve a credential-table permission problem. They are separate tables.

The auth helper checks credential-table access before opening browser consent.
Do not put `DATABASE_URL`, passwords, OAuth codes, or tokens in an issue or chat.

## 2. Register or reuse your Oura OAuth application

Open [Oura API applications](https://cloud.ouraring.com/oauth/applications).
Register the exact redirect URI:

```text
http://localhost:8484/callback
```

Use the authorization-code flow and allow the **daily** scope. The gate reads
`sleep` and `daily_readiness`; it does not need email, personal profile, or
heart-rate time-series access. The helper sends a random state and validates the
callback before exchanging the code. Oura's
[authentication documentation](https://cloud.ouraring.com/docs/authentication)
describes the exact-match redirect requirement and single-use refresh tokens.

## 3. Authorize locally without printing secrets

Run on the computer whose browser you will use, with Node.js 22 or newer. A
localhost callback in a remote terminal will not reach your own computer.

```bash
git clone https://github.com/jonrave/workoutapp.git
cd workoutapp
npm ci
cp .env.oura.example .env.oura.local
```

For an existing checkout, update it to the setup-fix branch or merged `main`
instead of cloning again. In PowerShell, `Copy-Item` can replace `cp`.

Open `.env.oura.local` in a local editor and fill only these three keys:

```dotenv
OURA_CLIENT_ID=
OURA_CLIENT_SECRET=
DATABASE_URL=
```

Keep the file private. It is ignored by Git. Do not paste the completed file or
screenshots of it into chat. These scripts do not automatically load Next.js
`.env.local`; load this file explicitly:

```bash
node --env-file=.env.oura.local --import tsx scripts/oura-auth-helper.ts
```

Open the printed consent URL locally and approve daily access for your own Oura
account. The helper saves the access token, refresh token, and expiry in the
single `oura_credentials` row (`id = 1`). It reports success without printing
the token pair. Keep the terminal open until it finishes.

Do not run another authorization helper or sync concurrently with this initial
seed. Scheduled runs already share an Actions concurrency group. That group
does not serialize manual local processes.

## 4. Add the repository Actions secrets

In [workoutapp Actions secrets](https://github.com/jonrave/workoutapp/settings/secrets/actions),
create **repository secrets**, not Actions variables or environment-only secrets:

| Secret | Value source |
| --- | --- |
| `OURA_CLIENT_ID` | Your registered Oura application's client ID |
| `OURA_CLIENT_SECRET` | That same application's client secret |
| `DATABASE_URL` | The same database connection string used in step 3 |

The workflow has no `environment:` selection, so environment-only secrets are
not supplied to this job. Leave `OURA_TOKEN` unset when using OAuth: it takes
precedence and bypasses refresh rotation. Do not copy refresh or access tokens
into Actions secrets; those belong in PostgreSQL.

If you have an authenticated GitHub CLI locally, the equivalent is:

```bash
gh secret set --repo jonrave/workoutapp --env-file .env.oura.local
gh secret list --repo jonrave/workoutapp
```

The first command reads the local file and encrypts the values before uploading;
the second lists names and metadata, not values. Check that the file contains
only the three intended keys. Delete the local file when setup is finished, or
retain it only in your normal protected local secret storage.

## 5. Verify the current main workflow

Sync the Oura phone app first. Open
[Oura gate sync](https://github.com/jonrave/workoutapp/actions/workflows/oura-gate-sync.yml)
and choose **Run workflow**, branch **main**. Alternatively:

```bash
gh workflow run oura-gate-sync.yml --repo jonrave/workoutapp --ref main
```

A rerun of an old failed run uses its original commit, not the updated script.
Verify the new run's commit before interpreting its logs.

A successful current run must show all of these:

1. Oura records retrieved from `sleep` and `daily_readiness`, with no auth error.
2. Event ingestion completed. A repeat run may append zero events legitimately.
3. Both artifact files written; `gate_current.md` has a fresh `generated_at`,
   14 daily rows, and a truthful latest-data date. The CSV has 180 daily rows plus
   its header. A fresh generation timestamp alone does not mean fresh ring data.
4. The commit/push step succeeds and the updated files exist on `main`.

Run it a second time after the first finishes to check repeatability and
idempotence. Two immediate runs do **not** prove a refresh occurred if the token
is still fresh. The unit/integration tests simulate expiry and two single-use
refresh rotations. Confirm live rotation after expiry by checking only expiry
and update metadata in the database, never by printing token values:

```sql
SELECT id, expires_at, updated_at,
       length(access_token) > 0 AS has_access_token,
       length(refresh_token) > 0 AS has_refresh_token
FROM oura_credentials WHERE id = 1;
```

## Distinguish failures

| Failure | What it establishes |
| --- | --- |
| Missing configuration | Values were not supplied to this process; no Oura request occurred. |
| No stored Oura credentials | The database is reachable, but this store has not been authorized. Check that authorization and Actions use the same database. |
| Database connection/permission error | Resolve database access, TLS, schema, or role grants before retrying consent. |
| Token endpoint 400/401 | Check the OAuth app credentials and whether the refresh token needs reauthorization. The HTTP code alone does not identify which is wrong. |
| Data endpoint 401/403 | Check token validity, granted daily access, and Oura account access. |
| Zero records | Authentication alone is insufficient. Check the selected account, consent, and phone sync. Prior artifacts are retained. |
| Git push failure | Ingestion may have succeeded. Check branch rules and Actions write permission; this is separate from Oura authentication. |

The web app's `/api/sync` route currently supports `OURA_TOKEN` only. These OAuth
steps restore the scheduled readiness-gate script, not that separate button or
route. Ingested events still reach the web app when it uses the same database.
