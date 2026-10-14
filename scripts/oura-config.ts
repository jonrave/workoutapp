/** Configuration checks shared by the CLI tools. Never include values in errors. */
type Env = Record<string, string | undefined>;

function requireKeys(env: Env, keys: string[]): void {
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing configuration: ${missing.join(', ')}. See docs/oura-setup.md. ` +
        'Use repository Actions secrets for the workflow; Vercel variables are separate.',
    );
  }
}

export function checkSyncConfig(env: Env): void {
  const required = env.OURA_TOKEN?.trim() ? [] : ['OURA_CLIENT_ID', 'OURA_CLIENT_SECRET'];
  // OAuth always needs durable credentials; static-token ingest also needs a DB.
  if (!env.OURA_TOKEN?.trim() || env.GATE_SKIP_INGEST !== '1') required.push('DATABASE_URL');
  requireKeys(env, required);
}

export function authHelperConfig(env: Env) {
  requireKeys(env, ['OURA_CLIENT_ID', 'OURA_CLIENT_SECRET', 'DATABASE_URL']);
  const redirectUri = env.OURA_REDIRECT_URI ?? 'http://localhost:8484/callback';
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error('OURA_REDIRECT_URI must be an HTTP loopback URL. See docs/oura-setup.md.');
  }
  if (
    redirect.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) ||
    redirect.username || redirect.password || redirect.search || redirect.hash ||
    redirect.port === '0'
  ) {
    throw new Error('OURA_REDIRECT_URI must be an HTTP loopback URL without credentials, query, or fragment.');
  }
  return {
    clientId: env.OURA_CLIENT_ID!,
    clientSecret: env.OURA_CLIENT_SECRET!,
    databaseUrl: env.DATABASE_URL!,
    redirectUri,
    redirect,
  };
}

/** Redact configured credentials if a dependency includes them in an error. */
export function safeErrorMessage(err: unknown, env: Env = process.env): string {
  let message = err instanceof Error ? err.message : 'Unexpected error';
  for (const key of ['OURA_TOKEN', 'OURA_CLIENT_ID', 'OURA_CLIENT_SECRET', 'DATABASE_URL']) {
    const value = env[key];
    if (value) message = message.split(value).join('[redacted]');
  }
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted database URL]');
}
