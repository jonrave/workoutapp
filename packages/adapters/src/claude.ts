/**
 * Claude-backed free-text activity parser (I2a). Lives behind the
 * ActivityParser interface in its own module: the engine and store never
 * import this file, so no LLM can enter the decision path (I2).
 *
 * Returns a draft for user confirmation only — it never chooses sets, reps,
 * intensity, modality, or rest for future training.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { IsoDate, Pillar } from '@peakspan/engine';
import type { ActivityParser, DraftActivity } from './parser';
import type { NoteParser, ParsedNote } from './note';

const MODALITIES = ['run', 'airBike', 'spinBike', 'row', 'swim', 'hike', 'lift', 'other'] as const;
const PILLARS = ['maxStrength', 'vo2max', 'zone2', 'power', 'mobility'] as const;
const CHANNELS = [
  'axialCompression',
  'kneeExtensor',
  'hipExtensor',
  'hamstringHighVelocity',
  'calfAchillesHighVelocity',
  'upperPush',
  'upperPull',
  'shoulderOverhead',
  'connectiveHighVelocity',
] as const;

const ParsedActivitySchema = z.object({
  modality: z.enum(MODALITIES),
  durationMinutes: z.number(),
  sRPE: z.number().describe('Session RPE 0-10 as reported or best estimate'),
  description: z.string().describe('One-line normalized summary of the activity'),
  pillarLoad: z
    .array(z.object({ pillar: z.enum(PILLARS), sRpeMinutes: z.number() }))
    .describe('sRPE-minute load attributed per pillar; must sum to roughly sRPE * durationMinutes'),
  tissueChannels: z
    .array(z.enum(CHANNELS))
    .describe('Tissue channels this activity loaded, per contract section 6 classification'),
  confidence: z.enum(['high', 'medium', 'low']),
});

const SYSTEM = `You parse free-text workout logs into structured activity records for a training app.
Classify unplanned activity into pillar load and tissue load, not just minutes (a two-hour hike is
aerobic plus eccentric lower-limb load, not a rest day; a competitive match or hard group run is
high-intensity conditioning plus high-velocity connective-tissue exposure). Parse only what is
described - never prescribe, recommend, or editorialize about training. If duration or effort is
not stated, estimate conservatively and lower your confidence.`;

export class ClaudeActivityParser implements ActivityParser {
  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model = 'claude-opus-5',
  ) {}

  async parse(text: string, date: IsoDate): Promise<DraftActivity> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Activity date: ${date}\n\nLog entry:\n${text}` }],
      output_config: { format: zodOutputFormat(ParsedActivitySchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error('Activity parsing failed: no structured output returned');
    }
    const pillarLoad: Partial<Record<Pillar, number>> = {};
    for (const entry of parsed.pillarLoad) {
      pillarLoad[entry.pillar] = (pillarLoad[entry.pillar] ?? 0) + entry.sRpeMinutes;
    }
    return {
      modality: parsed.modality,
      durationMinutes: parsed.durationMinutes,
      sRPE: parsed.sRPE,
      description: parsed.description,
      pillarLoad,
      tissueChannels: [...new Set(parsed.tissueChannels)],
      confidence: parsed.confidence,
      needsConfirmation: true,
    };
  }
}

const ParsedNoteSchema = z.object({
  activities: z.array(
    z.object({
      modality: z.enum(MODALITIES),
      durationMinutes: z.number(),
      sRPE: z.number().describe('Session RPE 0-10 as reported or conservatively estimated'),
      description: z.string().describe('One-line normalized summary of the activity'),
      pillarLoad: z
        .array(z.object({ pillar: z.enum(PILLARS), sRpeMinutes: z.number() }))
        .describe('sRPE-minute load per pillar; must sum to roughly sRPE * durationMinutes'),
      tissueChannels: z.array(z.enum(CHANNELS)),
    }),
  ),
  subjective: z.array(
    z.object({
      soreness: z.number().nullable().describe('Whole-body soreness 0-10, null if not reported'),
      painSite: z
        .union([z.enum(CHANNELS), z.string()])
        .nullable()
        .describe('Tissue channel (preferred) or free-text site of reported pain'),
      painScore: z.number().nullable().describe('Pain 0-10; required when painSite is set'),
      altersMovement: z
        .boolean()
        .describe('True only if the user says the pain changes how they move'),
    }),
  ),
  illness: z.array(
    z.object({
      phase: z.enum(['onset', 'update', 'resolved']),
      systemic: z.boolean().describe('Fever, body aches, chills, or below-neck symptoms'),
      symptoms: z.array(z.string()),
    }),
  ),
  injuries: z.array(
    z.object({
      site: z.union([z.enum(CHANNELS), z.string()]),
      severity: z.enum(['minor', 'moderate', 'severe']),
      note: z.string().nullable(),
    }),
  ),
  levers: z.array(
    z.object({
      lever: z.enum(['alcoholUnits', 'waistCm']),
      value: z.number(),
      unit: z.string().describe("'units' for alcohol, 'cm' for waist"),
    }),
  ),
  sleepDurationHours: z
    .number()
    .nullable()
    .describe('Self-reported sleep duration for the prior night, null unless explicitly stated'),
  summary: z.string().describe('One short sentence restating what was recorded'),
  confidence: z.enum(['high', 'medium', 'low']),
});

const NOTE_SYSTEM = `You structure free-text training-diary notes into typed records for a training app.
One note may contain several facts: a workout, soreness or pain, illness, an injury, alcohol,
a waist measurement, last night's sleep. Extract each fact the user actually states into the
matching array; leave arrays empty and nullable fields null for anything not mentioned - never
invent facts. Classify activity into pillar load and tissue load, not just minutes (a two-hour
hike is aerobic plus eccentric lower-limb load; a competitive match is high-intensity
conditioning plus high-velocity connective-tissue exposure). Parse only what is described -
never prescribe, recommend, or editorialize about training. If duration or effort is not
stated, estimate conservatively and lower your confidence.`;

/**
 * Claude-backed multi-event note parser (I2a). Same isolation as the activity
 * parser above: the engine and store never import this module, so no LLM can
 * enter the decision path (I2). It structures what the user wrote; it never
 * chooses training.
 */
export class ClaudeNoteParser implements NoteParser {
  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model = 'claude-opus-5',
  ) {}

  async parseNote(text: string, date: IsoDate): Promise<ParsedNote> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4096,
      system: NOTE_SYSTEM,
      messages: [{ role: 'user', content: `Note date: ${date}\n\nNote:\n${text}` }],
      output_config: { format: zodOutputFormat(ParsedNoteSchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error('Note parsing failed: no structured output returned');
    }
    return {
      activities: parsed.activities.map((a) => {
        const pillarLoad: Partial<Record<Pillar, number>> = {};
        for (const entry of a.pillarLoad) {
          pillarLoad[entry.pillar] = (pillarLoad[entry.pillar] ?? 0) + entry.sRpeMinutes;
        }
        return {
          modality: a.modality,
          durationMinutes: a.durationMinutes,
          sRPE: a.sRPE,
          description: a.description,
          pillarLoad,
          tissueChannels: [...new Set(a.tissueChannels)],
        };
      }),
      subjective: parsed.subjective
        .filter((s) => s.soreness !== null || (s.painSite !== null && s.painScore !== null))
        .map((s) => ({
          ...(s.soreness !== null ? { soreness: Math.max(0, Math.min(10, s.soreness)) } : {}),
          ...(s.painSite !== null && s.painScore !== null
            ? {
                pain: { site: s.painSite, score: Math.max(0, Math.min(10, s.painScore)) },
                altersMovement: s.altersMovement,
              }
            : {}),
        })),
      illness: parsed.illness,
      injuries: parsed.injuries.map((i) => ({
        site: i.site,
        severity: i.severity,
        ...(i.note !== null ? { note: i.note } : {}),
      })),
      levers: parsed.levers,
      recoverySignals:
        parsed.sleepDurationHours !== null
          ? [{ signal: 'sleepDurationHours', value: parsed.sleepDurationHours }]
          : [],
      summary: parsed.summary,
      confidence: parsed.confidence,
    };
  }
}
