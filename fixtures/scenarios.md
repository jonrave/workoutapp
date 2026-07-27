# Scenario fixtures — Subject A

Contract section 10, Step 2. State columns are filled in; the **Expected
decision column is intentionally blank** and is to be authored by the user, not
generated. Do not guess it (contract: "Stop and hand it back for the expected
outputs").

## Baseline

Every row starts from `fixtures/subjects/subject-a.json` as of **2026-07-27**
(a Monday; week 6 of the active VO2max block). A cell reading "baseline" means
that portion of state is unchanged. Cells list only the fields that differ,
as `field: value` overrides that compose into a full `UserState`.

Derived reference values from the baseline (for reading the rows, all per I3/I5):

| Quantity | Value |
|---|---|
| HRV flag threshold (baseline − 0.75 SD) | ln rMSSD 7d mean < **4.13**, sustained |
| SDC, VO2max (2.77 × 2.1) | **5.8** ml/kg/min |
| SDC, CMJ height (2.77 × 1.7) | **4.7** cm |
| SDC, LT1 pace (2.77 × 8) | **22.2** s/km |
| SDC, waist (2.77 × 1) | **2.8** cm |
| Pre-registered block threshold (I10) | VO2max ≥ **55.5** ml/kg/min, registered 2026-06-21 |
| Lever flags (section 5) | SBP ≥130 · ApoB >70 (Lp(a)=22, so the >60 clause is inactive) · sleep 7d <7h · midpoint SD 14d >60 min · alcohol 7d >6 units · waist >94 cm |

## Scenarios

| ID | Family | Scenario | Recovery state | Load & tissue state | Levers | Block / retest | Other context | Expected decision |
|---|---|---|---|---|---|---|---|---|
| N1 | Normal week | Mid-block week with every signal nominal | baseline | baseline | baseline | week 6 of 8, on plan | Tuesday interval session is today's planned session | |
| N2 | Normal week | One low HRV morning, rolling mean fine | yesterday's single reading ln rMSSD 3.60; hrv7d: 4.26 (above 4.13) | baseline | baseline | baseline | probes I5: single-day reading must change nothing | |
| N3 | Normal week | Weekly CMJ dips within noise | baseline | baseline | baseline | cmjHeight this week: 40.3 (Δ −1.2 vs 41.5; SDC 4.7) | probes L6: sub-SDC delta must not touch the plan | |
| IL1 | Illness (varying duration) | Day 2 of head cold, above-neck only | illnessFlags: [{onset 2026-07-26, systemic: false, symptoms: [runny nose, sore throat]}]; hrv7d: 4.20 | baseline | baseline | baseline | interval session on tomorrow's plan | |
| IL2 | Illness (varying duration) | Day 1 of fever with body aches | illnessFlags: [{onset 2026-07-27, systemic: true, symptoms: [fever 38.6C, body aches]}]; sleepPriorNight: 5.9 | baseline | baseline | baseline | probes L1 systemic block | |
| IL3 | Illness (varying duration) | Day 1 after 5-day systemic illness resolved | illnessFlags: [{onset 2026-07-21, systemic: true, resolved 2026-07-26}]; hrv7d: 4.08; rhr7d: 50.1 | all tissue daysSinceLastExposure +5 | baseline | baseline | history.interruptions += {2026-07-21, illness, 5}; user asks for today's session | |
| IL4 | Illness (varying duration) | Day 3 after 10-day influenza, 2 easy aerobic days done | illnessFlags resolved 2026-07-24; hrv7d: 4.15; rhr7d: 48.9 | zone2 acute: 90; all other pillar acute ≈ 0; tissue: strength channels daysSinceLastExposure 13 | baseline | baseline | history.interruptions += {2026-07-14, illness, 10}; probes section 6 post-illness ramp ordering | |
| T1 | Travel | Day 2 of 5-day work trip, hotel gym | sleepMean7d: 7.0; sleepMidpointSD14d: 55 | baseline | baseline | baseline | equipment this week: dumbbells ≤22kg + treadmill only; ≤40 min/day windows; interval day planned (treadmill is run-capable) | |
| T2 | Travel | Just back from +6h time zones | sleepMean7d: 6.4; sleepMidpointSD14d: 85; sleepDebtRolling: 5.0; hrv7d: 4.16 | baseline | sleep-duration flag active (<7h); midpoint-variance flag active (>60 min) | baseline | returned last night from 6-day trip; history.interruptions += {2026-07-21, travel, 6} | |
| T3 | Travel | Next week declared: 7 days, no equipment, running possible | baseline | baseline | baseline | block week 7 would fall in the travel week | user announces trip today; asks how the week should be restructured | |
| S1 | Sleep debt | Chronic short sleep, otherwise nominal | sleepMean7d: 6.5; sleepDebtRolling: 4.0; hrv7d: 4.22 | baseline | sleep-duration flag active | baseline | interval session is today's plan; probes §5 "block any increase in training load" | |
| S2 | Sleep debt | Acute short night before a power-primer day | sleepPriorNight: 5.2; sleepMean7d: 6.8; sleepDebtRolling: 4.5 | baseline | sleep-duration flag active | baseline | today's plan is Mon strength incl. 8-min plyo primer; probes L1 plyo block at <6h prior night | |
| S3 | Sleep debt | Duration fine, timing erratic | sleepMean7d: 7.4; sleepMidpointSD14d: 75 | baseline | midpoint-variance flag active only | baseline | probes I6: surface without touching training | |
| H1 | HRV flag | Sustained suppression crossing threshold | hrv7d: 4.10 (< 4.13), sustained 5 days; rhr7d: 50.2 | baseline | baseline | baseline | interval session is today's plan; probes L1 plyo/max-velocity block + I5 | |
| H2 | HRV flag | Sitting exactly at threshold, 2 days | hrv7d: 4.13, 2 consecutive days; rhr7d: 48.0 | baseline | baseline | baseline | edge case: is 2 days "sustained"? | |
| H3 | HRV flag | Deep sustained suppression, week 7 of block | hrv7d: 4.02 (−1.2 SD), sustained 8 days; rhr7d: 51.8; subjectiveSoreness: 5; no illness symptoms | acute vo2max: 130 (interval load up through block) | baseline | week 7 of 8 | functional-overreach picture without illness | |
| U1 | Unplanned high-intensity activity | Pickup soccer yesterday, sprint exposure | subjectiveSoreness: 4 | yesterday: unplanned 70 min sRPE 8 → hamstringHighVelocity recentLoad 60→320, daysSince 0; connectiveHighVelocity 70→290, daysSince 0; acute vo2max +60 | baseline | baseline | today's plan is Mon lower strength + plyo primer; history has recurrent L hamstring strain (2023, recurrence ×1) | |
| U2 | Unplanned high-intensity activity | Two-hour hike, 600 m descent, watch logged "walk" | baseline | yesterday: unplanned 120 min sRPE 5 → zone2 acute +250; kneeExtensor recentLoad +200 (eccentric), daysSince 0; calfAchillesHighVelocity +100 | baseline | baseline | probes §6: classify into pillar+tissue load, not a rest day | |
| U3 | Unplanned high-intensity activity | Hard group run replaced Sunday's Z2 | hrv7d: 4.19 | 2 days ago: 60 min sRPE 8 group run → vo2max acute +120 (planned was zone2 sRPE 4); connectiveHighVelocity recentLoad +180, daysSince 2 | baseline | baseline | today's plan is Tue intervals: two hard run days in 3 days | |
| IJ1 | Injury flare | Hamstring tightness on a recurrent site, sub-threshold | baseline | hamstringHighVelocity daysSince 1 (strides yesterday) | baseline | baseline | pain 2/10 L hamstring during strides, no gait change; site has recurrenceCount 1; below the 3/10 line but history-loaded | |
| IJ2 | Injury flare | Anterior knee pain above threshold under load | baseline | kneeExtensor daysSince 1 | baseline | baseline | pain 4/10 R knee during squats yesterday, pain-free walking; probes L1 pattern block + substitution | |
| IJ3 | Injury flare | Achilles stiffness at the line, plyo day | baseline | calfAchillesHighVelocity daysSince 1, recentLoad 220 | baseline | baseline | pain 3/10 R Achilles, morning-only, resolves with warmup; today's plan includes pogo/jump primer; edge exactly at "above 3/10" | |
| B1 | BP flag outstanding | Fresh 7-day protocol crosses flag line | baseline | baseline | homeSBP7d: 133 (lastUpdated 2026-07-26), 7-day protocol completed | baseline | all training signals nominal; probes L2/I6: surface prominently, plan unchanged | |
| B2 | BP flag outstanding | Flag surfaced 3 weeks ago, still unaddressed | baseline | baseline | homeSBP7d: 133 (lastUpdated 2026-07-06); no follow-up action logged since | baseline | user keeps training normally; escalation behavior with training plan still untouched | |
| B3 | BP flag outstanding | Sub-flag value but stale | baseline | baseline | homeSBP7d: 128 (lastUpdated 2025-10-20, 9 months old; quarterly cadence missed) | baseline | probes staleness prompting vs an actual flag | |
| RB1 | Retest below SDC | Week-8 GXT retest, gain within noise | baseline | baseline | baseline | retest 2026-07-27: vo2max 54.0 (Δ +1.5 vs 52.5; SDC 5.8; pre-registered threshold 55.5) | block ends this week | |
| RB2 | Retest below SDC | Power-block variant, CMJ within noise | baseline | baseline | baseline | block override: {activePillar power, start 2026-06-01, 8 wk, metric cmjHeight, threshold ≥44.0 registered 2026-05-31}; retest: cmj 42.8 (Δ +1.3; SDC 4.7) | | |
| RB3 | Retest below SDC | Retest with no pre-registered threshold on record | baseline | baseline | baseline | block override: preRegisteredThreshold: null (legacy import); user submits GXT retest vo2max 54.2 | probes I10: refuse evaluation | |
| RA1 | Retest above SDC | Clear responder: above SDC and above threshold | baseline | baseline | baseline | retest: vo2max 58.6 (Δ +6.1 > SDC 5.8; > threshold 55.5) | first identifiable block for vo2max trainability (I8/§7) | |
| RA2 | Retest above SDC | Above pre-registered threshold, below SDC | baseline | baseline | baseline | retest: vo2max 55.8 (> threshold 55.5, but Δ +3.3 < SDC 5.8) | tension row: I10 pass vs I3 "no change detected" | |
| RA3 | Retest above SDC | LT1 pace retest clears its SDC | baseline | baseline | baseline | block override: {metric lt1Pace, threshold ≤305 s/km registered 2026-06-21}; retest: lt1Pace 295 (Δ −25; SDC 22.2) | | |
| BC1 | Budget cut in half | One week at half budget, announced Monday | baseline | baseline | baseline | week 6 of block | weeklyBudgetMinutes this week: 180 (work crunch); probes L3 floors under scarcity | |
| BC2 | Budget cut in half | Two consecutive weeks at half budget mid-block | baseline | baseline | baseline | weeks 6–7 of 8 affected | weeklyBudgetMinutes: 180 for this week and next; block retest scheduled week 8 | |
| BC3 | Budget cut in half | Half budget colliding with short sleep | sleepMean7d: 6.7; sleepDebtRolling: 3.5 | baseline | sleep-duration flag active | baseline | weeklyBudgetMinutes: 150 this week; floors vs sleep-load-cap interaction | |
| TI1 | Two-week interruption | Day 1 back after 14 days full stop, no illness | hrv7d: 4.33 (rested); sleepMean7d: 7.8 | all pillar acute ≈ 0; all tissue daysSinceLastExposure ≥14, recentLoad ≈ 0 | baseline | block abandoned at week 4 (no sessions weeks 5–6) | history.interruptions += {2026-07-13, family, 14}; probes §6 per-pillar ramp + connective-tissue rate limiter | |
| TI2 | Two-week interruption | Day 1 back after 16 days: 10-day illness + travel tail | illnessFlags resolved 2026-07-21; hrv7d: 4.11; rhr7d: 49.5 | all pillar acute ≈ 0; all tissue daysSinceLastExposure ≥16 | baseline | block abandoned | history.interruptions += {2026-07-11, illness, 16 (systemic days 1–6, then travel)}; ramp length must scale with illness duration (§6) | |
| TI3 | Two-week interruption | Week 2 of return after 15 days off | hrv7d: 4.27 | week 1 back completed: 4 easy aerobic sessions + 1 reduced-volume strength; zone2 acute 180; maxStrength acute 90; high-velocity channels daysSinceLastExposure ≥22 | baseline | no active block | user asks when intervals and plyometrics resume; probes §6 "volume before intensity" and "high-velocity last" | |

**37 rows · 12 families.** Expected-decision column to be filled in by the
user; the engine (Step 3) will then be implemented against these fixtures.
