import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'frontier_emissions_v1';
const CURSOR_PREFIX = 'frontier_emissions_cursor_v1';

export type A2AEvent = {
  type: string;
  taskId?: string;
  id?: string;
  metadata?: { sequenceNumber?: number; [k: string]: unknown };
  [k: string]: unknown;
};

function eventTaskId(event: A2AEvent): string {
  return String(event.taskId || event.id || '').trim();
}

function eventSeq(event: A2AEvent): number {
  const raw = event.metadata?.sequenceNumber;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

function eventKey(taskId: string, sequenceNumber: number): string {
  return `${KEY_PREFIX}:${taskId}:${sequenceNumber}`;
}

export type EmissionCloudEntry = { taskId: string; seq: number; json: string };

function parseEmissionStorageKey(k: string): { taskId: string; seq: number } | null {
  const p = `${KEY_PREFIX}:`;
  if (!k.startsWith(p)) return null;
  const rest = k.slice(p.length);
  const i = rest.lastIndexOf(':');
  if (i <= 0) return null;
  const taskId = rest.slice(0, i);
  const seq = Number(rest.slice(i + 1));
  if (!taskId || !Number.isFinite(seq)) return null;
  return { taskId, seq };
}

const MAX_EMISSIONS_PER_TASK_CLOUD = 500;
const MAX_EMISSIONS_TOTAL_CLOUD = 10_000;

/** Serialized emission rows for cloud backup (per-task cap + global cap). */
export async function exportEmissionsForCloud(): Promise<EmissionCloudEntry[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${KEY_PREFIX}:`;
  const keys = allKeys.filter((k) => k.startsWith(prefix));
  const pairs = await AsyncStorage.multiGet(keys);
  const entries: EmissionCloudEntry[] = [];
  for (const [k, v] of pairs) {
    if (!v) continue;
    const parsed = parseEmissionStorageKey(k);
    if (!parsed) continue;
    entries.push({ taskId: parsed.taskId, seq: parsed.seq, json: v });
  }
  const byTask = new Map<string, EmissionCloudEntry[]>();
  for (const e of entries) {
    const arr = byTask.get(e.taskId) ?? [];
    arr.push(e);
    byTask.set(e.taskId, arr);
  }
  const capped: EmissionCloudEntry[] = [];
  for (const arr of byTask.values()) {
    arr.sort((a, b) => b.seq - a.seq);
    capped.push(...arr.slice(0, MAX_EMISSIONS_PER_TASK_CLOUD));
  }
  capped.sort((a, b) => b.seq - a.seq || a.taskId.localeCompare(b.taskId));
  return capped.slice(0, MAX_EMISSIONS_TOTAL_CLOUD);
}

const MULTISET_CHUNK = 400;

/** Merge remote emission history into local storage and advance fetch cursors. */
export async function mergeEmissionsFromCloud(entries: EmissionCloudEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const tuples: [string, string][] = [];
  const maxSeqByTask = new Map<string, number>();
  for (const e of entries) {
    const tid = e.taskId?.trim();
    if (!tid || !Number.isFinite(e.seq)) continue;
    const raw = e.json?.trim();
    if (!raw) continue;
    tuples.push([eventKey(tid, Math.floor(e.seq)), raw]);
    const cur = maxSeqByTask.get(tid) ?? 0;
    const n = Math.floor(e.seq);
    if (n > cur) maxSeqByTask.set(tid, n);
  }
  for (let i = 0; i < tuples.length; i += MULTISET_CHUNK) {
    await AsyncStorage.multiSet(tuples.slice(i, i + MULTISET_CHUNK));
  }
  for (const [tid, seq] of maxSeqByTask) {
    await updateLastSeenSequence(tid, seq);
  }
}

function cursorKey(taskId: string): string {
  return `${CURSOR_PREFIX}:${taskId}`;
}

/** For cloud backup of relay fetch cursors (per task). */
export async function exportEmissionCursors(): Promise<Record<string, number>> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${CURSOR_PREFIX}:`;
  const out: Record<string, number> = {};
  const pairs = await AsyncStorage.multiGet(allKeys.filter((k) => k.startsWith(prefix)));
  for (const [k, raw] of pairs) {
    const taskId = k.slice(prefix.length);
    const n = Number(raw);
    if (taskId && Number.isFinite(n)) out[taskId] = n;
  }
  return out;
}

export async function importEmissionCursors(cursors: Record<string, number> | undefined | null): Promise<void> {
  if (!cursors || typeof cursors !== 'object') return;
  const entries: [string, string][] = [];
  for (const [taskId, seq] of Object.entries(cursors)) {
    const tid = taskId.trim();
    if (!tid || !Number.isFinite(seq)) continue;
    entries.push([cursorKey(tid), String(Math.floor(seq))]);
  }
  if (entries.length > 0) await AsyncStorage.multiSet(entries);
}

export async function getLastSeenSequence(taskId: string): Promise<number> {
  const raw = await AsyncStorage.getItem(cursorKey(taskId));
  const n = Number(raw);
  const cursor = Number.isFinite(n) && n > 0 ? n : 0;
  // eslint-disable-next-line no-console
  console.log('[CURSOR] getLastSeenSequence for', taskId, '→', cursor);
  return cursor;
}

export async function updateLastSeenSequence(taskId: string, seq: number): Promise<void> {
  if (!Number.isFinite(seq) || seq <= 0) return;
  const cur = await getLastSeenSequence(taskId);
  if (seq <= cur) return;
  await AsyncStorage.setItem(cursorKey(taskId), String(Math.floor(seq)));
}

export async function storeEmission(event: A2AEvent): Promise<void> {
  const taskId = eventTaskId(event);
  if (!taskId) return;
  const seq = eventSeq(event);
  await AsyncStorage.setItem(eventKey(taskId, seq), JSON.stringify(event));
  await updateLastSeenSequence(taskId, seq);
}

export async function getEmissionsSince(taskId: string, sinceSeq: number): Promise<A2AEvent[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${KEY_PREFIX}:${taskId}:`;
  const keys = allKeys.filter((k) => k.startsWith(prefix));
  if (keys.length === 0) return [];
  const pairs = await AsyncStorage.multiGet(keys);
  return pairs
    .map(([, v]) => {
      if (!v) return null;
      try {
        return JSON.parse(v) as A2AEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is A2AEvent => !!e && eventSeq(e) > sinceSeq)
    .sort((a, b) => eventSeq(a) - eventSeq(b));
}

