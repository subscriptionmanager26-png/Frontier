import * as SQLite from 'expo-sqlite';

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export type ConversationRow = {
  id: string;
  title: string;
  updatedAt: number;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('frontier_chat_memory.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY NOT NULL,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages (conversation_id, created_at);
        CREATE TABLE IF NOT EXISTS tool_registry (
          server_url TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          description TEXT NOT NULL,
          input_schema_json TEXT NOT NULL,
          tool_doc TEXT NOT NULL,
          embedding_json TEXT,
          embedding_model TEXT,
          doc_hash TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (server_url, tool_name)
        );
        CREATE INDEX IF NOT EXISTS idx_tool_registry_server ON tool_registry (server_url);
        CREATE TABLE IF NOT EXISTS notification_log (
          id TEXT PRIMARY KEY NOT NULL,
          notification_identifier TEXT NOT NULL UNIQUE,
          title TEXT,
          body TEXT,
          data_json TEXT NOT NULL,
          received_at INTEGER NOT NULL,
          opened_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_notification_log_received ON notification_log (received_at DESC);
        CREATE TABLE IF NOT EXISTS a2a_session_map (
          thread_id TEXT PRIMARY KEY NOT NULL,
          agent_url TEXT NOT NULL,
          session_id TEXT NOT NULL,
          last_task_id TEXT,
          last_task_status TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS a2a_logs (
          id TEXT PRIMARY KEY NOT NULL,
          created_at INTEGER NOT NULL,
          level TEXT NOT NULL,
          request_id TEXT,
          correlation_id TEXT,
          session_id TEXT,
          task_id TEXT,
          agent_url TEXT,
          hop TEXT NOT NULL,
          status TEXT,
          detail_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_a2a_logs_created ON a2a_logs (created_at DESC);
      `);
      // Migration: some older installs created `a2a_session_map` with a misspelled
      // `seesion_id` column. Rebuild the table to the canonical `session_id` shape.
      const a2aCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(a2a_session_map)`);
      const colNames = new Set(a2aCols.map((c) => c.name));
      const hasTypoSessionCol = colNames.has('seesion_id');
      const hasCorrectSessionCol = colNames.has('session_id');
      if (hasTypoSessionCol && !hasCorrectSessionCol) {
        await db.execAsync(`
          BEGIN;
          ALTER TABLE a2a_session_map RENAME TO a2a_session_map_old;
          CREATE TABLE a2a_session_map (
            thread_id TEXT PRIMARY KEY NOT NULL,
            agent_url TEXT NOT NULL,
            session_id TEXT NOT NULL,
            last_task_id TEXT,
            last_task_status TEXT,
            updated_at INTEGER NOT NULL
          );
          INSERT INTO a2a_session_map (thread_id, agent_url, session_id, last_task_id, last_task_status, updated_at)
          SELECT thread_id, agent_url, seesion_id, last_task_id, NULL, updated_at
          FROM a2a_session_map_old;
          DROP TABLE a2a_session_map_old;
          COMMIT;
        `);
      }
      // Forward migration: add strict continuation status tracking.
      if (!colNames.has('last_task_status')) {
        await db.execAsync(`ALTER TABLE a2a_session_map ADD COLUMN last_task_status TEXT;`);
      }
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS a2a_direct_recents (
          agent_url TEXT PRIMARY KEY NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

/** Shared DB (messages + tool registry). */
export async function getChatMemoryDb(): Promise<SQLite.SQLiteDatabase> {
  return getDb();
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function listConversations(): Promise<ConversationRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    updated_at: number;
  }>(`SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC`);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

export async function createConversation(title = 'New chat'): Promise<ConversationRow> {
  const db = await getDb();
  const id = newId();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO conversations (id, title, updated_at) VALUES (?, ?, ?)`,
    id,
    title,
    now
  );
  return { id, title, updatedAt: now };
}

export async function touchConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE conversations SET updated_at = ? WHERE id = ?`, Date.now(), id);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`, title, Date.now(), id);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM messages WHERE conversation_id = ?`, id);
  await db.runAsync(`DELETE FROM conversations WHERE id = ?`, id);
}

export async function listMessages(conversationId: string): Promise<MessageRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: number;
  }>(
    `SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
    conversationId
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export async function addMessage(
  conversationId: string,
  role: ChatRole,
  content: string
): Promise<MessageRow> {
  const db = await getDb();
  const id = newId();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    id,
    conversationId,
    role,
    content,
    now
  );
  await touchConversation(conversationId);
  return { id, conversationId, role, content, createdAt: now };
}
