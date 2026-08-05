/**
 * Strava adapter — activities in, pillar + tissue load out (§6: unplanned
 * activity is classified into load, not into calories or minutes). Strava's
 * "suffer score" and relative effort are vendor composites and are never
 * mapped (I4); sRPE comes from the athlete's logged perceived exertion when
 * present, otherwise from a per-sport convention.
 */
import type { ActivityEvent, Modality, Pillar, TissueChannel } from '@peakspan/engine';
import { activity, defaultContext, type EventContext } from './manual';

/** Subset of a Strava API v3 SummaryActivity we consume. */
export interface StravaActivityV3 {
  id: number | string;
  name?: string;
  /** e.g. 'Run' | 'TrailRun' | 'Ride' | 'WeightTraining' | 'Soccer' | 'Hike'. */
  sport_type?: string;
  /** Legacy field on older payloads. */
  type?: string;
  /** Seconds. */
  moving_time: number;
  start_date_local?: string;
  start_date?: string;
  /** 1–10 when the athlete logged it. */
  perceived_exertion?: number | null;
}

interface SportProfile {
  modality: Modality;
  defaultSrpe: number;
  pillars: Partial<Record<Pillar, number>>;
  tissue: Partial<Record<TissueChannel, number>>;
}

// Conventions, mirroring the free-text classifier in the client app.
const SPORT_PROFILES = {
  run: {
    modality: 'run', defaultSrpe: 6,
    pillars: { vo2max: 0.3, zone2: 0.7 },
    tissue: { kneeExtensor: 0.3, calfAchillesHighVelocity: 0.3, hipExtensor: 0.2, connectiveHighVelocity: 0.2 },
  },
  ride: {
    modality: 'spinBike', defaultSrpe: 5,
    pillars: { zone2: 0.8, vo2max: 0.2 },
    tissue: { kneeExtensor: 0.7, hipExtensor: 0.3 },
  },
  weighttraining: {
    modality: 'lift', defaultSrpe: 7,
    pillars: { maxStrength: 0.85, power: 0.15 },
    tissue: { kneeExtensor: 0.25, hipExtensor: 0.25, upperPush: 0.2, upperPull: 0.2, axialCompression: 0.1 },
  },
  hike: {
    modality: 'hike', defaultSrpe: 3.5,
    pillars: { zone2: 1 },
    tissue: { kneeExtensor: 0.4, hipExtensor: 0.3, calfAchillesHighVelocity: 0.3 },
  },
  swim: {
    modality: 'swim', defaultSrpe: 5,
    pillars: { zone2: 0.8, vo2max: 0.2 },
    tissue: { upperPull: 0.5, upperPush: 0.3, shoulderOverhead: 0.2 },
  },
  rowing: {
    modality: 'row', defaultSrpe: 6,
    pillars: { zone2: 0.7, vo2max: 0.3 },
    tissue: { upperPull: 0.4, hipExtensor: 0.4, kneeExtensor: 0.2 },
  },
  sport: {
    modality: 'other', defaultSrpe: 8,
    pillars: { vo2max: 0.5, zone2: 0.3, power: 0.2 },
    tissue: { hamstringHighVelocity: 0.25, connectiveHighVelocity: 0.25, calfAchillesHighVelocity: 0.2, kneeExtensor: 0.2, hipExtensor: 0.1 },
  },
  mobility: {
    modality: 'other', defaultSrpe: 2,
    pillars: { mobility: 1 },
    tissue: {},
  },
  other: {
    modality: 'other', defaultSrpe: 6,
    pillars: { zone2: 0.6, vo2max: 0.4 },
    tissue: { kneeExtensor: 0.3, hipExtensor: 0.3, connectiveHighVelocity: 0.2, calfAchillesHighVelocity: 0.2 },
  },
} satisfies Record<string, SportProfile>;

const SPORT_ALIASES: Record<string, keyof typeof SPORT_PROFILES> = {
  run: 'run', trailrun: 'run', virtualrun: 'run',
  ride: 'ride', virtualride: 'ride', gravelride: 'ride', mountainbikeride: 'ride', ebikeride: 'ride',
  weighttraining: 'weighttraining', workout: 'weighttraining', crossfit: 'weighttraining',
  hike: 'hike', walk: 'hike', snowshoe: 'hike',
  swim: 'swim',
  rowing: 'rowing', virtualrow: 'rowing', kayaking: 'rowing', canoeing: 'rowing',
  soccer: 'sport', tennis: 'sport', squash: 'sport', badminton: 'sport',
  pickleball: 'sport', racquetball: 'sport', tablet_tennis: 'sport',
  yoga: 'mobility', pilates: 'mobility', stretching: 'mobility',
};

export function classifyStravaSport(sportType: string, name = ''): SportProfile & { hard?: boolean } {
  const key = sportType.toLowerCase().replace(/[^a-z]/g, '');
  const profile = SPORT_PROFILES[SPORT_ALIASES[key] ?? 'other'];
  if (profile === SPORT_PROFILES.run && /interval|tempo|track|fartlek|race|5k|10k/i.test(name)) {
    return {
      ...profile, defaultSrpe: 8.5,
      pillars: { vo2max: 0.8, zone2: 0.2 },
      tissue: { calfAchillesHighVelocity: 0.3, hamstringHighVelocity: 0.25, kneeExtensor: 0.2, hipExtensor: 0.15, connectiveHighVelocity: 0.1 },
      hard: true,
    };
  }
  return profile;
}

/** Map one Strava activity to an engine ActivityEvent with a stable id. */
export function mapStravaActivity(
  raw: StravaActivityV3,
  ctx: EventContext = defaultContext,
): ActivityEvent | null {
  const started = raw.start_date_local ?? raw.start_date;
  if (!started || !raw.moving_time) return null;
  const day = started.slice(0, 10);
  const minutes = Math.max(1, Math.round(raw.moving_time / 60));
  const profile = classifyStravaSport(raw.sport_type ?? raw.type ?? '', raw.name ?? '');
  const sRPE =
    raw.perceived_exertion != null && raw.perceived_exertion >= 1 && raw.perceived_exertion <= 10
      ? raw.perceived_exertion
      : profile.defaultSrpe;
  const total = sRPE * minutes;
  const scale = (weights: Partial<Record<string, number>>) => {
    const sum = Object.values(weights).reduce((s: number, x) => s + (x ?? 0), 0) || 1;
    return Object.fromEntries(
      Object.entries(weights).map(([k, w]) => [k, Math.round(total * ((w ?? 0) / sum))]),
    );
  };
  const event = activity(
    {
      planned: false,
      plannedSlot: null,
      modality: profile.modality,
      durationMinutes: minutes,
      sRPE,
      occurredAt: `${day}T12:00:00Z`,
      pillarLoad: scale(profile.pillars) as Partial<Record<Pillar, number>>,
      tissueLoad: scale(profile.tissue) as Partial<Record<TissueChannel, number>>,
      description: `${raw.name ?? raw.sport_type ?? 'Activity'} (from Strava)`,
    },
    ctx,
  );
  // Stable id makes overlapping pulls idempotent; source reflects the origin.
  return { ...event, id: `strava_${raw.id}`, source: 'device-raw' };
}

/**
 * Minimal Strava API v3 client with refresh-token flow. Network stays at the
 * adapter edge; the engine never sees it (I1).
 */
export class StravaClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    const res = await this.fetchImpl('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Strava token refresh ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { access_token: string };
    return body.access_token;
  }

  async pullSince(afterEpochSeconds: number, ctx: EventContext = defaultContext): Promise<ActivityEvent[]> {
    const token = await this.accessToken();
    const events: ActivityEvent[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await this.fetchImpl(
        `https://www.strava.com/api/v3/athlete/activities?after=${afterEpochSeconds}&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`Strava API ${res.status}: ${await res.text()}`);
      const batch = (await res.json()) as StravaActivityV3[];
      for (const raw of batch) {
        const ev = mapStravaActivity(raw, ctx);
        if (ev) events.push(ev);
      }
      if (batch.length < 100) break;
    }
    return events;
  }
}
