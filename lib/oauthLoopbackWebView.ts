import { DeviceEventEmitter } from 'react-native';

export const LOOPBACK_OAUTH_START = 'mcp_LOOPBACK_OAUTH_START';
export const LOOPBACK_OAUTH_CANCEL = 'mcp_LOOPBACK_OAUTH_CANCEL';
const LOOPBACK_OAUTH_CAPTURED = 'mcp_LOOPBACK_OAUTH_CAPTURED';

export type LoopbackOAuthStartPayload = {
  /** Correlates this session with the WebView modal. */
  id: string;
  authUrl: string;
};

/**
 * Opens the in-app WebView (via OAuthLoopbackWebViewHost) and resolves when the IdP
 * redirects to http://127.0.0.1/callback?... — no HTTP server is required; we read the URL
 * from the navigation before the load fails.
 */
export function requestLoopbackOAuthUrl(payload: LoopbackOAuthStartPayload): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => {
      subCancel.remove();
      subCap.remove();
    };
    const subCancel = DeviceEventEmitter.addListener(LOOPBACK_OAUTH_CANCEL, (cancelId: string) => {
      if (cancelId !== payload.id || settled) return;
      settled = true;
      done();
      reject(new Error('Sign-in was cancelled.'));
    });
    const subCap = DeviceEventEmitter.addListener(
      LOOPBACK_OAUTH_CAPTURED,
      (data: { id: string; url: string }) => {
        if (data.id !== payload.id || settled) return;
        settled = true;
        done();
        resolve(data.url);
      }
    );
    DeviceEventEmitter.emit(LOOPBACK_OAUTH_START, payload);
  });
}

export function emitLoopbackOAuthCaptured(id: string, url: string): void {
  DeviceEventEmitter.emit(LOOPBACK_OAUTH_CAPTURED, { id, url });
}

export function emitLoopbackOAuthCancel(id: string): void {
  DeviceEventEmitter.emit(LOOPBACK_OAUTH_CANCEL, id);
}

/** Swiggy / desktop-style loopback redirects (must match provider allowlist). */
export function isLoopbackOAuthRedirect(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost') return false;
    const p = u.pathname.replace(/\/$/, '') || '/';
    return p === '/callback' || p.endsWith('/callback');
  } catch {
    return false;
  }
}

/** redirect_uri for authorize + token (RFC 6749 must match exactly). */
export const LOOPBACK_REDIRECT_URI = 'http://localhost/callback';

export function shouldUseLoopbackWebViewForUrl(serverBaseUrl: string): boolean {
  return serverBaseUrl.includes('mcp.swiggy.com');
}
