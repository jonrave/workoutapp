import { describe, expect, it } from 'vitest';
import { authHelperConfig, checkSyncConfig, safeErrorMessage } from '../../../scripts/oura-config';

const oauth = {
  OURA_CLIENT_ID: 'client-canary',
  OURA_CLIENT_SECRET: 'secret-canary',
  DATABASE_URL: 'postgresql://user:password-canary@localhost/db',
};

describe('Oura setup configuration', () => {
  it('identifies every missing OAuth setting without echoing configured values', () => {
    expect(() => checkSyncConfig({})).toThrow('OURA_CLIENT_ID, OURA_CLIENT_SECRET, DATABASE_URL');
    expect(() => checkSyncConfig({ OURA_CLIENT_SECRET: oauth.OURA_CLIENT_SECRET }))
      .toThrow('OURA_CLIENT_ID, DATABASE_URL');
  });

  it('requires a database even with a static token when ingest is enabled', () => {
    expect(() => checkSyncConfig({ OURA_TOKEN: 'token-canary' })).toThrow('DATABASE_URL');
    expect(() => checkSyncConfig({ OURA_TOKEN: 'token-canary', GATE_SKIP_INGEST: '1' })).not.toThrow();
    expect(() => checkSyncConfig({ ...oauth, DATABASE_URL: '', GATE_SKIP_INGEST: '1' })).toThrow('DATABASE_URL');
    expect(() => checkSyncConfig(oauth)).not.toThrow();
  });

  it('requires durable storage before authorization and defaults to the registered loopback URL', () => {
    expect(() => authHelperConfig({ ...oauth, DATABASE_URL: '' })).toThrow('DATABASE_URL');
    expect(authHelperConfig(oauth).redirectUri).toBe('http://localhost:8484/callback');
  });

  it.each([
    'https://example.com/callback', 'http://0.0.0.0:8484/callback',
    'http://user:password@localhost:8484/callback', 'http://localhost:8484/callback?code=private',
    'http://localhost:0/callback', 'not a url',
  ])('rejects unsupported redirect %s', (redirect) => {
    expect(() => authHelperConfig({ ...oauth, OURA_REDIRECT_URI: redirect })).toThrow('OURA_REDIRECT_URI');
  });

  it('redacts credentials and database URLs from dependency errors', () => {
    const msg = safeErrorMessage(new Error(Object.values(oauth).join(' ')), oauth);
    for (const value of Object.values(oauth)) expect(msg).not.toContain(value);
    expect(safeErrorMessage(new Error('failed postgresql://user:private@host/db'), {})).not.toContain('private');
  });
});
