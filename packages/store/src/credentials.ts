/**
 * Durable store for rotated Oura OAuth credentials. Oura refresh tokens are
 * single use, so this store is the difference between a working schedule and
 * a stranded one: the sync job persists the rotated pair here BEFORE making
 * any data request, and aborts if the save fails.
 *
 * Structurally identical to the adapters package's `OuraTokenStore`
 * interface (kept structural on purpose: the store package does not depend
 * on adapters).
 */

export interface StoredOuraCredentials {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

export interface OuraCredentialStore {
  load(): Promise<StoredOuraCredentials | null>;
  save(credentials: StoredOuraCredentials): Promise<void>;
}

/** Test and local-demo implementation. Optionally fails on save to exercise the abort path. */
export class InMemoryOuraCredentialStore implements OuraCredentialStore {
  private credentials: StoredOuraCredentials | null = null;
  public failNextSave = false;

  constructor(seed?: StoredOuraCredentials) {
    this.credentials = seed ?? null;
  }

  async load(): Promise<StoredOuraCredentials | null> {
    return this.credentials ? { ...this.credentials } : null;
  }

  async save(credentials: StoredOuraCredentials): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('simulated credential persistence failure');
    }
    this.credentials = { ...credentials };
  }
}
