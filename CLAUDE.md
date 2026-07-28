# Peakspan Engine: Build Contract

This file is the contract. Do not deviate from the invariants in section 2 without
flagging the conflict explicitly and stopping for a decision. Where this document
and your priors about training apps disagree, this document wins.

---

## 1. Objective

Maximize the integral of trainable physical capacity over the user's remaining
life, subject to the constraint of never sustaining a training-ending event.

This is not "maximize fitness." It is not "maximize adherence to a plan." It is not
"maximize marginal healthspan per training hour," which is a decomposition that
double-counts its own terms. The objective above makes injury avoidance and
long-run adherence first-order terms rather than adjustments applied at the end.

Two consequences you must encode:

1. A recommendation that raises expected fitness while raising injury hazard is
   usually a bad recommendation. The engine is loss-averse by construction.
2. The engine's default output, most weeks, is "do the planned session." Novelty
   is not a feature. A system that changes the plan often is a system responding
   to noise.

---

## 2. Non-negotiable invariants

**I1. The engine is a pure function.** `decide(state, date) -> Decision`. No I/O,
no network, no database, no LLM call inside the engine package. Everything else
is an adapter around it.

**I2. No LLM in the decision path.** Models are permitted for (a) parsing
free-text activity logs into structured events, (b) rendering a structured
Decision into readable prose, (c) explanation on demand. A model may never
choose sets, reps, intensity, modality, or rest.

**I3. Noise gate on every plan change.** No signal changes the plan unless it has
exceeded its own smallest detectable change. Each tracked metric carries a
`typicalError` and a derived `sdc = 2.77 * typicalError`. Deltas below SDC are
rendered as "no change detected" and are never used as a trigger. This applies
to VO2max, DEXA lean mass, jump height, lactate values, and every estimated
fitness quantity.

**I4. No vendor composite scores as primary inputs.** Oura Readiness, Whoop
Recovery, Garmin Body Battery and equivalents are proprietary, unvalidated, and
non-stationary across firmware versions. Ingest raw signals: HRV (ln rMSSD),
resting heart rate, sleep duration, sleep midpoint, sleep efficiency,
temperature deviation. Composites may be stored and displayed but must carry
zero weight in the decision cascade.

**I5. No single-day reactivity.** HRV and RHR enter the engine only as rolling
7-day means compared against a 60-day personal baseline with its own standard
deviation. A single low morning reading changes nothing. Threshold for a flag:
7-day mean below baseline mean minus 0.75 SD, sustained.

**I6. Non-training levers do not compete for the training budget.** Blood
pressure, ApoB, Lp(a), alcohol, sleep duration, sleep timing variance, waist
circumference and visceral fat live in a separate lane with their own
escalation rules. When one of these is flagged, the engine surfaces it as the
highest-value available action and explicitly does not respond by reallocating
training hours.

**I7. Recovery debt, not clock time, is the scarce resource.** Session cost is
`sRPE * durationMinutes * modalityMultiplier`. Never rank or budget by minutes.
High-intensity work is expensive specifically against sleep, which is the
resource the user can least afford to spend.

**I8. Trainability is estimated, never assumed.** Per-pillar response
coefficients start at population priors with wide intervals and update from the
user's own observed dose-response. The engine must be able to report "response
not yet identifiable" and must do so until the data supports otherwise.
Individual VO2max response to a standardized program ranges from near zero to
large (HERITAGE); assuming the population mean applies to this user is the
error the whole system exists to avoid.

**I9. Modality constraints are hard.** The user profile carries a
`vo2CapableModalities` list. VO2max and threshold interval work may only be
prescribed on a listed modality. For this user, running is primary, air bike is
an acceptable alternative, and a standard or spin bike is never valid for Zone 5
work. Zone boundaries are per-modality and are derived from measured thresholds
where available, never from `220 - age`.

**I10. Pre-registered block thresholds.** When a focused block starts, the
engine writes the success threshold to immutable storage before the block runs.
Retest results are evaluated against that stored threshold. A retest without a
pre-registered threshold is a Rorschach test and must be refused.

---

## 3. State model

The engine consumes a single `UserState` object. Sketch, not final:

```
UserState {
  profile:        { age, sex, trainingAgeYears, vo2CapableModalities,
                    equipment, weeklyBudgetMinutes, hardConstraints }

  load:           { acute:   PillarLoad   // 7d EWMA of sRPE-minutes
                    chronic: PillarLoad   // 28d EWMA
                    byTissue: TissueLoad } // see below

  tissue:         // days since last exposure + accumulated recent load, per:
                  // axialCompression, kneeExtensor, hipExtensor,
                  // hamstringHighVelocity, calfAchillesHighVelocity,
                  // upperPush, upperPull, shoulderOverhead, connectiveHighVelocity

  recovery:       { hrv7d, hrvBaseline60d, hrvBaselineSD,
                    rhr7d, rhrBaseline60d,
                    sleepMean7d, sleepMidpointSD14d, sleepDebtRolling,
                    subjectiveSoreness, illnessFlags }

  fitness:        // per pillar: point estimate + uncertainty + measurement date
                  { vo2max, lt1Pace, maxStrength, peakPower, cmjHeight, rsi,
                    almi, fmi, vat, romAsymmetry }

  levers:         { homeSBP7d, homeDBP7d, apoB, lpa, hba1c, fastingInsulin,
                    alcoholUnits7d, waistCm, lastUpdated per field }

  history:        { interruptions: Interruption[],   // date, cause, durationDays
                    injuries: Injury[],              // site, date, severity, recurrence
                    adherenceBySlot: Map<slot, completionRate> }

  block:          { activePillar, startDate, plannedWeeks,
                    preRegisteredThreshold, metricUnderTest }
}
```

Two fields carry more weight than their size suggests. `history.interruptions`
is the empirical base rate of what actually stops this user from training, and
under the section 1 objective it is more informative than any fitness percentile.
`adherenceBySlot` is learned, not declared: the engine should discover that
Thursday evening sessions complete 40% of the time and stop scheduling hard work
there.

---

## 4. Decision cascade

Evaluate in strict order. The first layer that fires determines the shape of the
output. Later layers only allocate what earlier layers leave available.

**Layer 0. Medical red flags.** Chest pain, syncope, new neurological symptoms,
suspected fracture, resting HR wildly out of range. Output is stop and seek
care. No training content is generated.

**Layer 1. Injury and illness gate.** Hard blocks, no optimization inside this
layer:
- Systemic illness symptoms (fever, body aches, below-neck symptoms): no
  training. Return-to-training ramp defined in section 6.
- Joint pain above 3/10, or any pain that alters gait or movement quality: the
  implicated pattern is blocked and an alternative is substituted.
- Plyometric and maximal-velocity work is blocked when sleep <6h the prior
  night, when the HRV flag is active, or within the tissue-specific window
  following any lower-limb strain. Rate of force development is the most
  fatigue-sensitive quality and high-velocity tissue injuries cluster in
  exactly these states.

**Layer 2. Non-training lever escalation.** If any lever in section 5 is flagged
and unaddressed, the engine surfaces it prominently and the training plan
continues unchanged. This layer never consumes or reallocates training time.

**Layer 3. Pillar floors.** Before optimizing anything, protect the minimum
effective dose for every pillar. Floors are cheap and the asymmetry is large:
losing a pillar costs far more than gaining one is worth. Working values, all
tunable, all conventions rather than findings:

| Pillar | Maintenance floor |
|---|---|
| Max strength | 2 sessions/wk, >=4 hard sets per major pattern per week; as low as one third of accumulation volume holds strength for months |
| VO2max | 1 hard interval session/wk holds most of it for several weeks |
| Zone 2 / aerobic base | Least robust to reduction; needs consistent volume, degrades within 2-3 weeks |
| Power / high velocity | 10-15 min/wk across 2 short exposures |
| Mobility / ROM | Daily-ish, trivially cheap, treat as habit not as programming |

Power sits in the floor tier regardless of test results. The case for it is
tissue tolerance and the motor-unit prevention window, not a percentile gap, and
at 10-15 minutes per week any framework that divides by cost ranks it first by
construction.

**Layer 4. Marginal allocation of residual budget.** Only what remains after
floors gets allocated, and only by the two-term chain rule:

```
marginalValue(pillar) = healthSlopeAtCurrentPosition(pillar)
                      * estimatedResponseRate(pillar)   // section 7
                      * (1 - injuryHazardDelta(pillar))
```

Two terms plus a hazard penalty. Not four. Position and slope are one term;
slope at the user's position already encodes position. Trainability and
per-hour cost are one term; a response rate is already a derivative with
respect to dose.

Pillars are not separable. Strength feeds running economy and injury
resistance; Zone 2 feeds interval quality; interval volume subtracts from
sleep, which subtracts from everything. The gradient is therefore valid only
locally. Cap any single reallocation at roughly 15% of the weekly budget and
re-evaluate before moving further.

**Layer 5. Session selection.** Given the allocation, choose the specific
session by tissue recency, equipment, time available today, and slot adherence
history.

**Layer 6. Noise gate.** Diff the new plan against the standing plan. Strip any
change whose triggering signal has not cleared its SDC. If nothing survives,
output the standing plan and say so.

---

## 5. Non-training levers

These have their own escalation table and their own surface in the UI. Rationale:
for a trained 34-year-old already above population norms on most pillars, the
expected value here plausibly exceeds anything available in the training budget.
The evidence grade is also asymmetric: ApoB and blood pressure rest on Mendelian
randomization plus randomized trials, while the fitness dose-response is
observational throughout.

| Lever | Flag condition | Engine behavior |
|---|---|---|
| Blood pressure | Home 7-day mean SBP >=130 | Highest priority non-emergent surface. Home protocol: validated upper-arm cuff, 7 days, morning and evening, discard first reading of each sitting |
| ApoB | >70 mg/dL, or >60 with Lp(a) >50 nmol/L or family history | Surface as pharmacologic decision. Lifetime cumulative exposure framing |
| Lp(a) | Never measured | Prompt once. Isoform-independent assay, nmol/L. One measurement per lifetime |
| Sleep duration | 7-day mean <7h | Block any increase in training load. Adding hours here is negative expected value |
| Sleep timing variance | 14-day SD of midpoint >60 min | Surface. Variance is the neglected variable and the raw data is already being collected |
| Alcohol | Rolling 7-day units above user-set threshold | Surface, no moralizing copy |
| Central adiposity | Waist >94 cm, or DEXA VAT high for BMI | Energy balance lane, not a training reallocation |
| Metabolic | HbA1c, fasting insulin out of range | Surface |

Staleness matters. Every lever field carries `lastUpdated` and the engine
prompts for a refresh on a defined cadence rather than treating a two-year-old
lipid panel as current.

---

## 6. Interruption handling

Detraining rates differ by pillar, so the return ramp must be per-pillar rather
than a single global "ease back in" multiplier. Working model:

| Pillar | Decay onset | Return behavior |
|---|---|---|
| Aerobic base / VO2max | Measurable within 2-3 weeks, substantial by 4-6 | Rebuild volume before intensity. Do not resume interval work in week 1 back |
| Max strength | Well retained for several weeks to months | Resume at reduced volume, near-prior intensity. Do not restart a linear progression from scratch |
| Power / RFD | Decays faster than max strength | Resume with low volume, full recovery between efforts, no fatigue-state exposure |
| Connective tissue tolerance | Slower to rebuild than the quality it supports | This is the rate limiter after any interruption longer than ~2 weeks. Ramp high-velocity and high-impact exposure last |

Post-illness ramp: no training while systemic symptoms persist, then two to
three days of easy aerobic work only, then reintroduce strength at reduced
volume, then intensity. Total ramp length scales with illness duration.

Unplanned activity ingestion: a two-hour hike is aerobic load plus eccentric
lower-limb load, not a rest day. A competitive match or a hard group run is
high-intensity conditioning plus high-velocity connective tissue exposure, and
should suppress both the following day's lower-body load and any planned
plyometric work. The engine must classify unplanned activity into pillar load
and tissue load, not just into calories or minutes.

Note on ACWR: acute-to-chronic workload ratio is implemented as a soft flag
only. The construct has been substantially criticized (shared-term spurious
correlation, arbitrary binning, weak prospective validity). It may raise a
caution. It may never hard-block.

---

## 7. Trainability estimation

The engine maintains a per-pillar response model:

```
deltaFitness ~ f(cumulativeDose, baselineFitness) + individualEffect
```

Start from population priors with deliberately wide intervals. Update from the
user's own observed blocks using shrinkage toward the prior. Report the estimate
as a distribution with an explicit "not yet identifiable" state, and default to
that state until several blocks have accumulated.

This is the honest form of the claim that trainability rather than percentile gap
determines marginal value. That claim is true and also self-undermining as a
screening criterion, because trainability cannot be measured before running the
block. The engine resolves this by learning it over quarters, not by asserting
it at intake.

---

## 8. Measurement module

Prefer many cheap repeated measures over few expensive point estimates. The
binding constraint on learning anything from this system is measurement noise,
and repeated sampling is the only thing that beats it down.

| Measure | Cadence | Typical error | Notes |
|---|---|---|---|
| CMJ height and RSI | Weekly, median of 5 | ~3-5% | Primary power tracker. Trend over 2+ quarters, not week to week |
| HR and pace at fixed RPE, standard route | Monthly | Contextual | Drift detector for aerobic state |
| Waist circumference | Weekly | ~1 cm | Cheapest adiposity signal |
| Lactate step test, primary modality | Quarterly | Assay + protocol | Re-derives thresholds on the actual modality. Beats a stale one-time lab VT1 |
| Home BP, 7-day protocol | Quarterly | ~3-5 mmHg on 7-day mean | Highest value-of-information measure in the entire system |
| Bloods (ApoB, HbA1c, insulin, hs-CRP) | 6-12 months | Assay-specific | Lp(a) once ever |
| GXT with metabolic cart | 12 months | 3-5% CV | Keep for true HRmax, FRIEND percentile, and the incidental ECG / BP / HR-recovery screen. VT1 is the weakest of its four justifications |
| DEXA | 12 months | 1-2% regional lean | Read primarily for VAT and fat mass. ALMI percentile has near-zero decision value in a 15-year lifter |

Explicitly excluded, with reasons, so they do not get reintroduced:

- **Fractional utilization as watts-at-LT1 over watts-at-VO2max.** Not the
  quantity for which normative data exist, not identified as a diagnostic
  (a low value is equally consistent with low volume, high VO2max, fiber type,
  recent intensity emphasis, or threshold placement), and no established link to
  any health outcome independent of VO2max.
- **Grip dynamometry.** Valid mortality proxy, no evidence that training it
  changes anything, and the result is known in advance for this user.
- **Pushups to failure, dead hang, sit-to-rise.** No decision value at 34 in a
  trained lifter. Sit-to-rise was validated in adults aged 51-80 and has no
  discriminative power here.
- **Maximal-velocity sprint testing.** Real hamstring strain risk in an
  untrained max-velocity effort, and injury avoidance is a first-order term.
- **Anaerobic capacity testing.** Excluded on value-of-information grounds, not
  injury grounds. There are no normative healthspan data and no result would
  change behavior.

Every test in the battery must pass one filter before it ships: name the result
that would change what the user does. If no such result exists, delete the test.

---

## 9. Anti-features

Do not build these. If a future request implies one, flag the conflict with this
section.

- A single composite "readiness score" driving prescription.
- Streaks, badges, or any mechanic that penalizes correct rest.
- Auto-escalating volume in the absence of a response signal.
- Plan changes triggered by one day of data.
- Vendor recovery scores weighted into the decision.
- Interval prescription on any modality not in `vo2CapableModalities`.
- Zones derived from `220 - age` or from percent-of-HRmax defaults.
- Copy that moralizes about missed sessions.
- LLM-generated workouts.
- Percentile comparisons presented without the measurement error that makes them
  meaningless at the individual level.

---

## 10. Build order

Do not start at the UI. Do not start at the integrations.

**Step 1. Types and this contract.** Define `UserState`, `Decision`, and the
event types. Commit. No logic yet.

**Step 2. Scenario fixtures, authored by the user, not by you.** Produce a table
of ~40 scenarios covering: normal week, illness of varying duration, travel,
sleep debt, HRV flag, unplanned high-intensity activity, injury flare, BP flag
outstanding, post-block retest below SDC, post-block retest above SDC, budget
cut in half for a week, two-week total interruption. Fill in the state columns.
Leave the expected-decision column blank. Stop and hand it back for the expected
outputs. Do not guess them.

**Step 3. Engine implementation against those fixtures.** Pure package, zero
runtime dependencies. Every layer of section 4 independently testable. All
tunable constants in a single `constants.ts` with a comment on each marking it
as convention or as evidence-derived, and a source where one exists.

**Step 4. Ingestion adapters.** Oura (raw signals only), Strava, manual entry,
free-text parsing. Adapters normalize into engine event types and do nothing
else.

**Step 5. Persistence.** Append-only event log plus derived state. State is
recomputable from the log. Pre-registered block thresholds are immutable once
written.

**Step 6. UI, last and thin.** Today's decision, why it was made, the standing
plan, the lever panel, and the trend views with SDC bands drawn on every chart.

Stack recommendation given existing infrastructure: TypeScript monorepo, engine
as a pure package, Next.js on Vercel, Postgres. This matches the deployment
pattern already in use and keeps the engine portable if the app layer changes.

---

## 11. Honest limitations to encode in the product

The engine's own prior should be that most weeks nothing changes, and that for a
user already above the 75th percentile on most pillars the real leverage sits
outside the training budget entirely. Build the UI so that this is a legible,
respectable output rather than a failure state.

Most constants in section 4 and section 6 are conventions, not findings. Mark
them as such in code. A user should be able to see which numbers are load-bearing
and which are placeholders, because the difference between a defensible system
and an authoritative-looking one is entirely in whether it tells you that.
