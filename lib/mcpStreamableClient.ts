/**
 * Minimal MCP client for Streamable HTTP (POST + JSON or SSE), compatible with React Native fetch.
 * Matches @modelcontextprotocol/sdk behavior enough for initialize, tools/list, and tools/call.
 */

import { normalizeUrl } from '@/lib/serverStorage';
import type { McpToolMeta } from '@/types/mcp';

const DEFAULT_PROTOCOL_VERSION = '2025-11-25';

function parseSseForResult(body: string, reqId: number): unknown {
  const blocks = body.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.replace(/^data:\s*/, '').trim();
      if (!jsonStr) continue;
      try {
        const msg = JSON.parse(jsonStr) as {
          id?: number;
          result?: unknown;
          error?: { message?: string; code?: number; data?: unknown };
        };
        if (msg.id !== reqId) continue;
        if (msg.error) {
          throw new Error(msg.error.message || JSON.stringify(msg.error));
        }
        return msg.result;
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  throw new Error(`No JSON-RPC result for request ${reqId} in SSE response`);
}

function extractRpcResult(raw: unknown, reqId: number): unknown {
  if (raw && typeof raw === 'object' && '__ssePayload' in raw) {
    return parseSseForResult((raw as { __ssePayload: string }).__ssePayload, reqId);
  }
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  for (const msg of list) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as { id?: number; result?: unknown; error?: { message?: string } };
    if (m.id !== reqId) continue;
    if (m.error) {
      throw new Error(m.error.message || JSON.stringify(m.error));
    }
    return m.result;
  }
  throw new Error(`No JSON-RPC result for request ${reqId}`);
}

export class McpStreamableClient {
  private readonly endpoint: string;
  private readonly authHeaders: Record<string, string>;
  private sessionId?: string;
  private protocolVersion = DEFAULT_PROTOCOL_VERSION;
  private rpcId = 0;

  constructor(baseUrl: string, authHeaders: Record<string, string>) {
    this.endpoint = normalizeUrl(baseUrl);
    this.authHeaders = { ...authHeaders };
  }

  private nextId(): number {
    return ++this.rpcId;
  }

  private async post(body: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'frontier/1.0',
      ...this.authHeaders,
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }
    if (this.protocolVersion) {
      headers['mcp-protocol-version'] = this.protocolVersion;
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) {
      this.sessionId = sid;
    }

    if (res.status === 202) {
      await res.text().catch(() => {});
      return null;
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 500)}`);
    }

    const ct = res.headers.get('content-type') || '';

    if (ct.includes('application/json')) {
      return res.json();
    }
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      return { __ssePayload: text };
    }

    const txt = await res.text();
    if (!txt.trim()) return null;
    try {
      return JSON.parse(txt);
    } catch {
      throw new Error(`Unexpected response: ${txt.slice(0, 200)}`);
    }
  }

  async connect(): Promise<void> {
    const id = this.nextId();
    const raw = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'frontier', version: '1.0.0' },
      },
    });
    const result = extractRpcResult(raw, id) as {
      protocolVersion?: string;
      capabilities?: unknown;
    };
    if (result?.protocolVersion) {
      this.protocolVersion = result.protocolVersion;
    }

    await this.post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  async listTools(): Promise<McpToolMeta[]> {
    const id = this.nextId();
    const raw = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'tools/list',
      params: {},
    });
    const result = extractRpcResult(raw, id) as { tools?: McpToolMeta[] };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId();
    const raw = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return extractRpcResult(raw, id);
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    const sid = this.sessionId;
    this.sessionId = undefined;
    try {
      const headers: Record<string, string> = {
        ...this.authHeaders,
        'mcp-session-id': sid,
      };
      if (this.protocolVersion) {
        headers['mcp-protocol-version'] = this.protocolVersion;
      }
      const res = await fetch(this.endpoint, {
        method: 'DELETE',
        headers,
      });
      await res.text().catch(() => {});
    } catch {
      /* ignore */
    }
  }
}
