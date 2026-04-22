/**
 * Gateway root used for `GET /.well-known/agent-card.json` and discovery.
 * If `url` is a per-agent JSON-RPC endpoint (`.../a2a/v1/:slug`), strip that path so well-known is not requested under `/a2a/v1/...`.
 */
export function gatewayRootForAgentDiscovery(url: string): string {
  const t = url.trim().replace(/\/+$/, '');
  const m = t.match(/^(.*)\/a2a\/v1\/[^/]+$/i);
  return (m ? m[1]! : t).replace(/\/+$/, '');
}
