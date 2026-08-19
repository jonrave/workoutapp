/**
 * One-time throwaway helper for the Oura OAuth2 authorization code flow.
 * Oura deprecated personal access tokens in December 2025, so a human has to
 * click through the browser consent exactly once; this script does the rest.
 *
 * Usage:
 *   OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... [DATABASE_URL=...] \
 *     npm run oura:auth
 *
 * It prints the consent URL, catches the redirect on localhost, exchanges
 * the code, and then either seeds the Postgres credential store (when
 * DATABASE_URL is set) or prints the credentials JSON for manual seeding.
 * Register the app at cloud.ouraring.com with the same redirect URI.
 */
import http from 'node:http';
import { buildConsentUrl, exchangeAuthorizationCode } from '@peakspan/adapters';
import { PostgresOuraCredentialStore } from '@peakspan/store/postgres';

const clientId = process.env.OURA_CLIENT_ID;
const clientSecret = process.env.OURA_CLIENT_SECRET;
const redirectUri = process.env.OURA_REDIRECT_URI ?? 'http://localhost:8484/callback';

if (!clientId || !clientSecret) {
  console.error('Set OURA_CLIENT_ID and OURA_CLIENT_SECRET (from your app at cloud.ouraring.com).');
  process.exit(1);
}

const port = Number(new URL(redirectUri).port || 80);
const state = Math.random().toString(36).slice(2);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  if (url.pathname !== new URL(redirectUri).pathname) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (url.searchParams.get('state') !== state) throw new Error('state mismatch; retry');
    const code = url.searchParams.get('code');
    if (!code) throw new Error(`no code in redirect: ${url.search}`);
    const credentials = await exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri });
    if (process.env.DATABASE_URL) {
      const store = PostgresOuraCredentialStore.fromConnectionString(process.env.DATABASE_URL);
      await store.save(credentials);
      await store.close();
      console.log('Credentials saved to Postgres (oura_credentials). The sync job can now run.');
    } else {
      console.log('DATABASE_URL not set; seed the store manually with:');
      console.log(JSON.stringify(credentials, null, 2));
    }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Authorized. You can close this tab.');
    server.close();
  } catch (err) {
    console.error(`Exchange failed: ${err instanceof Error ? err.message : String(err)}`);
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Exchange failed; see terminal.');
    server.close();
    process.exitCode = 1;
  }
});

server.listen(port, () => {
  console.log('Open this URL in a browser and approve access:');
  console.log(buildConsentUrl(clientId, redirectUri, ['daily', 'personal'], state));
  console.log(`Waiting for the redirect on ${redirectUri} ...`);
});
