/** Public docs listing OAuth redirect allowlist and MCP URLs. */
export const SWIGGY_MCP_MANIFEST =
  'https://github.com/Swiggy/swiggy-mcp-server-manifest';

export function isSwiggyMcpUrl(url: string): boolean {
  return url.includes('mcp.swiggy.com');
}

/**
 * Swiggy documents a fixed set of OAuth redirect URIs (Claude, Cursor, VS Code,
 * Postman, localhost, etc.). This app uses `frontier://oauth` via Expo,
 * which is not on that list unless Swiggy whitelists it — sign-in often fails at
 * authorization or token exchange with redirect_uri errors.
 */
export function appendSwiggyMcpHintIfNeeded(baseUrl: string, message: string): string {
  if (!isSwiggyMcpUrl(baseUrl)) return message;
  if (message.includes('swiggy-mcp-server-manifest')) return message;
  if (message === 'Sign-in was cancelled.') return message;
  return `${message}\n\nFor Swiggy, this app signs in with an in-app browser and captures http://127.0.0.1/callback (no service listens on the phone). If errors persist, see ${SWIGGY_MCP_MANIFEST} or use “Advanced: paste token” / Cursor or Claude Desktop.`;
}
