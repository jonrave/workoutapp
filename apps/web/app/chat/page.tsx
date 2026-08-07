/**
 * Chat: persistent conversations with an explanation-only assistant (I2c).
 * Every message is stored verbatim in the append-only conversation store, and
 * a distilled durable memory carries context between conversations. The
 * assistant explains decisions and data; the engine alone prescribes.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getChatStore } from '../../lib/data';
import { StorageNotice } from '../../components/StorageNotice';
import { ChatThread } from './ChatThread';
import { MemoryPanel } from './MemoryPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Chat' };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string }>;
}) {
  const { c, q } = await searchParams;
  const chat = await getChatStore();
  const conversations = await chat.listConversations();
  const selectedId = c && conversations.some((x) => x.id === c) ? c : null;
  const [messages, memory, searchHits] = await Promise.all([
    selectedId ? chat.readMessages(selectedId) : Promise.resolve([]),
    chat.currentMemory(),
    q?.trim() ? chat.searchMessages(q.trim()) : Promise.resolve(null),
  ]);
  const titleById = new Map(conversations.map((x) => [x.id, x.title]));

  return (
    <>
      <StorageNotice />

      <section className="card headline">
        <h2 style={{ margin: 0 }}>Chat</h2>
        <p className="muted">
          Ask about your data, today&apos;s decision, or the standing plan. Everything said here is
          stored, and a distilled memory carries context into future conversations — nothing is
          lost between sessions. The assistant explains; it never prescribes training and never
          changes your plan or your log.
        </p>
      </section>

      <section className="card">
        <div className="chat-topbar">
          <div className="conv-list">
            <Link href="/chat" className={selectedId === null ? 'conv active' : 'conv'}>
              + New conversation
            </Link>
            {conversations.map((conv) => (
              <Link
                key={conv.id}
                href={`/chat?c=${conv.id}`}
                className={conv.id === selectedId ? 'conv active' : 'conv'}
                title={new Date(conv.createdAt).toLocaleString()}
              >
                {conv.title}
              </Link>
            ))}
          </div>
          <form action="/chat" className="chat-search">
            <input type="search" name="q" placeholder="Search all conversations…" defaultValue={q ?? ''} />
          </form>
        </div>

        {searchHits !== null && (
          <div className="search-results">
            <p className="muted">
              {searchHits.length === 0
                ? `No messages match “${q}”.`
                : `${searchHits.length} message${searchHits.length === 1 ? '' : 's'} matching “${q}”:`}
            </p>
            <ul>
              {searchHits.map((m) => (
                <li key={m.id}>
                  <Link href={`/chat?c=${m.conversationId}`}>
                    {titleById.get(m.conversationId) ?? m.conversationId}
                  </Link>{' '}
                  <span className="muted">
                    ({m.role}, {m.createdAt.slice(0, 10)}) {m.content.slice(0, 140)}
                    {m.content.length > 140 ? '…' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ChatThread
          key={selectedId ?? 'new'}
          conversationId={selectedId}
          initialMessages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
        />
      </section>

      <MemoryPanel
        memory={memory}
        selectedConversationId={selectedId ?? conversations[0]?.id ?? null}
      />
    </>
  );
}
