/**
 * One-time local Oura OAuth consent. Run on the same computer as the browser:
 * node --env-file=.env.oura.local --import tsx scripts/oura-auth-helper.ts
 * Credentials are saved directly to PostgreSQL and are never printed.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildConsentUrl, exchangeAuthorizationCode } from '@peakspan/adapters';
import { PostgresOuraCredentialStore } from '@peakspan/store/postgres';
import { authHelperConfig, safeErrorMessage } from './oura-config';

export async function main(): Promise<void> {
  const { clientId, clientSecret, databaseUrl, redirectUri, redirect } = authHelperConfig(process.env);
  const store = PostgresOuraCredentialStore.fromConnectionString(databaseUrl);
  try {
    // Fail before browser consent if the database cannot persist the token pair.
    await store.checkAccess();
    const state = randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) => {
      let handling = false;
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri);
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET' || url.pathname !== redirect.pathname) {
          res.writeHead(404).end();
          return;
        }
        if (url.searchParams.get('state') !== state) {
          // An unsolicited request must not consume the real pending consent.
          res.writeHead(400).end('Invalid OAuth state. Use the authorization link in your terminal.');
          return;
        }
        if (handling) {
          res.writeHead(409).end('Authorization is already being processed.');
          return;
        }
        handling = true;
        try {
          if (url.searchParams.has('error')) throw new Error('Oura authorization was declined.');
          const code = url.searchParams.get('code');
          if (!code) throw new Error('Oura returned no authorization code.');
          const credentials = await exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri });
          await store.save(credentials);
          console.log('Credentials saved to Postgres (oura_credentials). No tokens were printed.');
          res.writeHead(200, { 'content-type': 'text/plain' }).end('Authorized. You can close this tab.');
          server.close(() => resolve());
        } catch {
          // Token/DB errors can contain secret-bearing response bodies or SQL details.
          res.writeHead(500, { 'content-type': 'text/plain' }).end('Authorization failed. See your terminal.');
          server.close(() => reject(new Error(
            'Oura authorization or token storage failed. Check the client credentials, exact redirect URI, ' +
            'and database write access, then run the helper again. No credentials were printed.',
          )));
        }
      });
      server.once('error', reject);
      server.listen(Number(redirect.port || 80), redirect.hostname.replace(/^\[|\]$/g, ''), () => {
        console.log('Open this URL in a browser on THIS computer and approve daily data access:');
        console.log(buildConsentUrl(clientId, redirectUri, ['daily'], state));
        console.log(`Waiting for the redirect on ${redirectUri} ...`);
      });
    });
  } finally {
    await store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`oura:auth failed: ${safeErrorMessage(err)}`);
    process.exitCode = 1;
  });
}
