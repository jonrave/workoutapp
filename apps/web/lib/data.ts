/**
 * Server-side data layer: one event log + the subject seed, projected on
 * demand. The engine stays pure — this module does the I/O around it (I1).
 *
 * With DATABASE_URL set, events persist in Postgres; otherwise an in-memory
 * log seeded with a few demo measurements backs the local demo.
 */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { decide, type Decision, type EngineEvent, type UserState } from '@peakspan/engine';
import { fitnessMeasurement, leverMeasurement } from '@peakspan/adapters';
import { InMemoryEventLog, projectState, type EventLog } from '@peakspan/store';

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'fixtures', 'subjects', 'subject-a.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate fixtures/subjects/subject-a.json from ' + process.cwd());
}

export function loadSeed(): UserState {
  const root = findRepoRoot();
  return JSON.parse(
    readFileSync(path.join(root, 'fixtures', 'subjects', 'subject-a.json'), 'utf8'),
  ) as UserState;
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
}

interface AppStore {
  log: EventLog;
  seed: UserState;
  ready: Promise<void>;
}

const g = globalThis as unknown as { __peakspan?: AppStore };

export function getStore(): AppStore {
  if (!g.__peakspan) {
    const seed = loadSeed();
    if (process.env.DATABASE_URL) {
      // Deferred import keeps pg out of the demo path.
      const store: AppStore = { log: undefined as unknown as EventLog, seed, ready: Promise.resolve() };
      store.ready = import('@peakspan/store/postgres').then((m) => {
        store.log = m.PostgresEventLog.fromConnectionString(process.env.DATABASE_URL!);
      });
      g.__peakspan = store;
    } else {
      const log = new InMemoryEventLog();
      g.__peakspan = { log, seed, ready: seedDemoEvents(log) };
    }
  }
  return g.__peakspan;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
