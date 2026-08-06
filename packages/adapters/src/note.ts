/**
 * Free-text note ingestion (I2a): one field, any mix of facts. A note is
 * stored verbatim as a NoteEvent, and the parser structures it into zero or
 * more engine events — activity, soreness/pain, illness, injury, alcohol,
 * waist, sleep — each linked back to the note via `parsedFrom`.
 *
 * The model only ever parses what the user described (I2). It never chooses
 * training, and the structured events it produces go through the same
 * constructors and zod validation as every manual entry.
 */
import type { EngineEvent, IsoDate, NoteEvent } from '@peakspan/engine';
import type {
  ActivityEvent,
  IllnessEvent,
  InjuryEvent,
  LeverMeasurementEvent,
  Modality,
  Pillar,
  RecoverySignalEvent,
  SubjectiveEvent,
  TissueChannel,
} from '@peakspan/engine';
import { defaultContext, type EventContext } from './manual';
import { StubActivityParser } from './parser';

/** Structured facts extracted from one note. Every array may be empty. */
export interface ParsedNote {
  activities: Array<{
    modality: Modality;
    durationMinutes: number;
    sRPE: number;
    description: string;
    pillarLoad: Partial<Record<Pillar, number>>;
    tissueChannels: TissueChannel[];
  }>;
  subjective: Array<{
    soreness?: number;
    pain?: { site: TissueChannel | string; score: number };
    altersMovement?: boolean;
    note?: string;
  }>;
  illness: Array<{ phase: IllnessEvent['phase']; systemic: boolean; symptoms: string[] }>;
  injuries: Array<{ site: TissueChannel | string; severity: InjuryEvent['severity']; note?: string }>;
  /** Restricted to levers a single free-text report can honestly measure. */
  levers: Array<{ lever: 'alcoholUnits' | 'waistCm'; value: number; unit: string }>;
  /** Self-reported sleep only; HRV/RHR come from devices, not prose. */
  recoverySignals: Array<{ signal: 'sleepDurationHours'; value: number }>;
  /** One-line restatement of what was understood, shown back to the user. */
  summary: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface NoteParser {
  parseNote(text: string, date: IsoDate): Promise<ParsedNote>;
}

export const emptyParsedNote = (summary: string): ParsedNote => ({
  activities: [],
  subjective: [],
  illness: [],
  injuries: [],
  levers: [],
  recoverySignals: [],
  summary,
  confidence: 'low',
});

/**
 * Deterministic keyword parser for tests and offline use. Crude on purpose —
 * the interface and the note→events flow are the point, not the NLP. With
 * ANTHROPIC_API_KEY set the app uses the Claude-backed parser instead.
 */
export class StubNoteParser implements NoteParser {
  private readonly activityParser = new StubActivityParser();

  async parseNote(text: string, date: IsoDate): Promise<ParsedNote> {
    const lower = text.toLowerCase();
    const parsed = emptyParsedNote(text.trim());

    if (/\b(soccer|football|basketball|match|game|hik(e|ed|ing)|run|ran|running|jog|jogged|lift|lifted|gym|squat|deadlift|bench|rode|ride|bike|swam|swim|row|rowed)\b/.test(lower)) {
      const draft = await this.activityParser.parse(text, date);
      parsed.activities.push({
        modality: draft.modality,
        durationMinutes: draft.durationMinutes,
        sRPE: draft.sRPE,
        description: draft.description,
        pillarLoad: draft.pillarLoad,
        tissueChannels: draft.tissueChannels,
      });
    }

    const soreness = /sore(?:ness)?\D{0,20}?(\d{1,2})\s*(?:\/|out of)\s*10/.exec(lower);
    if (soreness) {
      parsed.subjective.push({ soreness: Math.min(10, Number(soreness[1])), note: text.trim() });
    } else if (/\bsore\b|\blegs? (?:are )?(?:cooked|dead|heavy)\b/.test(lower)) {
      parsed.subjective.push({ soreness: 5, note: text.trim() });
    }

    const pain = /(knee|hip|hamstring|calf|achilles|back|shoulder)\D{0,30}?(\d{1,2})\s*(?:\/|out of)\s*10/.exec(lower);
    if (pain) {
      const siteMap: Record<string, TissueChannel | string> = {
        knee: 'kneeExtensor',
        hip: 'hipExtensor',
        hamstring: 'hamstringHighVelocity',
        calf: 'calfAchillesHighVelocity',
        achilles: 'calfAchillesHighVelocity',
        back: 'axialCompression',
        shoulder: 'shoulderOverhead',
      };
      parsed.subjective.push({
        pain: { site: siteMap[pain[1]!] ?? pain[1]!, score: Math.min(10, Number(pain[2])) },
        note: text.trim(),
      });
    }

    const alcohol = /(\d{1,2})\s*(?:beers?|drinks?|units?|glasses?)/.exec(lower);
    if (alcohol) {
      parsed.levers.push({ lever: 'alcoholUnits', value: Number(alcohol[1]), unit: 'units' });
    }

    const waist = /waist\D{0,10}?(\d{2,3}(?:\.\d)?)\s*cm/.exec(lower);
    if (waist) {
      parsed.levers.push({ lever: 'waistCm', value: Number(waist[1]), unit: 'cm' });
    }

    const sleep = /slept\D{0,10}?(\d{1,2}(?:[.,]\d)?)\s*(?:h|hr|hrs|hours?)/.exec(lower);
    if (sleep) {
      parsed.recoverySignals.push({
        signal: 'sleepDurationHours',
        value: Number(sleep[1]!.replace(',', '.')),
      });
    }

    if (/(fever|flu|sick|body aches|chills)/.test(lower)) {
      parsed.illness.push({
        phase: /(better|recovered|over it)/.test(lower) ? 'resolved' : 'onset',
        systemic: /(fever|body aches|chills)/.test(lower),
        symptoms: ['self-reported in note'],
      });
    }

    return parsed;
  }
}

/**
 * Build the append-ready events for one note: the verbatim NoteEvent first,
 * then every structured event the parser extracted, each tagged with
 * `parsedFrom` and `source: 'user-reported'` (the user reported it — in
 * prose; the linked note is the audit trail for how it was structured).
 */
export function noteToEvents(
  text: string,
  parsed: ParsedNote,
  date: IsoDate,
  ctx: EventContext = defaultContext,
): { note: NoteEvent; events: EngineEvent[] } {
  const occurredAt = `${date}T12:00:00Z`;
  const note: NoteEvent = {
    id: ctx.id(),
    type: 'note',
    occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    text: text.trim(),
  };
  const events: EngineEvent[] = [];
  const link = { source: 'user-reported' as const, parsedFrom: note.id };
  const stamp = () => ({ id: ctx.id(), occurredAt, recordedAt: ctx.now(), ...link });

  for (const a of parsed.activities) {
    const load = a.sRPE * a.durationMinutes;
    const tissueLoad = Object.fromEntries(
      a.tissueChannels.map((c) => [c, Math.round(load / Math.max(1, a.tissueChannels.length))]),
    ) as Partial<Record<TissueChannel, number>>;
    const event: ActivityEvent = {
      ...stamp(),
      type: 'activity',
      planned: false,
      plannedSlot: null,
      modality: a.modality,
      durationMinutes: a.durationMinutes,
      sRPE: a.sRPE,
      pillarLoad: a.pillarLoad,
      tissueLoad,
      description: a.description,
    };
    events.push(event);
  }
  for (const s of parsed.subjective) {
    const event: SubjectiveEvent = {
      ...stamp(),
      type: 'subjective',
      ...(s.soreness !== undefined ? { soreness: s.soreness } : {}),
      ...(s.pain !== undefined ? { pain: s.pain } : {}),
      ...(s.altersMovement !== undefined ? { altersMovement: s.altersMovement } : {}),
      ...(s.note !== undefined ? { note: s.note } : {}),
    };
    events.push(event);
  }
  for (const i of parsed.illness) {
    const event: IllnessEvent = {
      ...stamp(),
      type: 'illness',
      phase: i.phase,
      systemic: i.systemic,
      symptoms: i.symptoms,
    };
    events.push(event);
  }
  for (const i of parsed.injuries) {
    const event: InjuryEvent = {
      ...stamp(),
      type: 'injury',
      site: i.site,
      severity: i.severity,
      resolved: false,
      ...(i.note !== undefined ? { note: i.note } : {}),
    };
    events.push(event);
  }
  for (const l of parsed.levers) {
    const event: LeverMeasurementEvent = {
      ...stamp(),
      type: 'lever-measurement',
      lever: l.lever,
      value: l.value,
      unit: l.unit,
      ...(l.lever === 'waistCm' ? { typicalError: 1 } : {}),
    };
    events.push(event);
  }
  for (const r of parsed.recoverySignals) {
    const event: RecoverySignalEvent = {
      ...stamp(),
      type: 'recovery-signal',
      signal: r.signal,
      value: r.value,
    };
    events.push(event);
  }
  return { note, events };
}
