'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/**
 * One conversation: message list + composer. The user bubble renders
 * optimistically; both sides of the exchange come back from POST /api/chat,
 * which is also what persisted them.
 */
export function ChatThread({
  conversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: Msg[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { id: 'pending', role: 'user', content: text }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, text }),
      });
      const result = await res.json();
      if (result.error) {
        setError(result.error);
        setMessages((prev) => prev.filter((m) => m.id !== 'pending'));
        setInput(text);
      } else if (conversationId === null) {
        // New conversation: navigate to it; the server re-render carries the messages.
        router.push(`/chat?c=${result.conversationId}`);
        router.refresh();
      } else {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== 'pending'),
          ...(result.messages as Msg[]),
        ]);
        router.refresh(); // memory panel may have a new version
      }
    } catch (err) {
      setError(String(err));
      setMessages((prev) => prev.filter((m) => m.id !== 'pending'));
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="chat-thread">
        {messages.length === 0 && (
          <p className="muted">
            Start a conversation — try “why is today a rest day?” or “how has my HRV been
            trending?”.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={`${m.id}_${i}`} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="bubble assistant muted">…</div>}
      </div>
      {error && <div className="notice error">{error}</div>}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          rows={2}
          placeholder="Ask about your data, the decision, the plan…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={busy || input.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  );
}
