import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ImmutabilityViolation,
  InMemoryConversationStore,
  type StoredChatMessage,
} from '../src/index';

const root = fileURLToPath(new URL('../../..', import.meta.url));

const msg = (
  id: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: string,
): StoredChatMessage => ({ id, conversationId, role, content, createdAt });

describe('conversation store', () => {
  it('lists conversations newest first', async () => {
    const store = new InMemoryConversationStore();
    await store.createConversation({ id: 'conv_a', title: 'First', createdAt: '2026-08-01T10:00:00Z' });
    await store.createConversation({ id: 'conv_b', title: 'Second', createdAt: '2026-08-03T10:00:00Z' });
    await store.createConversation({ id: 'conv_c', title: 'Third', createdAt: '2026-08-02T10:00:00Z' });
    expect((await store.listConversations()).map((c) => c.id)).toEqual(['conv_b', 'conv_c', 'conv_a']);
  });

  it('round-trips messages in chronological order and rejects duplicate ids', async () => {
    const store = new InMemoryConversationStore();
    await store.createConversation({ id: 'conv_a', title: 'Chat', createdAt: '2026-08-01T10:00:00Z' });
    const first = msg('msg_1', 'conv_a', 'user', 'Why is today a rest day?', '2026-08-01T10:01:00Z');
    const second = msg('msg_2', 'conv_a', 'assistant', 'The noise gate held the standing plan.', '2026-08-01T10:01:30Z');
    // Appended out of order; read back chronological.
    await store.appendMessage(second);
    await store.appendMessage(first);
    expect(await store.readMessages('conv_a')).toEqual([first, second]);
    await expect(store.appendMessage(first)).rejects.toThrow(ImmutabilityViolation);
  });

  it('rejects a message for a conversation that does not exist', async () => {
    const store = new InMemoryConversationStore();
    await expect(
      store.appendMessage(msg('msg_1', 'conv_missing', 'user', 'hello', '2026-08-01T10:00:00Z')),
    ).rejects.toThrow(/does not exist/);
  });

  it('duplicate conversation ids are rejected', async () => {
    const store = new InMemoryConversationStore();
    const meta = { id: 'conv_a', title: 'Chat', createdAt: '2026-08-01T10:00:00Z' };
    await store.createConversation(meta);
    await expect(store.createConversation(meta)).rejects.toThrow(ImmutabilityViolation);
  });

  it('searches message content case-insensitively, newest first', async () => {
    const store = new InMemoryConversationStore();
    await store.createConversation({ id: 'conv_a', title: 'Chat', createdAt: '2026-08-01T10:00:00Z' });
    await store.appendMessage(msg('msg_1', 'conv_a', 'user', 'How is my VO2max trending?', '2026-08-01T10:01:00Z'));
    await store.appendMessage(msg('msg_2', 'conv_a', 'assistant', 'Your vo2max delta is inside its SDC.', '2026-08-01T10:02:00Z'));
    await store.appendMessage(msg('msg_3', 'conv_a', 'user', 'And sleep?', '2026-08-01T10:03:00Z'));
    const hits = await store.searchMessages('VO2MAX');
    expect(hits.map((m) => m.id)).toEqual(['msg_2', 'msg_1']);
    expect(await store.searchMessages('lactate')).toEqual([]);
  });
});

describe('memory store', () => {
  it('starts empty, then versions monotonically with currentMemory() returning the latest', async () => {
    const store = new InMemoryConversationStore();
    expect(await store.currentMemory()).toBeNull();
    const v1 = await store.appendMemoryVersion({
      content: '- Prefers morning sessions',
      sourceConversationId: null,
      coversMessagesThrough: '2026-08-01T10:02:00Z',
      createdAt: '2026-08-01T10:02:05Z',
    });
    const v2 = await store.appendMemoryVersion({
      content: '- Prefers morning sessions\n- Asked about VO2max trend',
      sourceConversationId: 'conv_a',
      coversMessagesThrough: '2026-08-02T10:02:00Z',
      createdAt: '2026-08-02T10:02:05Z',
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect((await store.currentMemory())?.version).toBe(2);
    expect((await store.currentMemory())?.content).toContain('VO2max trend');
  });
});

describe('embedded schema stays in sync with the migration file', () => {
  it('postgres-conversations.ts SCHEMA_SQL contains every statement of 002_conversations.sql', () => {
    const migration = readFileSync(`${root}/packages/store/migrations/002_conversations.sql`, 'utf8');
    const embedded = readFileSync(
      fileURLToPath(new URL('../src/postgres-conversations.ts', import.meta.url)),
      'utf8',
    );
    // Compare statement-by-statement, ignoring whitespace and SQL comments.
    const normalize = (sql: string) =>
      sql
        .replace(/--[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const statement of migration.split(/;\s*\n\s*\n/)) {
      const wanted = normalize(statement);
      if (!wanted) continue;
      expect(normalize(embedded)).toContain(wanted);
    }
  });
});
