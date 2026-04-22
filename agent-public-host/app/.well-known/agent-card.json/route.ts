import { proxyToA2aGateway } from '@/lib/proxyGateway';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.search;
  return proxyToA2aGateway(`/.well-known/agent-card.json${q}`, req);
}
