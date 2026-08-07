/**
 * Persistent conversation memory: verbatim chat transcripts plus a versioned
 * distilled-memory document. Append-only like the event log — messages are
 * never edited or deleted, and memory updates are new versions, never
 * overwrites. None of this feeds the engine: chat is I2(c) "explanation on
 * demand" and the decision path never reads these tables.
 */
import { ImmutabilityViolation } from './log';

export type ChatRole = 'user' | 'assistant';

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
}

export interface StoredChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

/** One immutable revision of the distilled durable-memory document. */
export interface MemoryVersion {
  version: number;
  content: string;
  sourceConversationId: string | null;
  /** Timestamp of the newest message this distillation had seen. */
  coversMessagesThrough: string;
  createdAt: string;
}

export interface ConversationStore {
  createConversation(meta: ConversationMeta): Promise<void>;
  /** Newest first. */
  listConversations(): Promise<ConversationMeta[]>;
  /** Duplicate ids are rejected — the transcript is append-only. */
  appendMessage(message: StoredChatMessage): Promise<void>;
  /** Chronological order. */
  readMessages(conversationId: string): Promise<StoredChatMessage[]>;
  /** Case-insensitive substring search over message content, newest first. */
  searchMessages(query: string, limit?: number): Promise<StoredChatMessage[]>;
}

export interface MemoryStore {
  /** The latest distilled-memory version, or null before the first distillation. */
  currentMemory(): Promise<MemoryVersion | null>;
  /** Assigns version = max + 1 and returns the stored row. */
  appendMemoryVersion(version: Omit<MemoryVersion, 'version'>): Promise<MemoryVersion>;
}

export class InMemoryConversationStore implements ConversationStore, MemoryStore {
  private readonly conversations: ConversationMeta[] = [];
  private readonly messages: StoredChatMessage[] = [];
  private readonly memory: MemoryVersion[] = [];

  async createConversation(meta: ConversationMeta): Promise<void> {
    if (this.conversations.some((c) => c.id === meta.id)) {
      throw new ImmutabilityViolation(`Conversation ${meta.id} already exists`);
    }
    this.conversations.push(structuredClone(meta));
  }

  async listConversations(): Promise<ConversationMeta[]> {
    return [...this.conversations]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((c) => structuredClone(c));
  }

  async appendMessage(message: StoredChatMessage): Promise<void> {
    if (this.messages.some((m) => m.id === message.id)) {
      throw new ImmutabilityViolation(
        `Message ${message.id} already exists; the transcript is append-only`,
      );
    }
    if (!this.conversations.some((c) => c.id === message.conversationId)) {
      throw new Error(`Conversation ${message.conversationId} does not exist`);
    }
    this.messages.push(structuredClone(message));
  }

  async readMessages(conversationId: string): Promise<StoredChatMessage[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map((m) => structuredClone(m));
  }

  async searchMessages(query: string, limit = 50): Promise<StoredChatMessage[]> {
    const q = query.toLowerCase();
    return this.messages
      .filter((m) => m.content.toLowerCase().includes(q))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, limit)
      .map((m) => structuredClone(m));
  }

  async currentMemory(): Promise<MemoryVersion | null> {
    const latest = this.memory[this.memory.length - 1];
    return latest ? structuredClone(latest) : null;
  }

  async appendMemoryVersion(version: Omit<MemoryVersion, 'version'>): Promise<MemoryVersion> {
    const next: MemoryVersion = { ...structuredClone(version), version: this.memory.length + 1 };
    this.memory.push(next);
    return structuredClone(next);
  }
}
