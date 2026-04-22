import { COMPONENT_TOOLS, type RenderToolName, type RenderedComponent } from '@/lib/agent/tools';
import { SYSTEM_PROMPT } from '@/lib/agent/prompt';

export type AgentTurn = {
  role: 'user' | 'assistant';
  text: string;
};

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

type AgentClientInput = {
  provider: 'anthropic' | 'openai' | 'azure';
  apiKey: string;
  model: string;
  turns: AgentTurn[];
  azureUrl?: string;
};

export type ParsedAgentOutput = {
  text: string;
  components: RenderedComponent[];
  providerUsed: 'anthropic' | 'openai' | 'azure';
};

const TOOL_NAMES = new Set<string>(COMPONENT_TOOLS.map((t) => t.name));

function isKnownRenderTool(name: string): name is RenderToolName {
  return TOOL_NAMES.has(name);
}

function toOpenAiTools() {
  return COMPONENT_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function toOpenAiMessages(turns: AgentTurn[]) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...turns.map((t) => ({ role: t.role, content: t.text })),
  ];
}

function safeParseJson(input: unknown): unknown {
  if (typeof input !== 'string') return input ?? {};
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

async function callAnthropic(input: AgentClientInput): Promise<ParsedAgentOutput> {
  const messages = input.turns.map((t) => ({
    role: t.role,
    content: [{ type: 'text', text: t.text }],
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model || 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: COMPONENT_TOOLS,
      tool_choice: { type: 'auto' },
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { content: AnthropicContentBlock[] };

  const textChunks: string[] = [];
  const components: RenderedComponent[] = [];

  for (const block of data.content) {
    if (block.type === 'text') {
      textChunks.push(block.text);
      continue;
    }
    if (block.type === 'tool_use') {
      if (isKnownRenderTool(block.name)) {
        components.push({
          id: block.id,
          component: block.name,
          // Schema constrains this shape at model boundary.
          props: block.input as RenderedComponent['props'],
        });
      }
    }
  }

  return {
    text: textChunks.join('\n').trim(),
    components,
    providerUsed: 'anthropic',
  };
}

async function callOpenAiCompatible(input: AgentClientInput): Promise<ParsedAgentOutput> {
  const isAzure = input.provider === 'azure';
  const url = isAzure
    ? input.azureUrl?.trim()
    : 'https://api.openai.com/v1/chat/completions';
  if (!url) {
    throw new Error('Azure chat URL is missing in Settings.');
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [isAzure ? 'api-key' : 'authorization']: isAzure ? input.apiKey : `Bearer ${input.apiKey}`,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.model,
      messages: toOpenAiMessages(input.turns),
      tools: toOpenAiTools(),
      tool_choice: 'auto',
    }),
  });
  if (!res.ok) {
    throw new Error(`${isAzure ? 'Azure' : 'OpenAI'} API ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const msg = data.choices?.[0]?.message;
  const text = msg?.content?.trim() || '';
  const components: RenderedComponent[] = [];
  for (const tc of msg?.tool_calls ?? []) {
    const name = tc.function?.name;
    if (!name || !isKnownRenderTool(name)) continue;
    components.push({
      id: tc.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      component: name,
      props: safeParseJson(tc.function?.arguments) as RenderedComponent['props'],
    });
  }
  return {
    text,
    components,
    providerUsed: input.provider,
  };
}

export async function callAgent(input: AgentClientInput): Promise<ParsedAgentOutput> {
  if (input.provider === 'anthropic') return callAnthropic(input);
  return callOpenAiCompatible(input);
}
