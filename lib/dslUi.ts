export type ClassifiedPayload =
  | { kind: 'dsl'; dsl: string }
  | { kind: 'text_json'; content: string }
  | { kind: 'plain'; content: string };

export function classifyAgentPayload(raw: string): ClassifiedPayload {
  const text = (raw || '').trim();
  if (!text) return { kind: 'plain', content: '' };
  if (text.startsWith('root =')) return { kind: 'dsl', dsl: raw };
  try {
    const j = JSON.parse(text) as { type?: string; content?: string };
    if (j?.type === 'text' && typeof j.content === 'string') {
      return { kind: 'text_json', content: j.content };
    }
  } catch {
    // plain fallback
  }
  return { kind: 'plain', content: raw };
}

type Ref = { __ref: string };
type Value = string | number | boolean | null | Ref | Value[];

export type ParsedDsl = {
  rootId: string;
  nodes: Record<string, { component: string; args: Value[] }>;
  vars: Record<string, Value>;
};

function isRef(v: Value): v is Ref {
  return !!v && typeof v === 'object' && !Array.isArray(v) && '__ref' in v;
}

function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '(' || ch === '{') depth += 1;
    if (ch === ']' || ch === ')' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseValue(token: string): Value {
  const t = token.trim();
  if (!t) return '';
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map(parseValue);
  }
  return { __ref: t };
}

export function parseDsl(dsl: string): ParsedDsl | null {
  const lines = dsl.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('root =')) return null;
  const nodes: Record<string, { component: string; args: Value[] }> = {};
  const vars: Record<string, Value> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!m) continue;
    const id = m[1]!;
    const rhs = m[2]!.trim();
    const c = rhs.match(/^([A-Za-z_][\w.]*)\(([\s\S]*)\)$/);
    if (c) {
      const component = c[1]!;
      const argsRaw = c[2]!.trim();
      const args = argsRaw ? splitTopLevel(argsRaw).map(parseValue) : [];
      nodes[id] = { component, args };
    } else {
      vars[id] = parseValue(rhs);
    }
  }
  const rootRef = vars.root;
  const rootId = isRef(rootRef) ? rootRef.__ref : 'root';
  if (!nodes[rootId]) return null;
  return { rootId, nodes, vars };
}
