/**
 * A2A gateway implementation (see index.ts header in repo for secrets / routing docs).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept, a2a-version, ngrok-skip-browser-warning, x-a2a-push-channel, x-a2a-push-token, x-supabase-access-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type GatewayAgentConfig = {
  slug: string;
  downstream_url: string | null;
  system_prompt: string | null;
  model: string | null;
  tools: unknown;
};

function json(res: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function rpcResult(id: unknown, result: unknown) {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function sanitizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function publicBaseFromRequest(req: Request): string {
  const u = new URL(req.url);
  const path = u.pathname;
  const m = path.match(/^(\/functions\/v1\/[^/]+)/);
  const prefix = m ? m[1] : "";
  return `${u.origin}${prefix}`.replace(/\/+$/, "");
}

/**
 * RPC URLs stored on inbound rows / agent cards must match what clients use.
 * When the gateway is behind a reverse proxy, `req.url` is still the Supabase host — set
 * `A2A_PUBLIC_RPC_BASE` (Dashboard secret) to the public origin, e.g. `https://agents.example.com`.
 */
function effectivePublicRpcBase(req: Request): string {
  const fromEnv = Deno.env.get("A2A_PUBLIC_RPC_BASE")?.trim().replace(/\/+$/, "") ?? "";
  if (fromEnv) return fromEnv;
  return publicBaseFromRequest(req);
}

function readIncomingText(params: Record<string, unknown>): string {
  const msg = params?.message as Record<string, unknown> | undefined;
  if (typeof params?.input === "string" && params.input.trim()) return params.input.trim();
  if (typeof params?.userMessage === "string" && params.userMessage.trim()) return params.userMessage.trim();
  const parts = Array.isArray(msg?.parts) ? (msg!.parts as Record<string, unknown>[]) : [];
  const t = parts.find((p) => typeof p?.text === "string" && String(p.text).trim());
  if (t && typeof t.text === "string") return t.text.trim();
  if (typeof msg?.text === "string" && msg.text.trim()) return msg.text.trim();
  return "";
}

const taskStore = new Map<string, Record<string, unknown>>();

function authOk(req: Request): boolean {
  const expected = Deno.env.get("A2A_EXPECTED_TOKEN")?.trim();
  if (!expected) return true;
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() === expected : false;
}

function getSupabaseService(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  /** Dashboard forbids user-defined secret names starting with SUPABASE_; use SERVICE_ROLE_KEY for the service role JWT. */
  const key =
    Deno.env.get("SERVICE_ROLE_KEY")?.trim() || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadGatewayConfig(sb: SupabaseClient, slug: string): Promise<GatewayAgentConfig | null> {
  const { data, error } = await sb
    .from("a2a_gateway_agent_config")
    .select("slug, downstream_url, system_prompt, model, tools")
    .eq("slug", slug)
    .maybeSingle<GatewayAgentConfig>();
  if (error) {
    console.error("[a2a-gateway] loadGatewayConfig", error.message);
    return null;
  }
  return data;
}

async function loadDiscoverableDisplayName(sb: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await sb
    .from("discoverable_user_agents")
    .select("display_name")
    .eq("slug", slug)
    .eq("enabled", true)
    .maybeSingle<{ display_name: string }>();
  if (error || !data?.display_name?.trim()) return null;
  return data.display_name.trim();
}

/** On-platform user agents exist in discoverable_user_agents even without a2a_gateway_agent_config. */
async function hasEnabledDiscoverableAgent(sb: SupabaseClient, pathSlug: string): Promise<boolean> {
  const { data, error } = await sb
    .from("discoverable_user_agents")
    .select("user_id")
    .eq("enabled", true)
    .eq("slug", pathSlug)
    .limit(1)
    .maybeSingle<{ user_id: string }>();
  return !error && !!data?.user_id;
}

function pathSlugFromRpcMatch(raw: string): string {
  try {
    return sanitizeSlug(decodeURIComponent(raw));
  } catch {
    return sanitizeSlug(raw);
  }
}

/** Keep in sync with `lib/directThreadIdCore.ts` (thread storage keys). */
function hashAgentUrlForThread(url: string): string {
  const s = url.trim();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function canonicalA2aUrlForThread(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    let candidate = t;
    if (!/^https?:\/\//i.test(candidate)) {
      if (/\s/.test(candidate)) return t.replace(/\/+$/, "");
      if (!candidate.includes(".")) return t.replace(/\/+$/, "");
      candidate = `https://${candidate}`;
    }
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return t.replace(/\/+$/, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${path}`;
  } catch {
    return t.replace(/\/+$/, "");
  }
}

function directMessageThreadIdForOwner(ownerUserId: string, peerAgentUrl: string): string {
  const uid = ownerUserId.trim();
  const base = canonicalA2aUrlForThread(peerAgentUrl);
  return `u-${uid}:frontier-ui-direct-${hashAgentUrlForThread(base)}`;
}

async function appendInboundTranscriptFromGateway(
  serviceSb: SupabaseClient,
  ownerUserId: string,
  peerRpcUrl: string | null,
  body: string,
  gatewayTaskId: string,
  pathSlug: string,
  transcript: { contextId: string; a2aMessageId?: string; referenceTaskIds?: string[] },
): Promise<void> {
  const peer = peerRpcUrl?.trim();
  if (!peer) return;
  const threadId = directMessageThreadIdForOwner(ownerUserId, peer);
  const msgId = transcript.a2aMessageId?.trim();
  const dedupe = msgId ? `gw:msg:${msgId}` : `gw:${gatewayTaskId}`;
  const { error } = await serviceSb.from("direct_message_events").insert({
    user_id: ownerUserId,
    thread_id: threadId,
    direction: "inbound",
    body: (body || "(empty message)").slice(0, 20000),
    source: "gateway",
    dedupe_key: dedupe,
    metadata: {
      taskId: gatewayTaskId,
      pathSlug,
      contextId: transcript.contextId,
      a2aMessageId: msgId ?? null,
      referenceTaskIds: transcript.referenceTaskIds ?? [],
    },
  });
  if (error?.code === "23505") return;
  if (error) {
    console.error("[a2a-gateway] appendInboundTranscriptFromGateway", error.message);
  }
}

async function resolveSenderUserIdFromRequest(req: Request): Promise<string | null> {
  const access = req.headers.get("x-supabase-access-token")?.trim();
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const anon = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (!access || !url || !anon) return null;
  const au = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await au.auth.getUser(access);
  if (error || !data.user?.id) return null;
  return data.user.id;
}

/** After on-platform SendMessage: notify agent owner (see public.agent_inbound_notifications). */
async function recordInboundIfApplicable(
  serviceSb: SupabaseClient,
  req: Request,
  pathSlug: string,
  inputText: string,
  taskId: string,
  /** Stable A2A context (client session); same across turns in one UI thread, new per new thread. */
  contextId: string,
  a2aMeta: { a2aMessageId?: string; referenceTaskIds?: string[] } = {},
): Promise<{ status: string; detail?: string }> {
  try {
    const senderId = await resolveSenderUserIdFromRequest(req);
    console.log("[DBG583810][inbound] start", JSON.stringify({ pathSlug, hasSenderId: !!senderId, taskId }));
    const { data: ownerRow } = await serviceSb
      .from("discoverable_user_agents")
      .select("user_id")
      .eq("slug", pathSlug)
      .eq("enabled", true)
      .maybeSingle<{ user_id: string }>();
    console.log("[DBG583810][inbound] owner_lookup", JSON.stringify({ pathSlug, hasOwner: !!ownerRow?.user_id }));
    if (!ownerRow?.user_id) return { status: "no_owner" };
    if (senderId && senderId === ownerRow.user_id) {
      console.log("[DBG583810][inbound] skipped_self_message", JSON.stringify({ pathSlug }));
      return { status: "skipped_self" };
    }

    let senderLabel = "Someone";
    let senderRpc: string | null = null;
    if (senderId) {
      const { data: srow } = await serviceSb
        .from("discoverable_user_agents")
        .select("card_json, display_name, slug")
        .eq("user_id", senderId)
        .eq("enabled", true)
        .limit(1)
        .maybeSingle<{ card_json: unknown; display_name: string; slug: string }>();
      if (srow?.display_name?.trim()) senderLabel = srow.display_name.trim();
      if (srow?.slug?.trim()) {
        /** Prefer gateway RPC from discoverable slug so thread_id matches Direct (not card_json.url). */
        senderRpc =
          `${effectivePublicRpcBase(req)}/a2a/v1/${encodeURIComponent(pathSlugFromRpcMatch(srow.slug))}`;
      } else {
        const cj = srow?.card_json as Record<string, unknown> | null | undefined;
        if (cj && typeof cj.url === "string" && cj.url.trim()) senderRpc = cj.url.trim();
      }
    }

    /** Anon senders: one row per A2A context. Logged-in senders: one row per (owner, agent, sender). */
    const conversationKey = senderId ? `${senderId}:${contextId}` : `anon:${contextId}`;
    const preview = (inputText || "(empty message)").slice(0, 500);

    let existing: { id: string; unread_count: number | null } | null = null;
    if (senderId) {
      const { data } = await serviceSb
        .from("agent_inbound_notifications")
        .select("id, unread_count")
        .eq("owner_user_id", ownerRow.user_id)
        .eq("agent_slug", pathSlug)
        .eq("sender_user_id", senderId)
        .maybeSingle<{ id: string; unread_count: number | null }>();
      existing = data;
    } else {
      const { data } = await serviceSb
        .from("agent_inbound_notifications")
        .select("id, unread_count")
        .eq("owner_user_id", ownerRow.user_id)
        .eq("agent_slug", pathSlug)
        .eq("conversation_key", conversationKey)
        .maybeSingle<{ id: string; unread_count: number | null }>();
      existing = data;
    }

    const now = new Date().toISOString();
    if (existing?.id) {
      const { error: updErr } = await serviceSb
        .from("agent_inbound_notifications")
        .update({
          last_preview: preview,
          last_task_id: taskId,
          sender_user_id: senderId,
          sender_label: senderLabel,
          sender_agent_rpc_url: senderRpc,
          conversation_key: conversationKey,
          unread_count: (existing.unread_count ?? 0) + 1,
          updated_at: now,
        })
        .eq("id", existing.id);
      console.log("[DBG583810][inbound] updated_row", JSON.stringify({ id: existing.id, ok: !updErr, err: updErr?.message ?? null }));
      if (updErr) return { status: "update_error", detail: updErr.message };
      await appendInboundTranscriptFromGateway(serviceSb, ownerRow.user_id, senderRpc, preview, taskId, pathSlug, {
        contextId,
        a2aMessageId: a2aMeta.a2aMessageId,
        referenceTaskIds: a2aMeta.referenceTaskIds,
      });
      return { status: "updated" };
    } else {
      const { error: insErr } = await serviceSb.from("agent_inbound_notifications").insert({
        owner_user_id: ownerRow.user_id,
        agent_slug: pathSlug,
        conversation_key: conversationKey,
        sender_user_id: senderId,
        sender_label: senderLabel,
        sender_agent_rpc_url: senderRpc,
        last_preview: preview,
        last_task_id: taskId,
        unread_count: 1,
        updated_at: now,
        created_at: now,
      });
      console.log("[DBG583810][inbound] inserted_row", JSON.stringify({ pathSlug, ok: !insErr, err: insErr?.message ?? null }));
      if (insErr) return { status: "insert_error", detail: insErr.message };
      await appendInboundTranscriptFromGateway(serviceSb, ownerRow.user_id, senderRpc, preview, taskId, pathSlug, {
        contextId,
        a2aMessageId: a2aMeta.a2aMessageId,
        referenceTaskIds: a2aMeta.referenceTaskIds,
      });
      return { status: "inserted" };
    }
  } catch (e) {
    console.error("[a2a-gateway] recordInboundIfApplicable", e instanceof Error ? e.message : String(e));
    return { status: "exception", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Forward JSON-RPC to external A2A endpoint; pass through safe client headers. */
async function proxyToDownstream(targetBase: string, incoming: Request, rawBody: string): Promise<Response> {
  const u = targetBase.trim().replace(/\/+$/, "");
  const headers = new Headers();
  headers.set("content-type", incoming.headers.get("content-type") || "application/json");
  const auth = incoming.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  for (const h of [
    "a2a-version",
    "accept",
    "ngrok-skip-browser-warning",
    "x-a2a-push-channel",
    "x-a2a-push-token",
    "x-supabase-access-token",
  ]) {
    const v = incoming.headers.get(h);
    if (v) headers.set(h, v);
  }
  const res = await fetch(u, { method: "POST", headers, body: rawBody });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...cors, "Content-Type": res.headers.get("content-type") || "application/json" },
  });
}

/** Azure OpenAI: `deploymentName` is the deployment name in Azure (often matches config.model in DB). */
async function callAzureOpenAiChat(args: {
  deploymentName: string;
  system: string;
  user: string;
}): Promise<string> {
  const apiKey = Deno.env.get("AZURE_OPENAI_API_KEY")?.trim();
  const endpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT")?.trim()?.replace(/\/+$/, "");
  const apiVersion =
    Deno.env.get("AZURE_OPENAI_API_VERSION")?.trim() || "2024-02-15-preview";
  if (!apiKey || !endpoint) return "";

  const deploy = args.deploymentName.trim();
  if (!deploy) return "";

  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deploy)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      max_completion_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Azure OpenAI HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  return (typeof text === "string" ? text : "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...cors } });
  }

  if (!authOk(req)) {
    return json({ error: "unauthorized" }, 401);
  }

  const sb = getSupabaseService();
  const u = new URL(req.url);
  const pathname = u.pathname;
  const publicBase = effectivePublicRpcBase(req);

  const slugFromQuery = u.searchParams.get("slug");
  const legacySlug = sanitizeSlug(Deno.env.get("A2A_SLUG") || "agent");
  const cardSlug = slugFromQuery ? sanitizeSlug(slugFromQuery) : legacySlug;

  // GET /.well-known/agent-card.json
  if (req.method === "GET" && pathname.includes("/.well-known/agent-card.json")) {
    let name = Deno.env.get("A2A_NAME")?.trim() || "Agent";
    let description = Deno.env.get("A2A_DESCRIPTION")?.trim() || `${name} (A2A gateway)`;
    if (sb) {
      const dn = await loadDiscoverableDisplayName(sb, cardSlug);
      if (dn) {
        name = dn;
        description = `${dn} (Frontier)`;
      }
    }
    const rpcUrl = `${publicBase}/a2a/v1/${cardSlug}`;
    const card = {
      protocolVersion: "1.0",
      name,
      description,
      url: rpcUrl,
      preferredTransport: "JSONRPC",
      supportedInterfaces: [
        {
          transport: "JSONRPC",
          protocolBinding: "JSONRPC",
          url: rpcUrl,
          protocolVersion: "1.0",
        },
      ],
      supportedModalities: ["text"],
      capabilities: { modalities: ["text"], streaming: false, tools: [] },
      limits: { streaming: false },
      security: [{ type: "bearer" }],
      tags: ["frontier", "user-agent"],
    };
    return new Response(JSON.stringify(card), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET" && pathname.endsWith("/health")) {
    return json({ ok: true, service: "a2a-gateway", multiSlug: true, sbAvailable: !!sb, legacySlug });
  }

  const rpcMatch = pathname.match(/\/a2a\/v1\/([^/]+)\/?$/);
  if (req.method === "POST" && rpcMatch) {
    const rawText = await req.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      return rpcError(null, -32700, "Parse error");
    }

    const id = body.id ?? null;
    const pathSlug = pathSlugFromRpcMatch(rpcMatch[1] || "");
    const method = String(body.method || "").trim();
    const params = (body.params as Record<string, unknown>) || {};
    // #region agent log
    fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H2-H4',location:'gateway-logic.ts:rpc-entry',message:'gateway received rpc path',data:{pathname,pathSlug,method},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    let config: GatewayAgentConfig | null = null;
    if (sb) {
      config = await loadGatewayConfig(sb, pathSlug);
    }

    /** Legacy single-slug demo when no DB row */
    const legacyMode = !config && pathSlug === legacySlug;

    let discoverableOnPlatform = false;
    if (!config && !legacyMode && sb) {
      discoverableOnPlatform = await hasEnabledDiscoverableAgent(sb, pathSlug);
    }

    if (!config && !legacyMode && !discoverableOnPlatform) {
      // #region agent log
      fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H4',location:'gateway-logic.ts:unknown-slug',message:'rpc rejected unknown slug',data:{pathSlug,legacyMode,discoverableOnPlatform,hasConfig:Boolean(config)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return rpcError(
        id,
        -32001,
        `TaskNotFoundError: unknown agent slug "${pathSlug}". Not in discoverable directory or a2a_gateway_agent_config.`
      );
    }

    // Off-platform: proxy entire JSON-RPC to downstream URL
    if (config?.downstream_url?.trim()) {
      return proxyToDownstream(config.downstream_url.trim(), req, rawText);
    }

    if (method === "SendMessage") {
      const inMsg = (params.message ?? {}) as Record<string, unknown>;
      const inputText = readIncomingText(params);
      const gatewayTaskId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const refRaw = inMsg.referenceTaskIds ?? inMsg.reference_task_ids;
      const referenceTaskIds = Array.isArray(refRaw) ? refRaw.map((x) => String(x)) : [];
      const a2aMessageIdRaw = inMsg.messageId ?? inMsg.message_id;
      const a2aMessageId = typeof a2aMessageIdRaw === "string" ? a2aMessageIdRaw.trim() : "";
      const ctxRaw =
        inMsg.contextId ?? inMsg.context_id ?? (params as Record<string, unknown>).contextId ??
        (params as Record<string, unknown>).context_id;
      const contextId = String(
        typeof ctxRaw === "string" && ctxRaw.trim() ? ctxRaw.trim() : gatewayTaskId,
      );
      let inboundDebug: { status: string; detail?: string } | null = null;
      if (sb) {
        inboundDebug = await recordInboundIfApplicable(sb, req, pathSlug, inputText, gatewayTaskId, contextId, {
          a2aMessageId: a2aMessageId || undefined,
          referenceTaskIds,
        });
      } else {
        inboundDebug = { status: "sb_unavailable" };
      }

      let reply: string;
      if (legacyMode) {
        const name = Deno.env.get("A2A_NAME")?.trim() || "Agent";
        reply = inputText ? `${name} received: ${inputText}` : `${name}: Message received.`;
      } else {
        const system =
          config?.system_prompt?.trim() ||
          "You are a helpful assistant running on the Frontier A2A gateway.";
        const deploymentName =
          config?.model?.trim() || Deno.env.get("AZURE_OPENAI_DEPLOYMENT")?.trim() || "";
        try {
          const text = await callAzureOpenAiChat({
            deploymentName,
            system,
            user: inputText || "Hello.",
          });
          reply =
            text ||
            `[On-platform agent — set AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and model column or AZURE_OPENAI_DEPLOYMENT] ${inputText || "ok"}`;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const task = {
            taskId: gatewayTaskId,
            id: gatewayTaskId,
            sessionId: contextId,
            contextId,
            status: {
              state: "failed",
              message: { parts: [{ text: `A2A gateway error: ${msg}` }] },
            },
            state: "failed",
            metadata: { sequenceNumber: 1, sbAvailable: !!sb, legacyMode, pathSlug, inboundDebug },
          };
          taskStore.set(`${pathSlug}:${gatewayTaskId}`, task);
          return rpcResult(id, task);
        }
      }

      const task = {
        taskId: gatewayTaskId,
        id: gatewayTaskId,
        sessionId: contextId,
        contextId,
        status: {
          state: "completed",
          message: { parts: [{ text: reply }] },
        },
        state: "completed",
        metadata: { sequenceNumber: 1, sbAvailable: !!sb, legacyMode, pathSlug, inboundDebug },
      };
      taskStore.set(`${pathSlug}:${gatewayTaskId}`, task);
      return rpcResult(id, task);
    }

    if (method === "GetTask") {
      const taskId = String(params.id || params.taskId || "").trim();
      const task = taskStore.get(`${pathSlug}:${taskId}`);
      if (!task) {
        return rpcError(id, -32001, "TaskNotFoundError: task not found");
      }
      return rpcResult(id, task);
    }

    if (method === "CancelTask") {
      const taskId = String(params.id || params.taskId || "").trim();
      const task = taskStore.get(`${pathSlug}:${taskId}`);
      if (!task) return rpcError(id, -32001, "TaskNotFoundError: task not found");
      const next = { ...task, status: { state: "cancelled" }, state: "cancelled" };
      taskStore.set(`${pathSlug}:${taskId}`, next);
      return rpcResult(id, next);
    }

    /** Push notification registration (A2A extension). On-platform gateway uses Supabase/emissions separately — accept as no-op. */
    if (method === "tasks/pushNotificationConfig/set" || method === "tasks.pushNotificationConfig.set") {
      return rpcResult(id, { ok: true });
    }
    if (method === "tasks/pushNotificationConfig/get" || method === "tasks.pushNotificationConfig.get") {
      return rpcResult(id, { pushNotificationConfig: null });
    }

    if (method === "ListTasks") {
      return rpcResult(id, { tasks: [] });
    }

    return rpcError(id, -32601, "Method not found");
  }

  // #region agent log
  fetch('http://127.0.0.1:7904/ingest/cfb64959-6ca9-4dc5-b712-a2a30f1caaae',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'583810'},body:JSON.stringify({sessionId:'583810',runId:'pre-fix',hypothesisId:'H2',location:'gateway-logic.ts:http-404',message:'gateway returning raw 404',data:{pathname,method:req.method},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return new Response(JSON.stringify({ error: "not_found", path: pathname }), {
    status: 404,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
