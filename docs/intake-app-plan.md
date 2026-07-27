# Intake & App Plan (Steps 4–6)

Plan only. Implementation is gated behind Step 3 (engine), which is gated on the
expected-decision column of `fixtures/scenarios.md` being authored by the user.
Contract section 10 ordering is preserved: engine → adapters → persistence → UI.

## Governing principle

**The user inputs facts and raw readings, never derived state.** Every field in
`UserState` is either:

1. **Declared** — profile, equipment, constraints, standing plan, thresholds.
   Entered once in intake, edited rarely.
2. **Logged** — activities, pain/soreness, illness, measurements, lever values.
   Entered as they happen, each becoming one `EngineEvent` in the append-only log.
3. **Derived** — `hrv7d`, baselines and SDs, acute/chronic EWMAs, tissue
   recency, sleep debt, adherence rates. Computed by the state projector from
   the log. **No input surface exists for these.** A UI that asks the user to
   type `hrvBaselineSD` is a bug.

Intake is therefore an event-authoring UI over the committed `EngineEvent`
union (`packages/engine/src/types/events.ts`), plus a small settings surface
for the declared block of `UserState`.

## Architecture

```
apps/web              Next.js (Vercel) — all UI
packages/engine       pure decide(state, date), zero runtime deps  [Step 3]
packages/adapters     form payloads / device payloads / free text → EngineEvent [Step 4]
packages/store        Postgres event log + UserState projector      [Step 5]
```

- Event log is append-only; corrections are new superseding events, never edits.
- `UserState` is recomputable from the log at any time (contract Step 5).
- `PreRegisteredThreshold` rows are write-once at the storage layer (I10).
- The engine never touches I/O (I1); the web app calls
  `decide(projectState(log), today)`.

## Intake surfaces

### 1. Onboarding wizard (run once, resumable)

| Screen | Collects | Notes |
|---|---|---|
| Profile | age, sex, training age, weekly budget minutes | |
| Modalities | `vo2CapableModalities` multi-select | Copy explains the I9 gate: interval work will only ever be prescribed on what is selected here. Spin bike selectable as a modality but flagged non-VO2-capable by default |
| Equipment & constraints | equipment list, free-text hard constraints | |
| Injury history | per injury: site (tissue-channel picker with plain-language labels), date, severity, recurrences, resolved | Emits `InjuryEvent`s. Drives Layer 1 gating from day one |
| Interruption history | optional backfill: cause, dates | Emits `InterruptionEvent`s — the empirical base rate (section 3) |
| Strength baseline | either e1RM per pattern, or recent rep-sets from which e1RM is derived | Provenance auto-set: `user-reported` vs `derived` |
| Measurement baseline | CMJ guided protocol (5 jumps, app computes median), waist, optional lab values | typicalError defaults come from the section 8 table, not from the user |
| Levers | bloods with **assay dates** (staleness computed immediately), Lp(a) once-ever prompt, alcohol threshold, BP protocol scheduler | Entering a 2-year-old ApoB is allowed; the UI shows it as stale on the spot |
| Standing plan | slot-based week builder (slot, pillar, modality, duration, target sRPE) | Adherence is *not* asked; it is learned from outcomes |

Nothing in onboarding asks for anything derived, and nothing asks for a vendor
composite (I4): if a user tries to enter an Oura Readiness score there is
nowhere to put it.

### 2. Daily / weekly logging

- **Activity log** — two paths, both ending in a confirmed `ActivityEvent`:
  - Structured quick-log: pick planned session → done/modified/missed
    (missed → `MissedSessionEvent`; copy never moralizes, section 9).
  - Free-text box ("played 70 min pickup soccer, legs cooked") → LLM parses to
    a *draft* `ActivityEvent` with proposed pillar/tissue load classification →
    user confirms or edits → event appended. LLM is parsing only (I2a); the
    classification the engine consumes is the user-confirmed structured event.
- **Morning subjective** — optional 10-second check-in: soreness, site pain
  (0–10 + "does it change how you move?"), illness symptoms → `SubjectiveEvent`
  / `IllnessEvent`. Skippable without penalty.
- **Raw recovery signals** — manual entry of HRV (ln rMSSD), RHR, sleep
  duration/midpoint if no wearable; Oura adapter (raw signals only) replaces
  typing, later in Step 4. Single readings only; all rolling stats derived (I5).
- **Guided measurement protocols** — the app runs the protocol so the input is
  valid by construction: CMJ median-of-5, home BP 7-day flow (morning+evening,
  auto-discards first reading of each sitting, computes the 7-day mean), weekly
  waist.

### 3. Lever panel

Each lever: current value, `lastUpdated`, staleness state, flag state, and the
single next action (e.g. "start 7-day BP protocol"). Surfaces escalate per
section 5 and never touch the training plan (I6).

### 4. Block management

Start-block flow *requires* registering the threshold before the first session
is generated (`BlockStartEvent` with `PreRegisteredThreshold`, write-once).
Retest entry is refused with an explanation if no threshold is on record (I10).

## Input validation (adapter layer, Step 4)

- Zod schemas per event type; unit and plausibility ranges per field.
- Provenance is set by the entry path, never chosen by the user.
- `typicalError` defaults from the section 8 table, overridable only downward
  is *not* allowed (a user cannot declare their measurement more precise than
  the protocol supports).

## Explicitly not built (section 9)

No composite readiness input or display weighting, no streaks/badges, no
percentile display without error bands, no LLM-generated sessions, no zone
entry via `220 − age`.

## Sequencing

1. **Blocked, next**: user authors expected decisions in `fixtures/scenarios.md`.
2. **Step 3**: engine against fixtures (pure package, `constants.ts` with
   convention/evidence marking).
3. **Step 4**: manual-entry adapter first (it is what makes direct input
   possible and is the permanent fallback), then free-text parser, then Oura/
   Strava.
4. **Step 5**: Postgres event log + projector + immutable thresholds.
5. **Step 6**: UI in this order: intake wizard → daily log → today's decision
   (with "no change detected" as a first-class, respectable screen, section 11)
   → lever panel → trend charts with SDC bands.
