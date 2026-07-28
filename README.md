# Peakspan

A training-decision system built to the contract in [CLAUDE.md](./CLAUDE.md):
maximize lifelong trainable capacity without ever sustaining a training-ending
event. The engine is a pure function; most weeks its answer is "do the planned
session," and the UI treats that as the success state it is.

## Layout

| Path | Contract step | What it is |
|---|---|---|
| `CLAUDE.md` | — | The build contract. It wins over priors. |
| `packages/engine` | Steps 1, 3 | Pure `decide(state, date) -> Decision`. Zero runtime deps. All tunables in `src/constants.ts`, each marked convention or evidence. |
| `fixtures/` | Step 2 | Subject A plus 37 user-approved scenarios (`scenarios.md` human-readable, `scenarios.json` machine-checkable). The engine's test suite runs all of them. |
| `packages/adapters` | Step 4 | Manual entry, guided protocols (CMJ median-of-5, home-BP 7-day), Oura raw-signals-only mapping, and free-text parsing behind an interface (drafts require confirmation; the Claude parser is an optional separate export). |
| `packages/store` | Step 5 | Append-only event log (in-memory + Postgres) and the state projector. State is recomputable from the log; pre-registered thresholds are immutable. |
| `apps/web` | Step 6 | Thin Next.js UI: Today (decision + why), Log, Levers, Plan, Blocks (registration refuses ill-posed thresholds), Trends (SDC bands on every chart), Intake. |

## Run

```sh
npm install
npm test                      # 78 tests incl. all 37 scenario fixtures
cd apps/web && npx next dev   # demo seeded from fixtures/subjects/subject-a.json
```

Set `DATABASE_URL` for Postgres persistence (`packages/store/migrations/`), and
`ANTHROPIC_API_KEY` to use the Claude-backed activity parser instead of the
offline stub.
