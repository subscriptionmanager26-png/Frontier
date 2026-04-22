import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import {
  LOOPBACK_REDIRECT_URI,
  requestLoopbackOAuthUrl,
  shouldUseLoopbackWebViewForUrl,
} from '@/lib/oauthLoopbackWebView';
import { appendSwiggyMcpHintIfNeeded } from '@/lib/swiggyMcp';
import { deleteServer, getSecret, newId, normalizeUrl, saveServer, setRefreshToken, type SecretUpdate } from '@/lib/serverStorage';
import type { McpServer } from '@/types/mcp';

type OAuthMeta = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};

type PendingOAuth = {
  codeVerifier: string;
  tokenEndpoint: string;
  clientId: string;
  serverId: string;
  scope: string;
  redirectUri: string;
  resource?: string;
};

function pendingKey(state: string) {
  return `mcp_oauth_pending_${state}`;
}

function defaultScopeFor(url: string) {
  if (url.includes('api.saffronai.in') && url.includes('/mcp')) return 'goals';
  return 'mcp:tools mcp:resources mcp:prompts';
}

function defaultClientIdFor(url: string) {
  if (url.includes('api.saffronai.in') && url.includes('/mcp')) return '';
  return 'mcp-client';
}

export async function discoverOAuthMeta(serverUrl: string): Promise<OAuthMeta> {
  const u = new URL(normalizeUrl(serverUrl));
  const candidates = [
    new URL('.well-known/oauth-authorization-server', u).toString(),
    `${u.origin}/.well-known/oauth-authorization-server`,
  ];

  let lastErr = '';
  let json: Partial<OAuthMeta> | null = null;
  for (const discoveryUrl of candidates) {
    const res = await fetch(discoveryUrl);
    const raw = await res.text();
    if (!res.ok) {
      lastErr = `(${res.status}) ${discoveryUrl}`;
      continue;
    }
    try {
      json = JSON.parse(raw) as Partial<OAuthMeta>;
      break;
    } catch {
      lastErr = `Invalid JSON from ${discoveryUrl}`;
    }
  }
  if (!json?.authorization_endpoint || !json?.token_endpoint) {
    throw new Error(`OAuth discovery failed: ${lastErr || 'no metadata'}`);
  }
  return {
    authorization_endpoint: json.authorization_endpoint,
    token_endpoint: json.token_endpoint,
    registration_endpoint: json.registration_endpoint,
    scopes_supported: json.scopes_supported,
  };
}

async function maybeRegisterClient(
  meta: OAuthMeta,
  serverUrl: string,
  redirectUri: string
): Promise<{ clientId: string; clientSecret?: string }> {
  if (!meta.registration_endpoint) {
    const id = defaultClientIdFor(serverUrl);
    if (!id) {
      throw new Error('This server needs OAuth client registration; no registration_endpoint in metadata.');
    }
    return { clientId: id };
  }

  if (serverUrl.includes('mcp.swiggy.com')) {
    return { clientId: 'swiggy-mcp' };
  }

  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      client_name: 'Frontier (Expo)',
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Client registration failed (${res.status}): ${raw.slice(0, 500)}`);
  }
  const j = JSON.parse(raw) as { client_id?: string; client_secret?: string };
  if (!j.client_id) throw new Error('Registration response missing client_id');
  return { clientId: j.client_id, clientSecret: j.client_secret };
}

async function randomState(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(bytes, (b) => chars[b % chars.length]!).join('');
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const verifier = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const hashB64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  const challenge = hashB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return { verifier, challenge };
}

export type McpOAuthResult = { ok: true } | { ok: false; message: string };
export type McpOAuthTokenResult = { ok: true; accessToken: string } | { ok: false; message: string };

/**
 * OAuth 2.1 + PKCE against MCP host (e.g. Saffron). Opens system browser; on success stores access (and refresh) token.
 */
export async function runMcpOAuthSignIn(server: McpServer): Promise<McpOAuthResult> {
  const base = normalizeUrl(server.baseUrl);
  const fail = (message: string): McpOAuthResult => ({
    ok: false,
    message: appendSwiggyMcpHintIfNeeded(base, message),
  });

  if (Platform.OS === 'web') {
    return fail(
      'Browser sign-in runs in the Expo Go app or a dev build on iOS/Android, not in the web preview.'
    );
  }

  let meta: OAuthMeta;
  try {
    meta = await discoverOAuthMeta(base);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(
      `This URL does not advertise OAuth (${msg}). Add the token manually or use a provider that supports dynamic registration.`
    );
  }

  const useLoopbackWebView = shouldUseLoopbackWebViewForUrl(base);
  // eslint-disable-next-line no-console
  console.log('[MCP][oauth] start:', { base, useLoopbackWebView, authorization: meta.authorization_endpoint, token: meta.token_endpoint });
  const redirectUri = useLoopbackWebView
    ? LOOPBACK_REDIRECT_URI
    : AuthSession.makeRedirectUri({
        scheme: 'frontier',
        path: 'oauth',
      });

  let clientId: string;
  try {
    const reg = await maybeRegisterClient(meta, base, redirectUri);
    clientId = reg.clientId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(msg);
  }

  const state = await randomState();
  const { verifier, challenge } = await pkcePair();
  const scope = defaultScopeFor(base);

  const pending: PendingOAuth = {
    codeVerifier: verifier,
    tokenEndpoint: meta.token_endpoint,
    clientId,
    serverId: server.id,
    scope,
    redirectUri,
  };

  if (base.includes('api.saffronai.in') && base.includes('/mcp')) {
    pending.resource = 'https://api.saffronai.in/mcp';
  }

  await AsyncStorage.setItem(pendingKey(state), JSON.stringify(pending));

  const auth = new URL(meta.authorization_endpoint);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('state', state);
  auth.searchParams.set('scope', scope);
  if (pending.resource) {
    auth.searchParams.set('resource', pending.resource);
  }

  const cleanup = async () => {
    try {
      await AsyncStorage.removeItem(pendingKey(state));
    } catch {
      /* ignore */
    }
  };

  const authUrl = auth.toString();
  let callbackUrl: string;

  if (useLoopbackWebView) {
    try {
      const bridgeId = await randomState();
      callbackUrl = await requestLoopbackOAuthUrl({ id: bridgeId, authUrl });
    } catch (e) {
      await cleanup();
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg);
    }
  } else {
    let linkedUrl: string | null = null;
    const linkSub = Linking.addEventListener('url', (evt) => {
      if (typeof evt.url === 'string' && evt.url.startsWith(redirectUri)) {
        linkedUrl = evt.url;
      }
    });
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
    linkSub.remove();
    if (result.type === 'success' && result.url) {
      callbackUrl = result.url;
    } else if (linkedUrl) {
      callbackUrl = linkedUrl;
    } else if (result.type === 'cancel' || result.type === 'dismiss') {
      await cleanup();
      return fail('Sign-in was cancelled.');
    } else {
      await cleanup();
      return fail('Unexpected result from the browser.');
    }
  }

  const parsed = Linking.parse(callbackUrl);
  const qp = parsed.queryParams ?? {};

  const pick = (v: string | string[] | undefined): string | undefined =>
    typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;

  const err = pick(qp.error);
  if (err) {
    await cleanup();
    const desc = pick(qp.error_description);
    return fail(desc || err);
  }

  const code = pick(qp.code);
  const returnedState = pick(qp.state);

  if (!code || returnedState !== state) {
    await cleanup();
    return fail('Missing authorization code or state mismatch.');
  }

  const rawPending = await AsyncStorage.getItem(pendingKey(state));
  await AsyncStorage.removeItem(pendingKey(state));

  if (!rawPending) {
    return fail('OAuth session data missing. Try signing in again.');
  }

  let p: PendingOAuth;
  try {
    p = JSON.parse(rawPending) as PendingOAuth;
  } catch {
    return fail('Invalid saved OAuth state.');
  }

  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', p.redirectUri);
  params.set('client_id', p.clientId);
  params.set('code_verifier', p.codeVerifier);
  if (p.resource) {
    params.set('resource', p.resource);
    params.set('scope', p.scope);
  }

  const tres = await fetch(p.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const traw = await tres.text();
  if (!tres.ok) {
    return fail(`Token exchange failed (${tres.status}): ${traw.slice(0, 400)}`);
  }

  let tokenJson: { access_token?: string; refresh_token?: string };
  try {
    tokenJson = JSON.parse(traw) as { access_token?: string; refresh_token?: string };
  } catch {
    return fail('Token response was not JSON.');
  }

  if (!tokenJson.access_token) {
    return fail('No access_token in token response.');
  }
  // eslint-disable-next-line no-console
  console.log('[MCP][oauth] token exchange success: accessTokenLen=', tokenJson.access_token.length, 'hasRefresh=', !!tokenJson.refresh_token);

  const secretUpdate: SecretUpdate = { mode: 'set', value: tokenJson.access_token };
  await saveServer(
    {
      id: p.serverId,
      name: server.name,
      baseUrl: server.baseUrl,
      transport: server.transport,
      authHeaderName: server.authHeaderName.trim() || 'Authorization',
    },
    secretUpdate
  );
  // eslint-disable-next-line no-console
  console.log('[MCP][oauth] saved secret for serverId:', p.serverId);

  if (tokenJson.refresh_token) {
    await setRefreshToken(p.serverId, tokenJson.refresh_token);
  }

  return { ok: true };
}

export async function runMcpOAuthForBaseUrl(baseUrl: string): Promise<McpOAuthTokenResult> {
  const serverId = `a2a-oauth-${newId()}`;
  const temp: McpServer = {
    id: serverId,
    name: 'A2A Agent OAuth',
    baseUrl: normalizeUrl(baseUrl),
    transport: 'http',
    authHeaderName: 'Authorization',
    createdAt: Date.now(),
  };
  await saveServer(
    {
      id: temp.id,
      name: temp.name,
      baseUrl: temp.baseUrl,
      transport: temp.transport,
      authHeaderName: temp.authHeaderName,
    },
    { mode: 'clear' }
  );
  try {
    const res = await runMcpOAuthSignIn(temp);
    if (!res.ok) return res;
    const token = await getSecret(temp.id);
    if (!token) return { ok: false, message: 'OAuth succeeded but no access token was stored.' };
    return { ok: true, accessToken: token };
  } finally {
    await deleteServer(temp.id);
  }
}
