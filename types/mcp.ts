/** Remote MCP transports that work on mobile (stdio servers are desktop-only). */
export type McpTransport = 'http' | 'sse';

export interface McpServer {
  id: string;
  name: string;
  /** MCP endpoint base URL (no trailing slash). */
  baseUrl: string;
  transport: McpTransport;
  /** Header name for the secret token, e.g. Authorization or X-Api-Key. */
  authHeaderName: string;
  createdAt: number;
}

/** Tool entry from tools/list (subset of MCP schema). */
export type McpToolMeta = {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};
