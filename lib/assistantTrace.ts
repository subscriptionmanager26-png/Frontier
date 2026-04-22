/**
 * Persisted "thinking" / execution trace for assistant messages (Cursor-style steps).
 */

export type TraceStep = {
  id: string;
  kind: 'setup' | 'tool' | 'model_note';
  title: string;
  subtitle?: string;
  detail?: string;
  /** Short preview always shown for tool results */
  outputPreview?: string;
  /** Full tool output; UI starts collapsed when this is long */
  outputFull?: string;
};

const MARK_START = '---MCM_TRACE---\n';
const MARK_BODY = '\n---MCM_BODY---\n';

export function newTraceStep(partial: Omit<TraceStep, 'id'> & { id?: string }): TraceStep {
  return {
    id: partial.id ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ...partial,
  };
}

/** Strip large payloads for SQLite; keep previews only. */
export function slimTraceForStorage(steps: TraceStep[]): TraceStep[] {
  return steps.map((s) => {
    const out: TraceStep = {
      id: s.id,
      kind: s.kind,
      title: s.title,
      subtitle: s.subtitle,
      detail: s.detail,
      outputPreview: s.outputPreview,
    };
    if (s.outputFull && s.outputFull.length <= 800) {
      out.outputFull = s.outputFull;
    } else if (s.outputFull) {
      out.outputPreview = s.outputPreview ?? `${s.outputFull.slice(0, 500)}…`;
    }
    return out;
  });
}

export function packAssistantContent(steps: TraceStep[], body: string): string {
  const payload = JSON.stringify({ v: 1, steps: slimTraceForStorage(steps) });
  return `${MARK_START}${payload}${MARK_BODY}${body}`;
}

export function unpackAssistantContent(content: string): {
  trace: TraceStep[] | null;
  body: string;
} {
  if (!content.startsWith(MARK_START)) {
    return { trace: null, body: content };
  }
  const bodyIdx = content.indexOf(MARK_BODY);
  if (bodyIdx === -1) {
    return { trace: null, body: content };
  }
  const jsonPart = content.slice(MARK_START.length, bodyIdx);
  const body = content.slice(bodyIdx + MARK_BODY.length);
  try {
    const j = JSON.parse(jsonPart) as { v?: number; steps?: TraceStep[] };
    if (j.v === 1 && Array.isArray(j.steps)) {
      return { trace: j.steps, body };
    }
  } catch {
    /* fall through */
  }
  return { trace: null, body: content };
}

/** Extract optional <thinking>...</thinking> from model output; remainder is user-visible body. */
export function extractThinkingBlock(text: string): { body: string; thinking?: string } {
  const re = /<thinking>([\s\S]*?)<\/thinking>/i;
  const m = text.match(re);
  if (!m) return { body: text.trim() };
  const thinking = m[1]!.trim();
  const body = text.replace(re, '').trim();
  return { body, thinking: thinking || undefined };
}
