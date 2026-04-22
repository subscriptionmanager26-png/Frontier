/**
 * Split assistant (or user) message into renderable segments: optional mcp-ui fences,
 * then markdown interleaved with LaTeX ($...$ / $$...$$). Code fences are protected
 * so $$ inside ``` is not treated as math.
 */

export type ChatSegment =
  | { type: 'markdown'; text: string }
  | { type: 'mcpUi'; rawJson: string };

const MCP_UI_FENCE = /```mcp-ui\s*\n([\s\S]*?)```/gi;

export function splitMcpUiFences(content: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let last = 0;
  const re = new RegExp(MCP_UI_FENCE.source, MCP_UI_FENCE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'markdown', text: content.slice(last, m.index) });
    }
    segments.push({ type: 'mcpUi', rawJson: (m[1] ?? '').trim() });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push({ type: 'markdown', text: content.slice(last) });
  }
  return segments.length ? segments : [{ type: 'markdown', text: content }];
}

/** Placeholders for fenced code so math split ignores ```...$$...``` */
const CODE_PH = (i: number) => `\uE000CODE${i}\uE001`;

function extractCodeFences(text: string): { masked: string; codes: string[] } {
  const codes: string[] = [];
  const masked = text.replace(/```[\s\S]*?```/g, (block) => {
    const i = codes.length;
    codes.push(block);
    return CODE_PH(i);
  });
  return { masked, codes };
}

function restoreCodeFences(fragment: string, codes: string[]): string {
  let s = fragment;
  for (let i = 0; i < codes.length; i += 1) {
    s = s.split(CODE_PH(i)).join(codes[i]!);
  }
  return s;
}

export type MathPart =
  | { kind: 'markdown'; text: string }
  | { kind: 'mathBlock'; latex: string }
  | { kind: 'mathInline'; latex: string };

/** Split one markdown segment into markdown + math (block $$ then inline $). */
export function splitMarkdownWithMath(markdown: string): MathPart[] {
  const { masked, codes } = extractCodeFences(markdown);
  const normalized = normalizeLatexDelimiters(masked);
  const parts = splitMathOnMasked(normalized);
  const out: MathPart[] = [];
  for (const p of parts) {
    if (p.kind === 'markdown') {
      out.push({ kind: 'markdown', text: restoreCodeFences(p.text, codes) });
    } else {
      out.push(p);
    }
  }
  return out.length ? out : [{ kind: 'markdown', text: markdown }];
}

/**
 * Some models prefer TeX delimiters \( ... \) and \[ ... \].
 * Normalize them to $...$ / $$...$$ so the existing parser can render math.
 */
function normalizeLatexDelimiters(text: string): string {
  return text.replace(/\\\[((?:.|\n)*?)\\\]/g, (_, inner: string) => `$$${inner}$$`)
    .replace(/\\\(((?:.|\n)*?)\\\)/g, (_, inner: string) => `$${inner}$`);
}

function splitMathOnMasked(src: string): MathPart[] {
  const out: MathPart[] = [];
  const blockRe = /\$\$([\s\S]*?)\$\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src)) !== null) {
    if (m.index > last) {
      out.push(...splitInlineMathMasked(src.slice(last, m.index)));
    }
    out.push({ kind: 'mathBlock', latex: m[1]!.trim() });
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    out.push(...splitInlineMathMasked(src.slice(last)));
  }
  return out.length ? out : splitInlineMathMasked(src);
}

function splitInlineMathMasked(text: string): MathPart[] {
  const parts: MathPart[] = [];
  const re = /\$([^\$\n]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ kind: 'markdown', text: text.slice(last, m.index) });
    }
    parts.push({ kind: 'mathInline', latex: m[1]!.trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'markdown', text: text.slice(last) });
  }
  return parts.length ? parts : [{ kind: 'markdown', text }];
}
