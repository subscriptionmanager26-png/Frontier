import { requestA2aUiRefresh } from '@/lib/a2aUiRefreshBus';
import { scheduleCloudA2aStatePush } from '@/lib/cloudA2aSyncScheduler';
import { getChatMemoryDb } from '@/lib/chatMemory';

import { canonicalA2aAgentUrl, normalizeStoredAgentUrl } from '@/lib/a2a/canonicalAgentUrl';

export { canonicalA2aAgentUrl, normalizeStoredAgentUrl };

type SessionMapRow = {
  threadId: string;
  agentUrl: string;
  sessionId: string;
  lastTaskId: string | null;
  lastTaskStatus: string | null;
  updatedAt: number;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function getA2aSessionMap(threadId: string): Promise<SessionMapRow | null> {
  const db = await getChatMemoryDb();
  const row = await db.getFirstAsync<{
    thread_id: string;
    agent_url: string;
    session_id: string;
    last_task_id: string | null;
    last_task_status: string | null;
    updated_at: number;
  }>(`SELECT thread_id, agent_url, session_id, last_task_id, last_task_status, updated_at FROM a2a_session_map WHERE thread_id = ?`, threadId);
  if (!row) return null;
  return {
    threadId: row.thread_id,
    agentUrl: row.agent_url,
    sessionId: row.session_id,
    lastTaskId: row.last_task_id,
    lastTaskStatus: row.last_task_status,
    updatedAt: row.updated_at,
  };
}

export async function upsertA2aSessionMap(args: {
  threadId: string;
  agentUrl: string;
  sessionId: string;
  lastTaskId?: string | null;
  lastTaskStatus?: string | null;
}): Promise<void> {
  const agentUrl = canonicalA2aAgentUrl(args.agentUrl);
  const db = await getChatMemoryDb();
  await db.runAsync(
    `INSERT INTO a2a_session_map (thread_id, agent_url, session_id, last_task_id, last_task_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       agent_url = excluded.agent_url,
       session_id = excluded.session_id,
       last_task_id = excluded.last_task_id,
       last_task_status = excluded.last_task_status,
       updated_at = excluded.updated_at`,
    args.threadId,
    agentUrl,
    args.sessionId,
    args.lastTaskId ?? null,
    args.lastTaskStatus ?? null,
    Date.now()
  );
  await touchDirectAgentRecentInternal(agentUrl);
  requestA2aUiRefresh();
}

/** Register that the user opened or used this agent so it appears on the Direct tab (merged with session stats). */
export async function touchDirectAgentRecent(agentUrl: string): Promise<void> {
  await touchDirectAgentRecentInternal(canonicalA2aAgentUrl(agentUrl));
  requestA2aUiRefresh();
}

async function touchDirectAgentRecentInternal(agentUrl: string): Promise<void> {
  if (!agentUrl) return;
  const db = await getChatMemoryDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO a2a_direct_recents (agent_url, last_seen_at) VALUES (?, ?)
     ON CONFLICT(agent_url) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    agentUrl,
    now
  );
}

export async function logA2aHop(entry: {
  level: 'info' | 'error';
  requestId?: string;
  correlationId?: string;
  sessionId?: string;
  taskId?: string;
  agentUrl?: string;
  hop: string;
  status?: string;
  detail?: unknown;
}): Promise<void> {
  const shouldConsoleLog =
    entry.hop.startsWith('subsync.') ||
    entry.hop.startsWith('autosync.') ||
    entry.hop.startsWith('ux.flow.');
  if (shouldConsoleLog) {
    try {
      const tag = entry.hop.startsWith('ux.flow.') ? '[FRONTIER_FLOW]' : '[A2A_SYNC]';
      // eslint-disable-next-line no-console
      console.log(
        tag,
        JSON.stringify({
          ts: new Date().toISOString(),
          level: entry.level,
          hop: entry.hop,
          status: entry.status ?? null,
          taskId: entry.taskId ?? null,
          sessionId: entry.sessionId ?? null,
          agentUrl: entry.agentUrl ?? null,
          detail: entry.detail ?? null,
        })
      );
    } catch {
      // never fail sync flow because of logging
    }
  }
  const db = await getChatMemoryDb();
  await db.runAsync(
    `INSERT INTO a2a_logs
      (id, created_at, level, request_id, correlation_id, session_id, task_id, agent_url, hop, status, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    Date.now(),
    entry.level,
    entry.requestId ?? null,
    entry.correlationId ?? null,
    entry.sessionId ?? null,
    entry.taskId ?? null,
    entry.agentUrl ?? null,
    entry.hop,
    entry.status ?? null,
    JSON.stringify(entry.detail ?? null)
  );
  scheduleCloudA2aStatePush();
  requestA2aUiRefresh();
}

export type A2aLogExportRow = {
  id: string;
  created_at: number;
  level: string;
  request_id: string | null;
  correlation_id: string | null;
  session_id: string | null;
  task_id: string | null;
  agent_url: string | null;
  hop: string;
  status: string | null;
  detail_json: string | null;
};

const MAX_CLOUD_A2A_LOG_ROWS = 8000;

export async function exportAllA2aLogsForCloud(): Promise<A2aLogExportRow[]> {
  const db = await getChatMemoryDb();
  const rows = await db.getAllAsync<A2aLogExportRow>(
    `SELECT id, created_at, level, request_id, correlation_id, session_id, task_id, agent_url, hop, status, detail_json
     FROM a2a_logs ORDER BY created_at ASC`
  );
  if (rows.length <= MAX_CLOUD_A2A_LOG_ROWS) return rows;
  return rows.slice(-MAX_CLOUD_A2A_LOG_ROWS);
}

export async function mergeA2aLogsFromCloud(rows: A2aLogExportRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getChatMemoryDb();
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR IGNORE INTO a2a_logs (id, created_at, level, request_id, correlation_id, session_id, task_id, agent_url, hop, status, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id,
      r.created_at,
      r.level,
      r.request_id,
      r.correlation_id,
      r.session_id,
      r.task_id,
      r.agent_url,
      r.hop,
      r.status,
      r.detail_json
    );
  }
}

export type A2aLogRow = {
  createdAt: number;
  level: 'info' | 'error';
  hop: string;
  status: string | null;
  taskId: string | null;
  sessionId: string | null;
  agentUrl: string | null;
  detailJson: string | null;
};

export async function listRecentA2aLogs(limit = 200): Promise<A2aLogRow[]> {
  const db = await getChatMemoryDb();
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 200;
  const rows = await db.getAllAsync<{
    created_at: number;
    level: string;
    hop: string;
    status: string | null;
    task_id: string | null;
    session_id: string | null;
    agent_url: string | null;
    detail_json: string | null;
  }>(
    `SELECT created_at, level, hop, status, task_id, session_id, agent_url, detail_json
     FROM a2a_logs
     ORDER BY created_at DESC
     LIMIT ?`,
    n
  );
  return rows.map((r) => ({
    createdAt: r.created_at,
    level: r.level === 'error' ? 'error' : 'info',
    hop: r.hop,
    status: r.status,
    taskId: r.task_id,
    sessionId: r.session_id,
    agentUrl: r.agent_url,
    detailJson: r.detail_json,
  }));
}

export type A2aTaskSnapshot = {
  taskId: string;
  sessionId: string | null;
  agentUrl: string | null;
  status: string;
  updatedAt: number;
  submittedAt: number | null;
  userMessage: string | null;
  threadId: string | null;
  detailJson: string | null;
};

export async function listA2aTaskSnapshots(): Promise<A2aTaskSnapshot[]> {
  const db = await getChatMemoryDb();
  const rows = await db.getAllAsync<{
    task_id: string;
    session_id: string | null;
    agent_url: string | null;
    status: string | null;
    created_at: number;
    submitted_at: number | null;
    submit_detail_json: string | null;
    detail_json: string | null;
  }>(
    `SELECT l.task_id, l.session_id, l.agent_url, l.status, l.created_at,
            s.submitted_at, sd.detail_json AS submit_detail_json, l.detail_json
     FROM a2a_logs l
     INNER JOIN (
       SELECT task_id, MAX(created_at) AS max_created
       FROM a2a_logs
       WHERE task_id IS NOT NULL
       GROUP BY task_id
     ) latest
     ON l.task_id = latest.task_id AND l.created_at = latest.max_created
     LEFT JOIN (
       SELECT task_id, MAX(created_at) AS submitted_at
       FROM a2a_logs
       WHERE task_id IS NOT NULL AND hop = 'task.submit'
       GROUP BY task_id
     ) s
     ON l.task_id = s.task_id
     LEFT JOIN a2a_logs sd
     ON sd.task_id = s.task_id AND sd.created_at = s.submitted_at
     ORDER BY l.created_at DESC`
  );
  return rows.map((r) => ({
    taskId: r.task_id,
    sessionId: r.session_id,
    agentUrl: r.agent_url,
    status: (r.status || 'UNKNOWN').toUpperCase(),
    updatedAt: r.created_at,
    submittedAt: r.submitted_at,
    userMessage: (() => {
      if (!r.submit_detail_json) return null;
      try {
        const parsed = JSON.parse(r.submit_detail_json) as Record<string, unknown>;
        const msg = parsed.userMessage;
        return typeof msg === 'string' && msg.trim() ? msg : null;
      } catch {
        return null;
      }
    })(),
    threadId: (() => {
      if (!r.submit_detail_json) return null;
      try {
        const parsed = JSON.parse(r.submit_detail_json) as Record<string, unknown>;
        const t = parsed.threadId;
        return typeof t === 'string' && t.trim() ? t : null;
      } catch {
        return null;
      }
    })(),
    detailJson: r.detail_json,
  }));
}

export type A2aDirectAgent = {
  agentUrl: string;
  lastUpdatedAt: number;
  sessionCount: number;
};

/**
 * After cloud restore merges rows into `a2a_logs`, rebuild `a2a_direct_recents` from distinct
 * canonical agent URLs so the Direct tab lists peers again. Session map rows are not cloud-synced;
 * this only restores **visibility** in Direct (session counts may stay 0 until the next chat).
 */
export async function rehydrateDirectRecentsFromA2aLogs(): Promise<number> {
  const db = await getChatMemoryDb();
  const raw = await db.getAllAsync<{ agent_url: string; created_at: number }>(
    `SELECT agent_url, created_at FROM a2a_logs
     WHERE agent_url IS NOT NULL AND TRIM(agent_url) != ''`
  );
  const byCanon = new Map<string, number>();
  for (const r of raw) {
    const canon = canonicalA2aAgentUrl(r.agent_url);
    if (!canon) continue;
    byCanon.set(canon, Math.max(byCanon.get(canon) ?? 0, r.created_at));
  }
  let n = 0;
  for (const [canon, lastSeen] of byCanon) {
    await db.runAsync(
      `INSERT INTO a2a_direct_recents (agent_url, last_seen_at) VALUES (?, ?)
       ON CONFLICT(agent_url) DO UPDATE SET last_seen_at = MAX(a2a_direct_recents.last_seen_at, excluded.last_seen_at)`,
      canon,
      lastSeen
    );
    n++;
  }
  if (n > 0) {
    requestA2aUiRefresh();
  }
  // #region agent log
  fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '583810' },
    body: JSON.stringify({
      sessionId: '583810',
      location: 'lib/a2a/store.ts:rehydrateDirectRecentsFromA2aLogs',
      message: 'rehydrate_direct_recents',
      data: { insertedOrUpdated: n, rawLogRows: raw.length },
      timestamp: Date.now(),
      hypothesisId: 'H1',
    }),
  }).catch(() => {});
  // #endregion
  return n;
}

export async function listA2aDirectAgents(): Promise<A2aDirectAgent[]> {
  const db = await getChatMemoryDb();
  const sm = await db.getAllAsync<{
    agent_url: string;
    last_updated: number;
    sessions: number;
  }>(
    `SELECT agent_url, MAX(updated_at) AS last_updated, COUNT(*) AS sessions
     FROM a2a_session_map
     GROUP BY agent_url`
  );
  const dr = await db.getAllAsync<{ agent_url: string; last_seen_at: number }>(
    `SELECT agent_url, last_seen_at FROM a2a_direct_recents`
  );
  type Agg = { representativeUrl: string; lastUpdatedAt: number; sessionCount: number };
  const byCanon = new Map<string, Agg>();

  for (const r of sm) {
    const raw = normalizeStoredAgentUrl(r.agent_url);
    const canon = canonicalA2aAgentUrl(r.agent_url);
    const prev = byCanon.get(canon);
    if (!prev) {
      byCanon.set(canon, {
        representativeUrl: raw,
        lastUpdatedAt: r.last_updated,
        sessionCount: r.sessions,
      });
    } else {
      const last = Math.max(prev.lastUpdatedAt, r.last_updated);
      const rep = r.last_updated >= prev.lastUpdatedAt ? raw : prev.representativeUrl;
      byCanon.set(canon, {
        representativeUrl: rep,
        lastUpdatedAt: last,
        sessionCount: prev.sessionCount + r.sessions,
      });
    }
  }
  for (const r of dr) {
    const raw = normalizeStoredAgentUrl(r.agent_url);
    const canon = canonicalA2aAgentUrl(r.agent_url);
    const prev = byCanon.get(canon);
    if (!prev) {
      byCanon.set(canon, {
        representativeUrl: raw,
        lastUpdatedAt: r.last_seen_at,
        sessionCount: 0,
      });
    } else {
      byCanon.set(canon, {
        representativeUrl: prev.representativeUrl,
        lastUpdatedAt: Math.max(prev.lastUpdatedAt, r.last_seen_at),
        sessionCount: prev.sessionCount,
      });
    }
  }

  /** Use canonical keys for navigation so Direct / Search / A2A base match `resolveScopeBaseUrl` + threadId. */
  return [...byCanon.entries()]
    .map(([canon, v]) => ({
      agentUrl: canon,
      lastUpdatedAt: v.lastUpdatedAt,
      sessionCount: v.sessionCount,
    }))
    .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
}
