import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresOuraCredentialStore } from '@peakspan/store/postgres';
import { exchangeAuthorizationCode } from '@peakspan/adapters';
import { main } from '../../../scripts/oura-auth-helper';

vi.mock('@peakspan/store/postgres', () => ({
  PostgresOuraCredentialStore: { fromConnectionString: vi.fn() },
}));
vi.mock('@peakspan/adapters', async (importOriginal) => ({
  ...await importOriginal<typeof import('@peakspan/adapters')>(),
  exchangeAuthorizationCode: vi.fn(),
}));

const pair = { accessToken: 'access-canary', refreshToken: 'refresh-canary', expiresAt: 123456 };
let store: { checkAccess: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let consoleLog: ReturnType<typeof vi.spyOn>;
let ready: Promise<string>;

beforeEach(async () => {
  const reservation = http.createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  vi.stubEnv('OURA_CLIENT_ID', 'client-canary');
  vi.stubEnv('OURA_CLIENT_SECRET', 'secret-canary');
  vi.stubEnv('DATABASE_URL', 'postgresql://test.invalid/test');
  vi.stubEnv('OURA_REDIRECT_URI', `http://127.0.0.1:${port}/callback`);
  store = { checkAccess: vi.fn(async () => {}), save: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  vi.mocked(PostgresOuraCredentialStore.fromConnectionString).mockReturnValue(store as unknown as PostgresOuraCredentialStore);
  vi.mocked(exchangeAuthorizationCode).mockReset().mockResolvedValue(pair);
  let resolveReady!: (url: string) => void;
  ready = new Promise((resolve) => { resolveReady = resolve; });
  consoleLog = vi.spyOn(console, 'log').mockImplementation((text: string) => {
    if (text.startsWith('https://cloud.ouraring.com/oauth/authorize?')) resolveReady(text);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('local Oura consent helper', () => {
  it('rejects an unsolicited callback, then persists valid consent without printing tokens', async () => {
    const running = main();
    const consent = new URL(await ready);
    expect(consent.searchParams.get('scope')).toBe('daily');
    expect(consent.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
    const callback = new URL(consent.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'code-canary');
    callback.searchParams.set('state', 'invalid-state');
    expect((await fetch(callback)).status).toBe(400);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    callback.searchParams.set('state', consent.searchParams.get('state')!);
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await running;
    expect(store.save).toHaveBeenCalledWith(pair);
    expect(store.close).toHaveBeenCalled();
    expect(consoleLog.mock.calls.flat().join('\n')).not.toMatch(/access-canary|refresh-canary|secret-canary|code-canary/);
  });

  it('checks database access before presenting any consent URL', async () => {
    store.checkAccess.mockRejectedValue(new Error('missing UPDATE privilege'));
    await expect(main()).rejects.toThrow('missing UPDATE privilege');
    expect(consoleLog).not.toHaveBeenCalled();
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalled();
  });

  it('does not expose a token-bearing persistence error in the callback or error message', async () => {
    store.save.mockRejectedValue(new Error('failed row: access-canary refresh-canary'));
    const running = main().catch((error: Error) => error);
    const consent = new URL(await ready);
    const callback = new URL(consent.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', consent.searchParams.get('state')!);
    callback.searchParams.set('code', 'code-canary');
    const response = await fetch(callback);
    expect(response.status).toBe(500);
    const message = `${await response.text()} ${(await running as Error).message}`;
    expect(message).not.toMatch(/access-canary|refresh-canary|code-canary/);
    expect(store.close).toHaveBeenCalled();
  });
});
