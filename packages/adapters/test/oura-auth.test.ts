import { describe, expect, it } from 'vitest';
import {
  OURA_TOKEN_URL,
  OuraClient,
  OuraOAuth,
  StaticTokenAuth,
  TokenPersistenceError,
  buildConsentUrl,
  type OuraCredentials,
  type OuraTokenStore,
} from '../src/index';

/** In-memory token store that records call order and can fail on demand. */
class FakeStore implements OuraTokenStore {
  public saves: OuraCredentials[] = [];
  public failSave = false;
  constructor(
    private credentials: OuraCredentials | null,
    private readonly journal: string[] = [],
  ) {}
  async load() {
    return this.credentials ? { ...this.credentials } : null;
  }
  async save(c: OuraCredentials) {
    if (this.failSave) throw new Error('disk on fire');
    this.journal.push('save');
    this.saves.push({ ...c });
    this.credentials = { ...c };
  }
}

const NOW = 1_755_600_000_000;
const live: OuraCredentials = { accessToken: 'at1', refreshToken: 'rt1', expiresAt: NOW + 3600_000 };
const expired: OuraCredentials = { accessToken: 'at1', refreshToken: 'rt1', expiresAt: NOW - 1 };

/**
 * Fake Oura backend enforcing single-use refresh tokens: each refresh
 * invalidates the presented token and issues the next pair. Data requests
 * demand the newest access token.
 */
function fakeOura(journal: string[] = []) {
  let liveRefreshToken = 'rt1';
  let liveAccessToken: string | null = null;
  let serial = 1;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) === OURA_TOKEN_URL) {
      journal.push('refresh');
      const presented = new URLSearchParams(String(init?.body)).get('refresh_token');
      if (presented !== liveRefreshToken) {
        return { ok: false, status: 401, text: async () => 'refresh token already used' };
      }
      serial += 1;
      liveRefreshToken = `rt${serial}`;
      liveAccessToken = `at${serial}`;
      return {
        ok: true,
        json: async () => ({
          access_token: liveAccessToken,
          refresh_token: liveRefreshToken,
          expires_in: 86400,
        }),
      };
    }
    journal.push('data');
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    if (liveAccessToken && auth !== `Bearer ${liveAccessToken}`) {
      return { ok: false, status: 401, text: async () => 'bad access token' };
    }
    return { ok: true, json: async () => ({ data: [], next_token: null }) };
  }) as unknown as typeof fetch;
  return { fetchImpl, journal };
}

describe('StaticTokenAuth', () => {
  it('returns the token without touching the network', async () => {
    expect(await new StaticTokenAuth('pat').accessToken()).toBe('pat');
  });
});

describe('OuraOAuth refresh rotation', () => {
  it('uses the stored token untouched while it is fresh', async () => {
    const { fetchImpl, journal } = fakeOura();
    const auth = new OuraOAuth('id', 'secret', new FakeStore(live), fetchImpl, () => NOW);
    expect(await auth.accessToken()).toBe('at1');
    expect(journal).toEqual([]);
  });

  it('persists the rotated pair before any data request is made', async () => {
    const journal: string[] = [];
    const { fetchImpl } = fakeOura(journal);
    const store = new FakeStore(expired, journal);
    const client = new OuraClient(new OuraOAuth('id', 'secret', store, fetchImpl, () => NOW), fetchImpl);
    await client.pullSleepDocs('2026-08-01', '2026-08-19');
    expect(journal).toEqual(['refresh', 'save', 'data']);
    expect(store.saves[0]).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2' });
  });

  it('aborts before any data request when persistence fails (the primary failure mode)', async () => {
    const journal: string[] = [];
    const { fetchImpl } = fakeOura(journal);
    const store = new FakeStore(expired, journal);
    store.failSave = true;
    const client = new OuraClient(new OuraOAuth('id', 'secret', store, fetchImpl, () => NOW), fetchImpl);
    await expect(client.pullSleepDocs('2026-08-01', '2026-08-19')).rejects.toThrow(
      TokenPersistenceError,
    );
    expect(journal).toEqual(['refresh']); // no save, and crucially no data call
  });

  it('survives rotation across two consecutive runs against a single-use backend', async () => {
    const { fetchImpl } = fakeOura();
    const store = new FakeStore(expired);
    // Run 1: fresh process, expired credentials, refresh rotates rt1 -> rt2.
    expect(
      await new OuraOAuth('id', 'secret', store, fetchImpl, () => NOW).accessToken(),
    ).toBe('at2');
    // Run 2: another fresh process a day later; must present rt2, not the dead rt1.
    const dayLater = NOW + 86400_000;
    expect(
      await new OuraOAuth('id', 'secret', store, fetchImpl, () => dayLater).accessToken(),
    ).toBe('at3');
    expect(store.saves.map((s) => s.refreshToken)).toEqual(['rt2', 'rt3']);
  });

  it('reusing a dead refresh token fails loudly (what happens if persistence had been skipped)', async () => {
    const { fetchImpl } = fakeOura();
    await new OuraOAuth('id', 'secret', new FakeStore(expired), fetchImpl, () => NOW).accessToken();
    // A second store still holding rt1 simulates a run that lost the rotation.
    const stale = new FakeStore(expired);
    await expect(
      new OuraOAuth('id', 'secret', stale, fetchImpl, () => NOW).accessToken(),
    ).rejects.toThrow(/refresh token already used/);
  });

  it('fails with guidance when the store was never seeded', async () => {
    const { fetchImpl } = fakeOura();
    await expect(
      new OuraOAuth('id', 'secret', new FakeStore(null), fetchImpl, () => NOW).accessToken(),
    ).rejects.toThrow(/auth-helper/);
  });
});

describe('consent URL', () => {
  it('targets the documented authorize endpoint with the requested scopes', () => {
    const url = new URL(buildConsentUrl('cid', 'http://localhost:8484/callback', ['daily'], 's1'));
    expect(url.origin + url.pathname).toBe('https://cloud.ouraring.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('scope')).toBe('daily');
    expect(url.searchParams.get('state')).toBe('s1');
  });
});
