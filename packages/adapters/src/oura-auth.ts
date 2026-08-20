/**
 * Oura auth. Oura deprecated personal access tokens in December 2025: new
 * PATs cannot be created and new integrations must use the OAuth2
 * authorization code flow (cloud.ouraring.com/docs/authentication). A
 * previously issued PAT that still authenticates can be used via
 * `StaticTokenAuth`; everything else goes through `OuraOAuth`.
 *
 * Oura refresh tokens are single use: every refresh returns a new refresh
 * token and invalidates the old one. Losing the rotated token strands every
 * future run, so `OuraOAuth` persists the rotated credentials BEFORE
 * releasing an access token for data use, and a persistence failure aborts
 * (`TokenPersistenceError`) instead of continuing on a token the process is
 * about to lose. Network stays at the adapter edge; the engine never sees
 * it (I1).
 */

export const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
export const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';

/** convention: refresh this many seconds before nominal expiry to absorb clock skew. */
export const TOKEN_EXPIRY_SKEW_SECONDS = 300;

export interface OuraCredentials {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

/**
 * Where rotated credentials live between runs. Implementations must make
 * `save` durable before resolving: `OuraOAuth` treats a resolved save as
 * proof the rotated refresh token survives a process crash.
 */
export interface OuraTokenStore {
  load(): Promise<OuraCredentials | null>;
  save(credentials: OuraCredentials): Promise<void>;
}

/** Anything that can produce a currently-valid bearer token for data calls. */
export interface OuraAuth {
  accessToken(): Promise<string>;
}

/** A static bearer token (a still-live PAT). No rotation, no state. */
export class StaticTokenAuth implements OuraAuth {
  constructor(private readonly token: string) {}
  async accessToken(): Promise<string> {
    return this.token;
  }
}

/**
 * Raised when refreshed credentials could not be persisted. The run must
 * abort: the old refresh token is already invalid (single use), so
 * continuing would leave the store holding dead credentials and every
 * subsequent run unauthenticated.
 */
export class TokenPersistenceError extends Error {
  constructor(cause: unknown) {
    super(
      'Refreshed Oura credentials could not be persisted. Aborting before any data ' +
        'request: the old refresh token is already invalidated (Oura refresh tokens ' +
        'are single use), so continuing now would strand every future run. ' +
        `Persistence failure: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'TokenPersistenceError';
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds until expiry. */
  expires_in: number;
}

async function postToken(
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<OuraCredentials> {
  const res = await fetchImpl(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`Oura token endpoint ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as TokenResponse;
  if (!body.access_token || !body.refresh_token) {
    throw new Error('Oura token endpoint returned no token pair');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now() + (body.expires_in ?? 0) * 1000,
  };
}

/** Consent URL for the one-time browser authorization (auth helper). */
export function buildConsentUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[] = ['daily', 'personal'],
  state?: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
  });
  if (state) params.set('state', state);
  return `${OURA_AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchange the authorization code from the consent redirect for a token pair. */
export async function exchangeAuthorizationCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<OuraCredentials> {
  return postToken(
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    fetchImpl,
    now,
  );
}

export class OuraOAuth implements OuraAuth {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly store: OuraTokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Returns a valid access token, refreshing if needed. Order is the whole
   * point: when a refresh happens, the rotated credentials are persisted
   * before the token is handed to any caller, so no data request can ever
   * ride on a rotation that was not durably recorded.
   */
  async accessToken(): Promise<string> {
    const current = await this.store.load();
    if (!current) {
      throw new Error(
        'No stored Oura credentials. Run scripts/oura-auth-helper.ts once to authorize.',
      );
    }
    if (this.now() < current.expiresAt - TOKEN_EXPIRY_SKEW_SECONDS * 1000) {
      return current.accessToken;
    }
    const rotated = await postToken(
      {
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
      this.fetchImpl,
      this.now,
    );
    try {
      await this.store.save(rotated);
    } catch (cause) {
      throw new TokenPersistenceError(cause);
    }
    return rotated.accessToken;
  }
}
