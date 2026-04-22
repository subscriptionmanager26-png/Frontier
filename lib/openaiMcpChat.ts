import {
  extractThinkingBlock,
  newTraceStep,
  packAssistantContent,
  type TraceStep,
} from '@/lib/assistantTrace';
import { streamChatCompletion } from '@/lib/openaiChatStream';
import type { ChatMessage, OpenAiTool } from '@/lib/openaiMcpChatTypes';
import { McpStreamableClient } from '@/lib/mcpStreamableClient';
import {
  buildRetrievalQuery,
  DEFAULT_RETRIEVAL_TOP_K,
  retrieveCandidateTools,
  syncToolRegistry,
} from '@/lib/toolRegistry';
import type { McpToolMeta } from '@/types/mcp';

export type { ChatMessage, OpenAiTool } from '@/lib/openaiMcpChatTypes';

const MAX_TOOL_ROUNDS = 8;

function deriveAzureEmbeddingsUrl(azureChatUrl: string): string | null {
  const u = azureChatUrl.trim();
  if (!u) return null;
  // Typical Azure path: .../chat/completions?api-version=...
  if (u.includes('/chat/completions')) {
    return u.replace('/chat/completions', '/embeddings');
  }
  return null;
}

export function buildSystemPrompt(): string {
  return [
    'You are a helpful assistant. A curated subset of MCP tools is provided each turn (chosen by relevance to the user message). Use them when they help answer the user; if none apply, answer without tools. Summarize tool results clearly.',
    '',
    'You may put brief private reasoning or a step plan in <thinking>...</thinking> at the start of your reply; it will be shown separately from the main answer.',
    '',
    'Formatting: use Markdown (headings, **bold**, *italic*, lists, fenced code). For math use $inline$ and $$display$$ LaTeX.',
    '',
    'Optional structured UI (rendered natively in the app): include one or more fenced blocks exactly as:',
    '```mcp-ui',
    '{"version":1,"blocks":[{"type":"notice","variant":"info","title":"Title","body":"Short message"},',
    '{"type":"keyValue","rows":[{"k":"Label","v":"Value"}]},',
    '{"type":"bulletList","items":["First","Second"]},',
    '{"type":"buttonRow","buttons":[{"label":"Copy suggestion","actionId":"text the user can paste as follow-up"}]},',
    '{"type":"image","src":{"url":"https://...","caption":"Optional caption"},"alt":"Optional alt"},',
    '{"type":"video","src":{"url":"https://...","posterUrl":"https://...","caption":"Optional caption"}},',
    '{"type":"audio","src":{"url":"https://..."},"title":"Optional track title","artist":"Optional artist"},',
    '{"type":"file","url":"https://...","name":"Report.pdf","mimeType":"application/pdf","sizeBytes":12345},',
    '{"type":"gallery","title":"Optional","items":[{"src":{"url":"https://..."},"alt":"Optional"}]},',
    '{"type":"linkPreview","url":"https://...","title":"Optional title","description":"Optional summary","imageUrl":"https://...","siteName":"Optional site"}]}',
    '```',
    'Only these block types are supported: notice (variant: info|success|warning|error), keyValue, bulletList, buttonRow, image, video, audio, file, gallery, linkPreview. Use only http/https URLs. Do not put executable code in UI JSON.',
  ].join('\n');
}

function mcpToolToOpenAI(t: McpToolMeta): OpenAiTool {
  const schema =
    t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
      ? (t.inputSchema as Record<string, unknown>)
      : { type: 'object', properties: {} };
  return {
    type: 'function',
    function: {
      name: t.name,
      description: (t.description || `MCP tool ${t.name}`).slice(0, 8000),
      parameters: schema,
    },
  };
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type StreamAssistantCallbacks = {
  onTraceStep: (step: TraceStep) => void;
  /** Streamed visible tokens for the final assistant reply (after tools). Tool rounds may stream empty or partial. */
  onDelta: (text: string) => void;
  /** Replace entire visible buffer (e.g. after stripping <thinking>). */
  onReplaceBody?: (text: string) => void;
};

/**
 * Streaming chat with MCP tools + execution trace for the Thinking panel.
 */
export async function runAssistantStreamWithOptionalMcp(
  input: {
    apiKey: string;
    model: string;
    apiUrl?: string;
    apiAuthMode?: 'openai' | 'azure';
    history: ChatTurn[];
    userMessage: string;
    mcp: { baseUrl: string; headers: Record<string, string> } | null;
  },
  cb: StreamAssistantCallbacks
): Promise<{ text: string; traceSteps: TraceStep[]; toolNotes: string[] }> {
  const toolNotes: string[] = [];
  const traceSteps: TraceStep[] = [];
  const push = (step: TraceStep) => {
    traceSteps.push(step);
    cb.onTraceStep(step);
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...input.history.map((h) => ({ role: h.role, content: h.content } as ChatMessage)),
    { role: 'user', content: input.userMessage },
  ];

  let tools: OpenAiTool[] | undefined;
  let client: McpStreamableClient | null = null;

  const embeddingTarget =
    input.apiAuthMode === 'azure' && input.apiUrl
      ? {
          url: deriveAzureEmbeddingsUrl(input.apiUrl) ?? undefined,
          authMode: 'azure' as const,
          // In Azure, embeddings model is typically the deployment name.
          model: input.model,
        }
      : undefined;

  if (input.mcp) {
    push(
      newTraceStep({
        kind: 'setup',
        title: 'Connecting to MCP server',
        subtitle: input.mcp.baseUrl,
      })
    );
    try {
      client = new McpStreamableClient(input.mcp.baseUrl, input.mcp.headers);
      await client.connect();
      const list = await client.listTools();
      if (!list.length) {
        tools = undefined;
        push(newTraceStep({ kind: 'setup', title: 'No tools reported by MCP', detail: 'Chat continues without tools.' }));
      } else {
        try {
          await syncToolRegistry(input.mcp.baseUrl, list, input.apiKey, embeddingTarget);
          push(newTraceStep({ kind: 'setup', title: 'Tool registry synced', detail: `${list.length} tools on server` }));
        } catch {
          push(
            newTraceStep({
              kind: 'setup',
              title: 'Tool registry sync partial failure',
              detail: 'Retrieval may use stale embeddings.',
            })
          );
        }
        const retrievalQuery = buildRetrievalQuery(input.userMessage, input.history);
        let candidates: McpToolMeta[];
        try {
          candidates = await retrieveCandidateTools(
            retrievalQuery,
            input.mcp.baseUrl,
            input.apiKey,
            list,
            DEFAULT_RETRIEVAL_TOP_K,
            embeddingTarget
          );
        } catch {
          candidates = list.slice(0, DEFAULT_RETRIEVAL_TOP_K);
        }
        tools = candidates.map(mcpToolToOpenAI);
        toolNotes.push(`MCP tools: ${tools.length} of ${list.length} passed to model (retrieval).`);
        push(
          newTraceStep({
            kind: 'setup',
            title: 'Tool retrieval',
            detail: `Sending ${tools.length} of ${list.length} tools to the model`,
          })
        );
        if (!tools.length) {
          tools = undefined;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toolNotes.push(`MCP tools unavailable: ${msg}`);
      push(newTraceStep({ kind: 'setup', title: 'MCP unavailable', detail: msg }));
      tools = undefined;
      if (client) {
        await client.close().catch(() => {});
        client = null;
      }
    }
  }

  try {
    let rounds = 0;
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds += 1;
      push(
        newTraceStep({
          kind: 'setup',
          title: `Model request (round ${rounds})`,
          subtitle: 'Streaming…',
        })
      );

      const turn = await streamChatCompletion(
        input.apiKey,
        input.model,
        messages,
        tools,
        (d) => {
          cb.onDelta(d);
        },
        {
          onToolCallsStarted: () => {
            cb.onReplaceBody?.('');
          },
        },
        {
          url: input.apiUrl,
          authMode: input.apiAuthMode ?? 'openai',
        }
      );

      const tcalls = turn.tool_calls;
      if (tcalls?.length && client) {
        messages.push({
          role: 'assistant',
          content: turn.content || null,
          tool_calls: tcalls,
        });
        for (const tc of tcalls) {
          const argsPreview = (tc.function.arguments || '').slice(0, 280);
          push(
            newTraceStep({
              kind: 'tool',
              title: `Calling ${tc.function.name}`,
              subtitle: argsPreview || '{}',
            })
          );
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            args = {};
          }
          try {
            const out = await client.callTool(tc.function.name, args);
            const full = JSON.stringify(out, null, 2).slice(0, 120_000);
            const COLLAPSE_AFTER = 600;
            toolNotes.push(`Tool ${tc.function.name}: ok`);
            push(
              newTraceStep({
                kind: 'tool',
                title: `Result: ${tc.function.name}`,
                outputPreview:
                  full.length > COLLAPSE_AFTER ? `${full.slice(0, COLLAPSE_AFTER)}…` : full,
                outputFull: full.length > COLLAPSE_AFTER ? full : undefined,
              })
            );
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: full,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toolNotes.push(`Tool ${tc.function.name}: ${msg}`);
            push(
              newTraceStep({
                kind: 'tool',
                title: `Error: ${tc.function.name}`,
                detail: msg,
              })
            );
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ error: msg }),
            });
          }
        }
        continue;
      }

      let body = (turn.content || '').trim();
      if (!body && tcalls?.length && !client) {
        return {
          text: 'Tools were requested but MCP is not connected.',
          traceSteps,
          toolNotes,
        };
      }

      const extracted = extractThinkingBlock(body);
      if (extracted.thinking) {
        push(
          newTraceStep({
            kind: 'model_note',
            title: 'Model reasoning',
            detail: extracted.thinking,
          })
        );
        body = extracted.body;
        cb.onReplaceBody?.(body);
      }

      push(
        newTraceStep({
          kind: 'setup',
          title: 'Reply complete',
          subtitle: body ? `${body.length} characters` : 'Empty',
        })
      );

      return {
        text: body || '(No text reply)',
        traceSteps,
        toolNotes,
      };
    }

    return {
      text: 'Stopped after maximum tool rounds.',
      traceSteps,
      toolNotes,
    };
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

/** Non-streaming wrapper (collects final text only). */
export async function runAssistantWithOptionalMcp(input: {
  apiKey: string;
  model: string;
  apiUrl?: string;
  apiAuthMode?: 'openai' | 'azure';
  history: ChatTurn[];
  userMessage: string;
  mcp: { baseUrl: string; headers: Record<string, string> } | null;
}): Promise<{ text: string; toolNotes: string[] }> {
  const { text: final, toolNotes } = await runAssistantStreamWithOptionalMcp(input, {
    onTraceStep: () => {},
    onDelta: () => {},
    onReplaceBody: () => {},
  });
  return { text: final, toolNotes };
}

export function packMessageForStorage(traceSteps: TraceStep[], body: string): string {
  return packAssistantContent(traceSteps, body);
}
