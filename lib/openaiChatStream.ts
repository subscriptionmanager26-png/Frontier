/**
 * OpenAI Chat Completions SSE stream: aggregate text + tool_calls deltas.
 */

import type { ChatMessage, OpenAiTool } from '@/lib/openaiMcpChatTypes';

const API = 'https://api.openai.com/v1/chat/completions';

export type StreamedTurn = {
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  finish_reason: string | null;
};

export type StreamChatOptions = {
  /** Fired once when the model starts emitting tool_calls; use to clear provisional streamed text. */
  onToolCallsStarted?: () => void;
};

export type ChatApiTarget = {
  /** Full chat completions URL (OpenAI or Azure). */
  url?: string;
  /** OpenAI => Authorization: Bearer; Azure => api-key header */
  authMode?: 'openai' | 'azure';
};

export async function streamChatCompletion(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: OpenAiTool[] | undefined,
  onDelta: (text: string) => void,
  options?: StreamChatOptions,
  api?: ChatApiTarget
): Promise<StreamedTurn> {
  const apiUrl = api?.url?.trim() || API;
  const authHeader: Record<string, string> =
    (api?.authMode ?? 'openai') === 'azure'
      ? { 'api-key': apiKey }
      : { Authorization: `Bearer ${apiKey}` };
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI API ${res.status}: ${t.slice(0, 600)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    // Some RN/Expo runtimes return a successful response but do not expose a ReadableStream body.
    // Fallback to a regular non-streaming completion so chat still works.
    const nonStreamRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify({ ...body, stream: false }),
    });
    if (!nonStreamRes.ok) {
      const t = await nonStreamRes.text();
      throw new Error(`AI API ${nonStreamRes.status}: ${t.slice(0, 600)}`);
    }
    const j = (await nonStreamRes.json()) as {
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            type?: 'function';
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const c0 = j.choices?.[0];
    const fullContent = c0?.message?.content ?? '';
    if (fullContent) {
      onDelta(fullContent);
    }
    const tcs = c0?.message?.tool_calls;
    const tool_calls =
      tcs?.length
        ? tcs.map((tc, i) => ({
            id: tc.id || `call_${Date.now()}_${i}`,
            type: 'function' as const,
            function: {
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '{}',
            },
          }))
        : undefined;
    if (tool_calls?.length) {
      options?.onToolCallsStarted?.();
    }
    return {
      content: fullContent,
      tool_calls,
      finish_reason: c0?.finish_reason ?? null,
    };
  }

  let content = '';
  let toolCallsStarted = false;
  const toolMap = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;
  const decoder = new TextDecoder();
  let carry = '';

  while (true) {
    const { done, value } = await reader.read();
    carry += done ? '' : decoder.decode(value, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
        };
        const choice = json.choices?.[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        const delta = choice?.delta;
        if (delta?.content) {
          content += delta.content;
          if (!toolCallsStarted) {
            onDelta(delta.content);
          }
        }
        if (delta?.tool_calls) {
          if (!toolCallsStarted) {
            toolCallsStarted = true;
            options?.onToolCallsStarted?.();
          }
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolMap.get(idx) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments != null) cur.args += tc.function.arguments;
            toolMap.set(idx, cur);
          }
        }
      } catch {
        /* ignore malformed chunk */
      }
    }

    if (done) break;
  }

  const tool_calls =
    toolMap.size > 0
      ? Array.from(toolMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => ({
            id: v.id || `call_${Date.now()}`,
            type: 'function' as const,
            function: { name: v.name, arguments: v.args },
          }))
      : undefined;

  return { content, tool_calls, finish_reason: finishReason };
}
