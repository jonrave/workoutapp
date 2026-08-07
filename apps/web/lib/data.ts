/**
 * Server-side data layer: one event log + the subject seed, projected on
 * demand. The engine stays pure — this module does the I/O around it (I1).
 *
 * With DATABASE_URL set, events persist in Postgres; otherwise an in-memory
 * log seeded with a few demo measurements backs the local demo.
 */
import { decide, type Decision, type EngineEvent, type UserState } from '@peakspan/engine';
import { fitnessMeasurement, leverMeasurement, recoverySignal } from '@peakspan/adapters';
import {
  InMemoryConversationStore,
  InMemoryEventLog,
  projectState,
  type ConversationStore,
  type EventLog,
  type MemoryStore,
} from '@peakspan/store';
// Static import, not a runtime readFileSync: the seed must be compiled into
// the bundle so it survives serverless deployment, where the repo's fixtures
// directory is not on disk next to the running function.
import subjectA from '../../../fixtures/subjects/subject-a.json';

export function loadSeed(): UserState {
  // structuredClone so per-request projection never mutates the shared module.
  return structuredClone(subjectA) as unknown as UserState;
}

/** Deterministic demo history so trend views have something to draw. */
async function seedDemoEvents(log: EventLog): Promise<void> {
  const ctx = (() => {
    let n = 0;
    return { id: () => `demo_${++n}`, now: () => '2026-07-27T12:00:00Z' };
  })();
  const cmj = [40.9, 41.4, 40.6, 41.8, 41.1, 42.0, 41.3, 41.5];
  const waist = [85.2, 85.0, 84.8, 84.9, 84.6, 84.7, 84.4, 84.5];
  for (let i = 0; i < 8; i++) {
    const date = new Date(Date.UTC(2026, 5, 8 + i * 7)).toISOString();
    await log.append(
      fitnessMeasurement(
        { metric: 'cmjHeight', value: cmj[i]!, unit: 'cm', occurredAt: date, source: 'measured-field' },
        ctx,
      ),
    );
    await log.append(
      leverMeasurement(
        { lever: 'waistCm', value: waist[i]!, unit: 'cm', occurredAt: date, source: 'measured-field' },
        ctx,
      ),
    );
  }

  // 60 days of nightly wearable signals so the recovery trend charts (and the
  // I5 baselines derived from them) have something to draw. Deterministic:
  // a gentle weekly wave plus a fixed pseudo-noise term, no RNG.
  for (let i = 0; i < 60; i++) {
    const date = new Date(Date.UTC(2026, 5, 8 + i, 6)).toISOString();
    const wave = Math.sin((i / 7) * Math.PI);
    const jitter = ((i * 37) % 10) / 10 - 0.45; // fixed sequence in [-0.45, 0.45]
    const signals = [
      { signal: 'hrvLnRmssd' as const, value: Math.round((4.25 + 0.08 * wave + 0.05 * jitter) * 1000) / 1000 },
      { signal: 'restingHr' as const, value: Math.round((47 - 1.5 * wave + jitter) * 10) / 10 },
      { signal: 'sleepDurationHours' as const, value: Math.round((7.3 + 0.4 * wave + 0.5 * jitter) * 100) / 100 },
    ];
    for (const s of signals) {
      await log.append(recoverySignal({ ...s, occurredAt: date, source: 'device-raw' }, ctx));
    }
  }
}

interface AppStore {
  log: EventLog;
  /** Chat transcripts + distilled memory. Never read by the engine (I2). */
  chat: ConversationStore & MemoryStore;
  seed: UserState;
  ready: Promise<void>;
}

const g = globalThis as unknown as { __peakspan?: AppStore };

export function getStore(): AppStore {
  if (!g.__peakspan) {
    const seed = loadSeed();
    if (process.env.DATABASE_URL) {
      // Deferred import keeps pg out of the demo path.
      const store: AppStore = {
        log: undefined as unknown as EventLog,
        chat: undefined as unknown as ConversationStore & MemoryStore,
        seed,
        ready: Promise.resolve(),
      };
      store.ready = import('@peakspan/store/postgres').then((m) => {
        store.log = m.PostgresEventLog.fromConnectionString(process.env.DATABASE_URL!);
        store.chat = m.PostgresConversationStore.fromConnectionString(process.env.DATABASE_URL!);
      });
      g.__peakspan = store;
    } else {
      const log = new InMemoryEventLog();
      g.__peakspan = { log, chat: new InMemoryConversationStore(), seed, ready: seedDemoEvents(log) };
    }
  }
  return g.__peakspan;
}

export async function getChatStore(): Promise<ConversationStore & MemoryStore> {
  const store = getStore();
  await store.ready;
  return store.chat;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * True when the event log is in-memory. Locally that just means "resets on
 * restart"; on serverless it means writes do not survive between requests,
 * because each invocation may land on a fresh instance. Surfaced in the UI so
 * a demo deployment never looks broken when a logged event disappears.
 */
export function isEphemeral(): boolean {
  return !process.env.DATABASE_URL;
}

/** Set by Vercel and most serverless hosts; used only for the warning copy. */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function currentState(): Promise<UserState> {
  const store = getStore();
  await store.ready;
  const events: EngineEvent[] = await store.log.read();
  return projectState(store.seed, events, todayIso());
}

export async function currentDecision(): Promise<{ state: UserState; decision: Decision }> {
  const state = await currentState();
  return { state, decision: decide(state, todayIso()) };
}

export async function appendEvent(event: EngineEvent): Promise<void> {
  const store = getStore();
  await store.ready;
  await store.log.append(event);
}

export async function readEvents(): Promise<EngineEvent[]> {
  const store = getStore();
  await store.ready;
  return store.log.read();
}
