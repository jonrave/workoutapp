import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryOuraCredentialStore } from '../src/credentials';

const root = new URL('../../..', import.meta.url).pathname;

describe('InMemoryOuraCredentialStore', () => {
  const pair = { accessToken: 'at1', refreshToken: 'rt1', expiresAt: 1_755_600_000_000 };

  it('round-trips credentials and starts empty', async () => {
    const store = new InMemoryOuraCredentialStore();
    expect(await store.load()).toBeNull();
    await store.save(pair);
    expect(await store.load()).toEqual(pair);
  });

  it('a simulated persistence failure leaves the previous pair intact', async () => {
    const store = new InMemoryOuraCredentialStore(pair);
    store.failNextSave = true;
    await expect(store.save({ ...pair, refreshToken: 'rt2' })).rejects.toThrow(/persistence/);
    expect((await store.load())?.refreshToken).toBe('rt1');
  });
});

describe('credentials schema', () => {
  it('embedded schema matches migrations/003_oura_credentials.sql', () => {
    const migration = readFileSync(`${root}/packages/store/migrations/003_oura_credentials.sql`, 'utf8');
    const embedded = readFileSync(`${root}/packages/store/src/postgres-credentials.ts`, 'utf8');
    const createStmt = migration.slice(migration.indexOf('CREATE TABLE'));
    expect(embedded).toContain(createStmt.trim());
  });
});
