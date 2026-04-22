import { proxyToA2aGateway } from '@/lib/proxyGateway';
import type { NextRequest } from 'next/server';

/** Matches `buildPublicAgentsIndex` card URLs — gateway resolves slug via query. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const q = `?slug=${encodeURIComponent(slug)}`;
  return proxyToA2aGateway(`/.well-known/agent-card.json${q}`, req);
}
