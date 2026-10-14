import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventLog, InMemoryOuraCredentialStore } from '@peakspan/store';
import { PostgresEventLog, PostgresOuraCredentialStore } from '@peakspan/store/postgres';
import { main } from '../../../scripts/oura-gate-sync';

vi.mock('@peakspan/store/postgres', () => ({
  PostgresEventLog: { fromConnectionString: vi.fn() },
  PostgresOuraCredentialStore: { fromConnectionString: vi.fn() },
}));

let dir: string;
let log: InMemoryEventLog & { close: ReturnType<typeof vi.fn> };
let credentials: InMemoryOuraCredentialStore & { close: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
let output: ReturnType<typeof vi.spyOn>;
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'oura-sync-test-'));
  vi.stubEnv('GATE_OUTPUT_DIR', dir);
  vi.stubEnv('GATE_SKIP_INGEST', '');
  vi.stubEnv('OURA_TOKEN', '');
  vi.stubEnv('OURA_CLIENT_ID', 'client-canary');
  vi.stubEnv('OURA_CLIENT_SECRET', 'secret-canary');
  vi.stubEnv('DATABASE_URL', 'postgresql://test.invalid/test');
  log = Object.assign(new InMemoryEventLog(), { close: vi.fn(async () => {}) });
  credentials = Object.assign(new InMemoryOuraCredentialStore({
    accessToken: 'access-canary', refreshToken: 'refresh-canary', expiresAt: Date.now() - 1,
  }), { close: vi.fn(async () => {}) });
  vi.mocked(PostgresEventLog.fromConnectionString).mockReturnValue(log as unknown as PostgresEventLog);
  vi.mocked(PostgresOuraCredentialStore.fromConnectionString).mockReturnValue(credentials as unknown as PostgresOuraCredentialStore);
  let refreshSerial = 0;
  fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('refresh_token')).toBe(refreshSerial ? `refresh-${refreshSerial}` : 'refresh-canary');
      refreshSerial++;
      return Response.json({ access_token: `access-${refreshSerial}`, refresh_token: `refresh-${refreshSerial}`, expires_in: 3600 });
    }
    // A data call may only see the already-persisted rotated access token.
    const saved = await credentials.load();
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${saved?.accessToken}`);
    return Response.json({ data: url.includes('/daily_readiness')
      ? [{ day: today(), score: 82, temperature_deviation: -0.12 }]
      : [{ day: today(), average_hrv: 68, lowest_heart_rate: 44, total_sleep_duration: 26100, type: 'long_sleep' }], next_token: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('Oura sync CLI using simulated API and persistence', () => {
  it('rotates, ingests, and writes artifacts across two runs without duplicate events', async () => {
    await main();
    expect(await log.read()).toHaveLength(4);
    const first = (await credentials.load())!;
    await credentials.save({ ...first, expiresAt: Date.now() - 1 });
    await main();
    expect((await credentials.load())?.refreshToken).toBe('refresh-2');
    expect(await log.read()).toHaveLength(4);
    const csv = await readFile(path.join(dir, 'gate_series.csv'), 'utf8');
    const md = await readFile(path.join(dir, 'gate_current.md'), 'utf8');
    expect(csv.trim().split('\n')).toHaveLength(181);
    expect(csv).toContain(`${today()},82,44,68,-0.12,7.25,ok`);
    expect(md).toMatch(/^generated_at: /);
    expect(md.match(/^\| \d{4}-\d{2}-\d{2} /gm)).toHaveLength(14);
    expect(output.mock.calls.flat().join('\n')).toContain('Ingest: 0 event(s) appended');
    expect(output.mock.calls.flat().join('\n')).not.toMatch(/access-canary|refresh-canary|secret-canary|access-1|refresh-1/);
    expect(credentials.close).toHaveBeenCalledTimes(2);
  });

  it.each(['empty', 'api', 'ingest', 'persistence'])('preserves prior artifacts on %s failure', async (failure) => {
    for (const name of ['gate_current.md', 'gate_series.csv']) await writeFile(path.join(dir, name), 'prior artifact');
    if (failure === 'empty') fetchMock.mockImplementation(async () => Response.json({ data: [], next_token: null }));
    if (failure === 'api') fetchMock.mockImplementation(async () => new Response('secret-response-canary', { status: 401 }));
    if (failure === 'ingest') vi.spyOn(log, 'append').mockRejectedValue(new Error('simulated database failure'));
    if (failure === 'persistence') credentials.failNextSave = true;
    if (failure === 'empty' || failure === 'api') {
      await credentials.save({ accessToken: 'access-canary', refreshToken: 'refresh-canary', expiresAt: Date.now() + 3600_000 });
    }
    const error = await main().catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secret-response-canary');
    for (const name of ['gate_current.md', 'gate_series.csv']) expect(await readFile(path.join(dir, name), 'utf8')).toBe('prior artifact');
    expect(credentials.close).toHaveBeenCalled();
    if (failure === 'persistence') expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails before any API request or file changes when the workflow configuration is empty', async () => {
    vi.stubEnv('OURA_CLIENT_ID', '');
    vi.stubEnv('OURA_CLIENT_SECRET', '');
    vi.stubEnv('DATABASE_URL', '');
    await expect(main()).rejects.toThrow('OURA_CLIENT_ID, OURA_CLIENT_SECRET, DATABASE_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
