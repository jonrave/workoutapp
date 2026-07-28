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
