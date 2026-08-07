'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemoryVersion } from '@peakspan/store';

/**
 * The distilled durable memory, rendered verbatim (§11: what the assistant
 * remembers should be legible, not hidden). Updates automatically after each
 * exchange; the button forces a distillation now.
 */
export function MemoryPanel({
  memory,
  selectedConversationId,
}: {
  memory: MemoryVersion | null;
  selectedConversationId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function distillNow() {
    if (!selectedConversationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: selectedConversationId }),
      });
      const result = await res.json();
      if (result?.error) setError(result.error);
      router.refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Durable memory</h2>
      <p className="muted">
        What the assistant remembers across conversations — shown verbatim, nothing hidden. It is
        rewritten after each exchange and never feeds the decision engine.
      </p>
      {memory ? (
        <>
          <div className="memory-doc">{memory.content}</div>
          <p className="muted">
            Version {memory.version} · updated {new Date(memory.createdAt).toLocaleString()}
          </p>
        </>
      ) : (
        <p className="muted">No memory yet — it builds up as you talk.</p>
      )}
      {selectedConversationId && (
        <button className="secondary" onClick={() => void distillNow()} disabled={busy}>
          {busy ? 'Updating…' : 'Update memory now'}
        </button>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
