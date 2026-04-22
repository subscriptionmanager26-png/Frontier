/**
 * Tool registry + semantic (embedding) and lexical retrieval, aligned with claw-local toolRegistry.ts.
 * Stored in SQLite next to chat memory; embeddings via OpenAI or Azure OpenAI.
 */

import * as Crypto from 'expo-crypto';

import { getChatMemoryDb } from '@/lib/chatMemory';
import { normalizeUrl } from '@/lib/serverStorage';
import type { McpToolMeta } from '@/types/mcp';

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const STALE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_RETRIEVAL_TOP_K = 12;
/** If retrieval yields nothing or DB empty, cap how many tools we pass when falling back to “all”. */
const MAX_TOOLS_FALLBACK = 32;

type RegistryRow = {
  server_url: string;
  tool_name: string;
  description: string;
  input_schema_json: string;
  tool_doc: string;
  embedding_json: string | null;
  embedding_model: string | null;
  doc_hash: string;
  updated_at: number;
};

function asToolDoc(name: string, description: string, inputSchema: unknown) {
  return [
    `Tool name: ${name}`,
    `Description: ${description || 'No description provided'}`,
    `Input schema: ${JSON.stringify(inputSchema ?? {}, null, 0)}`,
    `Intent examples: use this when user asks for actions/data related to ${name}.`,
  ].join('\n');
}

async function hashText(s: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);
}

function parseEmbedding(json: string | null): number[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json) as number[];
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function lexicalScore(query: string, doc: string) {
  const q = (query ?? '')
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);
  if (!q.length) return 0;
  const text = (doc ?? '').toLowerCase();
  let hit = 0;
  for (const t of q) if (text.includes(t)) hit += 1;
  return hit / q.length;
}

export async function embedText(
  apiKey: string,
  text: string,
  options?: { url?: string; authMode?: 'openai' | 'azure'; model?: string }
): Promise<{ vec: number[]; model: string } | null> {
  const batch = await embedTextsBatch(apiKey, [text], options);
  return batch?.[0] ?? null;
}

/** Multiple inputs in one request (order preserved). */
async function embedTextsBatch(
  apiKey: string,
  texts: string[],
  options?: { url?: string; authMode?: 'openai' | 'azure'; model?: string }
): Promise<{ vec: number[]; model: string }[] | null> {
  const inputs = texts.map((t) => t.trim().slice(0, 8000)).filter(Boolean);
  if (!inputs.length) return [];
  const url = options?.url?.trim() || OPENAI_EMBEDDINGS_URL;
  const authMode = options?.authMode ?? 'openai';
  const model = options?.model?.trim() || OPENAI_EMBEDDING_MODEL;
  const headers: Record<string, string> =
    authMode === 'azure' ? { 'api-key': apiKey.trim() } : { Authorization: `Bearer ${apiKey.trim()}` };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ model, input: inputs.length === 1 ? inputs[0]! : inputs }),
  });
  const raw = await res.text();
  if (!res.ok) return null;
  try {
    const data = JSON.parse(raw) as { data?: { index?: number; embedding?: number[] }[] };
    const items = data.data ?? [];
    items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const out: { vec: number[]; model: string }[] = [];
    for (const item of items) {
      const vec = item.embedding;
      if (!vec?.length) return null;
      out.push({ vec, model });
    }
    return out.length === inputs.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Upsert tools for this MCP server; re-embed only when tool_doc hash changes.
 * Deletes registry rows for tools no longer present.
 */
export async function syncToolRegistry(
  serverUrl: string,
  tools: McpToolMeta[],
  apiKey: string,
  embedding?: { url?: string; authMode?: 'openai' | 'azure'; model?: string }
): Promise<{ count: number }> {
  const url = normalizeUrl(serverUrl);
  const db = await getChatMemoryDb();
  const rows = await db.getAllAsync<RegistryRow>(
    `SELECT * FROM tool_registry WHERE server_url = ?`,
    url
  );
  const byName = new Map(rows.map((r) => [r.tool_name, r]));
  const now = Date.now();
  const currentNames = new Set<string>();

  type Pending = {
    toolName: string;
    description: string;
    inputSchemaJson: string;
    toolDoc: string;
    docHash: string;
    embeddingJson: string | null;
    embeddingModel: string | null;
  };
  const pending: Pending[] = [];

  for (const t of tools) {
    const toolName = t.name;
    currentNames.add(toolName);
    const description = t.description ?? '';
    const inputSchemaJson = JSON.stringify(t.inputSchema ?? {});
    const toolDoc = asToolDoc(toolName, description, t.inputSchema ?? {});
    const docHash = await hashText(toolDoc);
    const prior = byName.get(toolName);

    let embeddingJson: string | null = prior?.embedding_json ?? null;
    let embeddingModel: string | null = prior?.embedding_model ?? null;
    if (!prior || prior.doc_hash !== docHash || !embeddingJson) {
      embeddingJson = null;
      embeddingModel = null;
    }
    pending.push({
      toolName,
      description,
      inputSchemaJson,
      toolDoc,
      docHash,
      embeddingJson,
      embeddingModel,
    });
  }

  const needDocs = pending.filter((p) => !p.embeddingJson).map((p) => p.toolDoc);
  let batchEmb: { vec: number[]; model: string }[] | null = null;
  if (needDocs.length) {
    batchEmb = await embedTextsBatch(apiKey, needDocs, embedding);
  }
  let bi = 0;
  for (const p of pending) {
    let embeddingJson = p.embeddingJson;
    let embeddingModel = p.embeddingModel;
    if (!embeddingJson && batchEmb && bi < batchEmb.length) {
      const emb = batchEmb[bi++];
      embeddingJson = JSON.stringify(emb.vec);
      embeddingModel = emb.model;
    }

    await db.runAsync(
      `INSERT INTO tool_registry (
        server_url, tool_name, description, input_schema_json, tool_doc,
        embedding_json, embedding_model, doc_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_url, tool_name) DO UPDATE SET
        description = excluded.description,
        input_schema_json = excluded.input_schema_json,
        tool_doc = excluded.tool_doc,
        embedding_json = excluded.embedding_json,
        embedding_model = excluded.embedding_model,
        doc_hash = excluded.doc_hash,
        updated_at = excluded.updated_at`,
      url,
      p.toolName,
      p.description,
      p.inputSchemaJson,
      p.toolDoc,
      embeddingJson,
      embeddingModel,
      p.docHash,
      now
    );
  }

  for (const r of rows) {
    if (!currentNames.has(r.tool_name)) {
      await db.runAsync(`DELETE FROM tool_registry WHERE server_url = ? AND tool_name = ?`, url, r.tool_name);
    }
  }

  return { count: tools.length };
}

export async function getRegistryStats(serverUrl: string): Promise<{
  count: number;
  lastUpdatedAt: number | null;
}> {
  const url = normalizeUrl(serverUrl);
  const db = await getChatMemoryDb();
  const row = await db.getFirstAsync<{ c: number; m: number | null }>(
    `SELECT COUNT(*) as c, MAX(updated_at) as m FROM tool_registry WHERE server_url = ?`,
    url
  );
  return { count: row?.c ?? 0, lastUpdatedAt: row?.m ?? null };
}

/**
 * If registry is empty or older than staleMs, sync from live tool list (caller provides list + apiKey for embeddings).
 */
export async function ensureToolRegistryFresh(
  serverUrl: string,
  tools: McpToolMeta[],
  apiKey: string,
  embedding?: { url?: string; authMode?: 'openai' | 'azure'; model?: string },
  options?: { staleMs?: number; force?: boolean }
): Promise<{ skipped: boolean; count: number }> {
  const staleMs = options?.staleMs ?? STALE_MS;
  const stats = await getRegistryStats(serverUrl);
  const stale =
    options?.force ||
    stats.count === 0 ||
    !stats.lastUpdatedAt ||
    Date.now() - stats.lastUpdatedAt > staleMs;

  if (stale) {
    const { count } = await syncToolRegistry(serverUrl, tools, apiKey, embedding);
    return { skipped: false, count };
  }
  return { skipped: true, count: stats.count };
}

export function buildRetrievalQuery(userMessage: string, history: { role: string; content: string }[]): string {
  const recentUsers = history
    .filter((h) => h.role === 'user')
    .slice(-2)
    .map((h) => h.content.trim())
    .filter(Boolean);
  const parts = [...recentUsers];
  if (!parts.length || parts[parts.length - 1] !== userMessage.trim()) {
    parts.push(userMessage.trim());
  }
  return parts.join('\n').slice(0, 4000);
}

export type ScoredTool = McpToolMeta & { score: number; embScore: number; lexScore: number };

/**
 * Rank tools for query using DB embeddings + lexical blend (claw-local weights).
 * Returns up to `limit` tools; maps back to live `allTools` definitions.
 */
export async function retrieveCandidateTools(
  query: string,
  serverUrl: string,
  apiKey: string,
  allTools: McpToolMeta[],
  limit = DEFAULT_RETRIEVAL_TOP_K,
  embedding?: { url?: string; authMode?: 'openai' | 'azure'; model?: string }
): Promise<ScoredTool[]> {
  const url = normalizeUrl(serverUrl);
  const db = await getChatMemoryDb();
  const rows = await db.getAllAsync<RegistryRow>(
    `SELECT * FROM tool_registry WHERE server_url = ?`,
    url
  );
  const byName = new Map(allTools.map((t) => [t.name, t]));
  if (!rows.length || !allTools.length) {
    return allTools.slice(0, Math.min(limit, MAX_TOOLS_FALLBACK)).map((t) => ({
      ...t,
      score: 0,
      embScore: 0,
      lexScore: 0,
    }));
  }

  const qEmb = await embedText(apiKey, query, embedding);
  const scored = rows
    .map((r) => {
      const live = byName.get(r.tool_name);
      if (!live) return null;
      const lex = lexicalScore(query, r.tool_doc);
      const emb = qEmb ? cosine(qEmb.vec, parseEmbedding(r.embedding_json) ?? []) : 0;
      const qLower = query.toLowerCase();
      const aliasBoost = r.tool_name.toLowerCase().includes(qLower) && qLower.length > 2 ? 0.1 : 0;
      const score = Math.min(1, (qEmb ? 0.7 * emb + 0.3 * lex : lex) + aliasBoost);
      return {
        ...live,
        score,
        embScore: emb,
        lexScore: lex,
      };
    })
    .filter((x): x is ScoredTool => x != null);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  if (top.length === 0) {
    return allTools.slice(0, Math.min(limit, MAX_TOOLS_FALLBACK)).map((t) => ({
      ...t,
      score: 0,
      embScore: 0,
      lexScore: 0,
    }));
  }
  return top;
}
