import { isEphemeral, isServerless } from '../lib/data';

/**
 * Honest storage banner. The contract's §11 spirit applies to the product's
 * own limitations too: a user should be able to see which parts are
 * load-bearing and which are demo scaffolding.
 */
export function StorageNotice() {
  if (!isEphemeral()) return null;
  return (
    <div className="notice error" role="status">
      {isServerless() ? (
        <>
          <strong>Demo mode — nothing you log will persist.</strong> No{' '}
          <code>DATABASE_URL</code> is set, so the event log lives in memory and each serverless
          request may hit a fresh instance. Attach Postgres and run{' '}
          <code>packages/store/migrations/001_init.sql</code> to make this a real log.
        </>
      ) : (
        <>
          <strong>In-memory event log.</strong> Anything you log persists until you stop the
          server. Set <code>DATABASE_URL</code> for durable storage.
        </>
      )}
    </div>
  );
}
