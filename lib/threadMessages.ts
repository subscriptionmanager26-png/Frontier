/** Minimal shape for threading (matches AgentUiMessage fields used here). */
export type ThreadableMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  replyToId?: string | null;
};

/** Walk replyToId links from leaf up to root; return [root … leaf]. */
export function orderedChainFromLeaf<T extends ThreadableMessage>(messages: T[], leafId: string): T[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const chain: T[] = [];
  let id: string | undefined = leafId;
  const guard = new Set<string>();
  while (id) {
    if (guard.has(id)) break;
    guard.add(id);
    const m = byId.get(id);
    if (!m) break;
    chain.push(m);
    id = m.replyToId ?? undefined;
  }
  return chain.reverse();
}

export type ThreadedMessage<T extends ThreadableMessage = ThreadableMessage> = T & { depth: number };

/**
 * Discord-style order: each root thread, then DFS by replyToId with stable id sort.
 */
export function flattenThreadMessages<T extends ThreadableMessage>(messages: T[]): ThreadedMessage<T>[] {
  if (messages.length === 0) return [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  const isRoot = (m: T) => !m.replyToId || !byId.has(m.replyToId);
  const roots = messages.filter(isRoot).sort((a, b) => a.id.localeCompare(b.id));
  const out: ThreadedMessage<T>[] = [];
  const visited = new Set<string>();

  const childrenOf = (parentId: string) =>
    messages.filter((m) => m.replyToId === parentId).sort((a, b) => a.id.localeCompare(b.id));

  function visit(id: string, depth: number) {
    if (visited.has(id)) return;
    const m = byId.get(id);
    if (!m) return;
    visited.add(id);
    out.push({ ...m, depth });
    for (const c of childrenOf(id)) {
      visit(c.id, depth + 1);
    }
  }

  for (const r of roots) {
    visit(r.id, 0);
  }

  for (const m of messages) {
    if (!visited.has(m.id)) {
      visit(m.id, 0);
    }
  }

  return out;
}

export function previewText(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Walk replyToId up until a root (no parent or missing parent). */
export function threadRootIdForMessage<T extends ThreadableMessage>(messages: T[], id: string): string {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let cur = id;
  const guard = new Set<string>();
  while (cur) {
    if (guard.has(cur)) break;
    guard.add(cur);
    const m = byId.get(cur);
    if (!m) return cur;
    const pid = m.replyToId;
    if (!pid || !byId.has(pid)) return cur;
    cur = pid;
  }
  return cur;
}

/** All messages belonging to the same thread as `rootId`, in channel order. */
export function messagesInThreadOrdered<T extends ThreadableMessage>(messages: T[], rootId: string): T[] {
  const inThread = messages.filter((m) => threadRootIdForMessage(messages, m.id) === rootId);
  const order = new Map(messages.map((m, i) => [m.id, i]));
  return inThread.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
}

/** Thread starter messages (no valid parent), in channel order. */
export function listThreadRoots<T extends ThreadableMessage>(messages: T[]): T[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let roots = messages.filter((m) => {
    if (!m.replyToId) return true;
    if (!byId.has(m.replyToId)) return true;
    return false;
  });
  /** Closed reply chains would yield zero roots; still show one entry so the hub is not blank. */
  if (roots.length === 0 && messages.length > 0) {
    roots = [...messages].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1);
  }
  const order = new Map(messages.map((m, i) => [m.id, i]));
  return roots.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
}
