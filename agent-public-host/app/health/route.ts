import { proxyToA2aGateway } from '@/lib/proxyGateway';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return proxyToA2aGateway('/health', req);
}
