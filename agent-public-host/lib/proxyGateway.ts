/**
 * Forwards selected headers to Supabase `a2a-gateway` so JSON-RPC and auth behave like a direct call.
 */

const HEADER_ALLOWLIST = [
  'authorization',
  'content-type',
  'a2a-version',
  'accept',
  'x-supabase-access-token',
  'x-client-info',
  'apikey',
  'x-a2a-push-channel',
  'x-a2a-push-token',
  'ngrok-skip-browser-warning',
];

function upstreamBase(): string {
  const u = process.env.SUPABASE_A2A_GATEWAY_URL?.trim().replace(/\/+$/, '');
  if (!u) {
    throw new Error('Missing SUPABASE_A2A_GATEWAY_URL (full URL to a2a-gateway, no trailing slash)');
  }
  return u;
}

function applyDefaultSupabaseKeys(headers: Headers): void {
  const anon = process.env.SUPABASE_ANON_KEY?.trim();
  if (!anon) return;
  if (!headers.has('authorization')) {
    headers.set('authorization', `Bearer ${anon}`);
  }
  if (!headers.has('apikey')) {
    headers.set('apikey', anon);
  }
}

export async function proxyToA2aGateway(pathWithQuery: string, incoming: Request): Promise<Response> {
  const base = upstreamBase();
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  const url = `${base}${path}`;

  const headers = new Headers();
  for (const name of HEADER_ALLOWLIST) {
    const v = incoming.headers.get(name);
    if (v) headers.set(name, v);
  }
  applyDefaultSupabaseKeys(headers);

  const method = incoming.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: hasBody ? await incoming.text() : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({
        error: 'upstream_fetch_failed',
        message: msg,
        upstream: url.replace(/\/\/[^/]+\//, '//…/'),
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  const out = new Headers();
  const ct = res.headers.get('content-type');
  if (ct) out.set('content-type', ct);
  const acao = res.headers.get('access-control-allow-origin');
  if (acao) out.set('access-control-allow-origin', acao);
  const acah = res.headers.get('access-control-allow-headers');
  if (acah) out.set('access-control-allow-headers', acah);
  const acam = res.headers.get('access-control-allow-methods');
  if (acam) out.set('access-control-allow-methods', acam);

  const text = await res.text();
  return new Response(text, { status: res.status, headers: out });
}
