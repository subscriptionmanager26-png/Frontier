/**
 * Structured logs for multi-step UX / QA flows (e.g. user A → chat with agent B → sign out → user B).
 * Persists to `a2a_logs` (and cloud via existing sync) and mirrors to Metro / logcat as [FRONTIER_FLOW].
 */
import { logA2aHop } from '@/lib/a2a/store';

export function shortUserId(id: string | null | undefined): string | null {
  if (!id?.trim()) return null;
  return `${id.trim().slice(0, 8)}…`;
}

export type UxFlowDetail = Record<string, unknown>;

export async function logUxFlow(hop: `ux.flow.${string}`, detail?: UxFlowDetail): Promise<void> {
  const userId = typeof detail?.userId === 'string' ? detail.userId : null;
  const agentUrl = typeof detail?.agentUrl === 'string' ? detail.agentUrl : undefined;
  const threadId = typeof detail?.threadId === 'string' ? detail.threadId : undefined;
  await logA2aHop({
    level: 'info',
    hop,
    status: 'ok',
    sessionId: threadId ?? undefined,
    agentUrl,
    detail: {
      ...detail,
      userShort: shortUserId(userId),
    },
  });
}
