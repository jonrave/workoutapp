/**
 * POST /api/blocks — start a block (I10: the threshold registers before the
 * block runs, and an ill-posed threshold inside the noise band is refused per
 * the approved RA2 rule) or submit a retest (refused as a block verdict when
 * no pre-registered threshold exists; the engine reports the refusal).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { IllPosedThresholdError, startBlock, submitRetest } from '@peakspan/adapters';
import { currentState, appendEvent, readEvents } from '../../../lib/data';

const bodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('start'),
    pillar: z.enum(['maxStrength', 'vo2max', 'zone2', 'power', 'mobility']),
    plannedWeeks: z.number().int().min(2).max(16),
    metricUnderTest: z.enum(['vo2max', 'lt1Pace', 'peakPower', 'cmjHeight', 'rsi']),
    direction: z.enum(['increase', 'decrease']),
    thresholdValue: z.number(),
    occurredAt: z.string(),
  }),
  z.object({
    kind: z.literal('retest'),
    value: z.number().positive(),
    occurredAt: z.string(),
    source: z.enum(['measured-lab', 'measured-field']),
  }),
]);

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  const state = await currentState();

  if (body.kind === 'start') {
    const metric = body.metricUnderTest;
    const baseline = state.fitness[metric];
    if (baseline === null) {
      return NextResponse.json(
        {
          error:
            `No baseline on record for ${metric}. Record a measurement first — ` +
            'a threshold cannot be validated against a value that does not exist.',
        },
        { status: 400 },
      );
    }
    try {
      const event = startBlock({
        pillar: body.pillar,
        plannedWeeks: body.plannedWeeks,
        metricUnderTest: metric,
        baselineValue: baseline.value,
        baselineTypicalError: baseline.typicalError ?? 0,
        direction: body.direction,
        thresholdValue: body.thresholdValue,
        unit: unitFor(metric),
        occurredAt: body.occurredAt,
      });
      await appendEvent(event);
      return NextResponse.json({ ok: true, id: event.id, threshold: event.preRegisteredThreshold });
    } catch (err) {
      if (err instanceof IllPosedThresholdError) {
        return NextResponse.json({ error: err.message, illPosed: true }, { status: 400 });
      }
      throw err;
    }
  }

  // Retest submission.
  if (!state.block) {
    return NextResponse.json({ error: 'No active block to retest.' }, { status: 400 });
  }
  const events = await readEvents();
  const lastStart = [...events].reverse().find((e) => e.type === 'block-start');
  const event = submitRetest({
    blockId: lastStart?.id ?? 'seed-block',
    metric: state.block.metricUnderTest,
    value: body.value,
    unit: unitFor(state.block.metricUnderTest),
    occurredAt: body.occurredAt,
    source: body.source,
  });
  await appendEvent(event);
  const refused = state.block.preRegisteredThreshold === null;
  return NextResponse.json({
    ok: true,
    id: event.id,
    ...(refused
      ? {
          warning:
            'No pre-registered threshold exists for this block: the measurement is stored and updates your fitness estimate, but it cannot be evaluated as a block outcome (I10).',
        }
      : {}),
  });
}

function unitFor(metric: string): string {
  const units: Record<string, string> = {
    vo2max: 'ml/kg/min',
    lt1Pace: 's/km',
    peakPower: 'W',
    cmjHeight: 'cm',
    rsi: 'ratio',
  };
  return units[metric] ?? '';
}
