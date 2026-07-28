/**
 * Free-text activity parsing (I2a): an LLM may parse logs into structured
 * events, never choose training. The parser returns a DRAFT the user must
 * confirm; only the confirmed ActivityEvent enters the log.
 */
import type { IsoDate, Modality, Pillar, TissueChannel } from '@peakspan/engine';

export interface DraftActivity {
  modality: Modality;
  durationMinutes: number;
  sRPE: number;
  description: string;
  pillarLoad: Partial<Record<Pillar, number>>;
  tissueChannels: TissueChannel[];
  confidence: 'high' | 'medium' | 'low';
  /** Always true: a draft never enters the event log without user confirmation. */
  needsConfirmation: true;
}

export interface ActivityParser {
  parse(text: string, date: IsoDate): Promise<DraftActivity>;
}

/**
 * Deterministic keyword parser for tests and offline use. Deliberately crude —
 * the point is the interface and the confirmation flow, not the parsing.
 */
export class StubActivityParser implements ActivityParser {
  async parse(text: string, _date: IsoDate): Promise<DraftActivity> {
    const lower = text.toLowerCase();
    const minutes = /(\d+)\s*(?:min|minute)/.exec(lower)?.[1];
    const durationMinutes = minutes ? Number(minutes) : 60;
    let modality: Modality = 'other';
    let sRPE = 5;
    let tissueChannels: TissueChannel[] = [];
    let pillar: Pillar = 'zone2';

    if (/(soccer|football|basketball|match|game)/.test(lower)) {
      modality = 'other';
      sRPE = 8;
      pillar = 'vo2max';
      tissueChannels = ['hamstringHighVelocity', 'connectiveHighVelocity', 'kneeExtensor'];
    } else if (/hike/.test(lower)) {
      modality = 'hike';
      sRPE = 5;
      tissueChannels = ['kneeExtensor', 'calfAchillesHighVelocity'];
    } else if (/(run|jog)/.test(lower)) {
      modality = 'run';
      sRPE = /(hard|race|interval|tempo)/.test(lower) ? 8 : 4;
      pillar = sRPE >= 7 ? 'vo2max' : 'zone2';
      tissueChannels = ['calfAchillesHighVelocity', 'kneeExtensor', 'hipExtensor'];
    } else if (/(lift|gym|squat|deadlift|bench)/.test(lower)) {
      modality = 'lift';
      sRPE = 7;
      pillar = 'maxStrength';
      tissueChannels = ['axialCompression', 'kneeExtensor', 'hipExtensor', 'upperPush', 'upperPull'];
    }

    const load = sRPE * durationMinutes;
    return {
      modality,
      durationMinutes,
      sRPE,
      description: text.trim(),
      pillarLoad: { [pillar]: load },
      tissueChannels,
      confidence: 'low',
      needsConfirmation: true,
    };
  }
}
