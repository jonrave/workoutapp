/**
 * POST /api/events — the single write path. Payloads go through the adapter
 * constructors (provenance by entry path, §8 error defaults) and zod
 * validation before entering the append-only log. The engine never sees an
 * unvalidated event.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  activity,
  aerobicSessionFromStream,
  bucketedZoneMinutes,
  cooperTest,
  illness,
  injury,
  leverMeasurement,
  fitnessMeasurement,
  missedSession,
  parseStreamDrop,
  planUpdate,
  profileUpdate,
  subjective,
  validateEvent,
} from '@peakspan/adapters';
import type { Modality, PlannedSession, ProfileUpdateEvent } from '@peakspan/engine';
import type { EngineEvent } from '@peakspan/engine';
import { appendEvent, latestCalibration } from '../../../lib/data';

const bodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('activity'),
    planned: z.boolean(),
    plannedSlot: z.string().nullable(),
    modality: z.enum(['run', 'airBike', 'spinBike', 'row', 'swim', 'hike', 'lift', 'other']),
    durationMinutes: z.number().min(1).max(720),
    sRPE: z.number().min(0).max(10),
    occurredAt: z.string(),
    pillarLoad: z.record(z.string(), z.number()).optional(),
    tissueLoad: z.record(z.string(), z.number()).optional(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal('missed-session'),
    plannedSlot: z.string(),
    occurredAt: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal('subjective'),
    occurredAt: z.string(),
    soreness: z.number().min(0).max(10).optional(),
    pain: z.object({ site: z.string(), score: z.number().min(0).max(10) }).optional(),
    altersMovement: z.boolean().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal('illness'),
    phase: z.enum(['onset', 'update', 'resolved']),
    systemic: z.boolean(),
    symptoms: z.array(z.string()),
    occurredAt: z.string(),
  }),
  z.object({
    kind: z.literal('injury'),
    site: z.string(),
    severity: z.enum(['minor', 'moderate', 'severe']),
    occurredAt: z.string(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal('fitness-measurement'),
    metric: z.enum(['vo2max', 'lt1Pace', 'peakPower', 'cmjHeight', 'rsi', 'almi', 'fmi', 'vat', 'romAsymmetry']),
    value: z.number().positive(),
    unit: z.string(),
    occurredAt: z.string(),
    source: z.enum(['measured-lab', 'measured-field']),
  }),
  z.object({
    kind: z.literal('lever-measurement'),
    lever: z.enum(['homeSBP7d', 'homeDBP7d', 'apoB', 'lpa', 'hba1c', 'fastingInsulin', 'alcoholUnits', 'waistCm']),
    value: z.number().nonnegative(),
    unit: z.string(),
    occurredAt: z.string(),
    source: z.enum(['measured-lab', 'measured-field', 'user-reported']),
  }),
  z.object({
    kind: z.literal('profile-update'),
    occurredAt: z.string(),
    fields: z
      .object({
        age: z.number().int().min(10).max(110),
        trainingAgeYears: z.number().min(0).max(90),
        vo2CapableModalities: z.array(
          z.enum(['run', 'airBike', 'spinBike', 'row', 'swim', 'hike', 'lift', 'other']),
        ),
        equipment: z.array(z.string().min(1)),
        weeklyBudgetMinutes: z.number().min(30).max(2400),
        hardConstraints: z.array(z.string().min(1)),
      })
      .partial(),
  }),
  z.object({
    kind: z.literal('plan-update'),
    occurredAt: z.string(),
    weekStructure: z.array(
      z.object({
        slot: z.string(),
        pillar: z.enum(['maxStrength', 'vo2max', 'zone2', 'power', 'mobility']),
        modality: z.enum(['run', 'airBike', 'spinBike', 'row', 'swim', 'hike', 'lift', 'other']),
        description: z.string().min(1),
        durationMinutes: z.number().min(5).max(240),
        targetSRPE: z.number().min(0).max(10),
      }),
    ),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal('cooper-test'),
    surface: z.enum(['track', 'treadmill']),
    distanceMeters: z.number().min(1000).max(5000),
    pacingStrategy: z.string().min(1),
    occurredAt: z.string(),
    rampCorrection: z.string().optional(),
    typicalError: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal('aerobic-stream'),
    modality: z.enum(['run', 'airBike', 'spinBike', 'row', 'swim', 'hike', 'lift', 'other']),
    occurredAt: z.string(),
    /** Raw stream payload (file drop or Strava streams JSON); parsed and rejected server-side. */
    stream: z.unknown(),
    activityId: z.string().optional(),
    environment: z.enum(['outdoor', 'treadmill', 'indoor', 'unknown']).optional(),
  }),
  z.object({
    kind: z.literal('bucketed-zone-minutes'),
    device: z.string().min(1),
    modality: z.enum(['run', 'airBike', 'spinBike', 'row', 'swim', 'hike', 'lift', 'other']),
    durationMinutes: z.number().positive(),
    occurredAt: z.string(),
    minutesAboveThreshold: z
      .array(z.object({ thresholdBpm: z.number().positive(), minutes: z.number().nonnegative() }))
      .optional(),
    deviceBuckets: z
      .array(z.object({ label: z.string().min(1), minutes: z.number().nonnegative() }))
      .optional(),
    note: z.string().optional(),
  }),
]);

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  let event: EngineEvent;
  switch (body.kind) {
    case 'activity': {
      const { kind: _k, pillarLoad, tissueLoad, description, ...rest } = body;
      event = activity({
        ...rest,
        plannedSlot: rest.plannedSlot as never,
        ...(pillarLoad ? { pillarLoad: pillarLoad as never } : {}),
        ...(tissueLoad ? { tissueLoad: tissueLoad as never } : {}),
        ...(description !== undefined ? { description } : {}),
      });
      break;
    }
    case 'missed-session':
      event = missedSession({ ...body, plannedSlot: body.plannedSlot as never });
      break;
    case 'subjective': {
      const { kind: _k, ...rest } = body;
      event = subjective(rest);
      break;
    }
    case 'illness': {
      const { kind: _k, ...rest } = body;
      event = illness(rest);
      break;
    }
    case 'injury': {
      const { kind: _k, ...rest } = body;
      event = injury(rest);
      break;
    }
    case 'fitness-measurement': {
      const { kind: _k, ...rest } = body;
      event = fitnessMeasurement(rest);
      break;
    }
    case 'lever-measurement': {
      const { kind: _k, ...rest } = body;
      event = leverMeasurement(rest);
      break;
    }
    case 'profile-update':
      event = profileUpdate({
        fields: body.fields as ProfileUpdateEvent['fields'],
        occurredAt: body.occurredAt,
      });
      break;
    case 'plan-update':
      event = planUpdate({
        weekStructure: body.weekStructure as PlannedSession[],
        occurredAt: body.occurredAt,
        ...(body.note !== undefined ? { note: body.note } : {}),
      });
      break;
    case 'cooper-test': {
      const { kind: _k, ...rest } = body;
      try {
        event = cooperTest(rest);
      } catch (err) {
        // e.g. a treadmill test with no ramp correction on record.
        return NextResponse.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 400 },
        );
      }
      break;
    }
    case 'aerobic-stream': {
      const calibration = await latestCalibration(body.modality);
      if (!calibration) {
        return NextResponse.json(
          {
            error:
              `No HR band calibration on record for "${body.modality}" (I9: bands are per-modality). ` +
              'Calibrate this modality before computing time in band; another modality\'s bands are never borrowed.',
          },
          { status: 400 },
        );
      }
      try {
        event = aerobicSessionFromStream({
          stream: parseStreamDrop(body.stream),
          modality: body.modality as Modality,
          calibration,
          occurredAt: body.occurredAt,
          ...(body.activityId !== undefined ? { activityId: body.activityId } : {}),
          ...(body.environment !== undefined ? { environment: body.environment } : {}),
        });
      } catch (err) {
        // DeviceZoneLabelRejection and malformed streams both land here with
        // their own explanations.
        return NextResponse.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 400 },
        );
      }
      break;
    }
    case 'bucketed-zone-minutes': {
      const { kind: _k, ...rest } = body;
      event = bucketedZoneMinutes(rest);
      break;
    }
  }

  try {
    validateEvent(event);
    await appendEvent(event);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: event.id });
}
