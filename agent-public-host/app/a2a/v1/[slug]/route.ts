import { proxyToA2aGateway } from '@/lib/proxyGateway';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const enc = encodeURIComponent(slug);
  return proxyToA2aGateway(`/a2a/v1/${enc}`, req);
}
