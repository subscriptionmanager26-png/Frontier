import { Platform } from 'react-native';

const DEFAULT_TIMEOUT_MS = 35_000;

type XhrResult =
  | { kind: 'http'; status: number; statusText: string }
  | { kind: 'fail'; reason: 'timeout' | 'network' | 'nostatus' };

function formatFail(r: XhrResult & { kind: 'fail' }, timeoutMs: number): string {
  if (r.reason === 'timeout') {
    return `Timed out after ${timeoutMs / 1000}s. Try Wi‑Fi, disable VPN, or retry.`;
  }
  if (r.reason === 'network') {
    return 'Network error (TLS/DNS or no connection). Check URL, Wi‑Fi, and that the phone can open https://api.saffronai.in in a browser.';
  }
  return 'No HTTP status from server. The host may block this client or the URL may be wrong.';
}

/** Native RN: XHR respects .timeout reliably; fetch+AbortController often misbehaves on Android for some hosts. */
function xhrProbe(
  method: 'HEAD' | 'GET',
  url: string,
  headerMap: Record<string, string>,
  timeoutMs: number
): Promise<XhrResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = timeoutMs;

    const finishHttp = () => {
      const status = xhr.status;
      const statusText = xhr.statusText || '';
      if (status === 0) {
        resolve({ kind: 'fail', reason: 'nostatus' });
        return;
      }
      resolve({ kind: 'http', status, statusText });
    };

    xhr.onerror = () => resolve({ kind: 'fail', reason: 'network' });
    xhr.ontimeout = () => resolve({ kind: 'fail', reason: 'timeout' });
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== XMLHttpRequest.DONE) return;
      finishHttp();
    };

    try {
      xhr.open(method, url, true);
      for (const [k, v] of Object.entries(headerMap)) {
        xhr.setRequestHeader(k, v);
      }
      xhr.send();
    } catch {
      resolve({ kind: 'fail', reason: 'network' });
    }
  });
}

async function testWithXhr(
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ reachable: boolean; detail: string; status: number | null }> {
  const merged: Record<string, string> = { Accept: '*/*', ...headers };

  let first = await xhrProbe('HEAD', baseUrl, merged, timeoutMs);
  if (first.kind === 'fail') {
    const getFallback = await xhrProbe(
      'GET',
      baseUrl,
      {
        ...headers,
        Accept: 'application/json, text/event-stream, */*',
      },
      timeoutMs
    );
    if (getFallback.kind === 'fail') {
      return {
        reachable: false,
        detail: formatFail(getFallback, timeoutMs),
        status: null,
      };
    }
    first = getFallback;
  }

  if (first.kind === 'http' && (first.status === 405 || first.status === 501)) {
    const second = await xhrProbe(
      'GET',
      baseUrl,
      {
        ...headers,
        Accept: 'application/json, text/event-stream, */*',
      },
      timeoutMs
    );
    if (second.kind === 'fail') {
      return {
        reachable: false,
        detail: formatFail(second, timeoutMs),
        status: null,
      };
    }
    first = second;
  }

  return {
    reachable: true,
    detail: `HTTP ${first.status} ${first.statusText}`.trim(),
    status: first.status,
  };
}

function formatFetchError(e: unknown, timeoutMs: number): string {
  if (e instanceof Error) {
    const n = e.name;
    const m = e.message || '';
    if (n === 'AbortError' || /aborted|abort/i.test(m)) {
      return `Timed out or cancelled (${timeoutMs / 1000}s). Try again on stable Wi‑Fi.`;
    }
    return m || n;
  }
  return String(e);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testWithFetch(
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ reachable: boolean; detail: string; status: number | null }> {
  const merged = { Accept: '*/*', ...headers };
  try {
    let res = await fetchWithTimeout(
      baseUrl,
      { method: 'HEAD', headers: merged },
      timeoutMs
    );
    if (res.status === 405 || res.status === 501) {
      res = await fetchWithTimeout(
        baseUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream, application/json, */*',
            ...headers,
          },
        },
        timeoutMs
      );
    }
    return {
      reachable: true,
      detail: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
      status: res.status,
    };
  } catch (e) {
    return {
      reachable: false,
      detail: formatFetchError(e, timeoutMs),
      status: null,
    };
  }
}

/**
 * Reachability check for MCP base URL. On iOS/Android uses XMLHttpRequest (more reliable than fetch+Abort on some devices).
 */
export async function testMcpEndpoint(
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ reachable: boolean; detail: string; status: number | null }> {
  if (Platform.OS === 'web') {
    return testWithFetch(baseUrl, headers, timeoutMs);
  }
  return testWithXhr(baseUrl, headers, timeoutMs);
}

export function buildAuthHeaders(
  authHeaderName: string,
  secret: string | null
): Record<string, string> {
  if (!secret?.length) return {};
  const name = authHeaderName.trim() || 'Authorization';
  const value =
    name.toLowerCase() === 'authorization' && !/^Bearer\s/i.test(secret)
      ? `Bearer ${secret}`
      : secret;
  return { [name]: value };
}
