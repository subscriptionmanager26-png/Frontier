# Frontier — A2A & Direct (single agent reference)

All diagrams use **one discoverable agent as the reference**: **Bob** (`slug: bob-finance`, RPC `…/a2a/v1/bob-finance`). **Alice** is another signed-in user messaging Bob’s agent from the Frontier app.

Actors:

| Actor | Role |
|--------|------|
| **AliceApp** | Expo app — JSON-RPC client (`SendMessage`, optional `GetTask`) |
| **BobApp** | Expo app — Bob’s inbox, Direct hub, `direct_message_events` consumer |
| **Proxy** | Optional Vercel host; forwards to gateway |
| **Gateway** | Supabase Edge Function `a2a-gateway` |
| **Supabase** | Auth, Postgres (`discoverable_user_agents`, `direct_message_events`, `agent_inbound_notifications`), Realtime |

---

## UC-1 — Alice resolves Bob’s agent (card + RPC URL)

Alice does not call `SendMessage` yet; she loads capability and endpoint from the **Agent Card**.

```mermaid
sequenceDiagram
  autonumber
  actor AliceApp
  participant Proxy as Proxy (optional)
  participant Gateway as a2a-gateway
  participant Card as Well-known card

  AliceApp->>Card: GET /.well-known/agent-card.json?slug=bob-finance<br/>(or card URL from directory)
  Note over AliceApp,Card: May hit Vercel Proxy → Gateway path rewrite

  alt Custom domain
    AliceApp->>Proxy: GET …/agent-card.json?slug=bob-finance
    Proxy->>Gateway: forward GET
    Gateway-->>Proxy: 200 Agent Card JSON
    Proxy-->>AliceApp: 200
  else Direct Supabase URL
    AliceApp->>Gateway: GET …/a2a-gateway/.well-known/agent-card.json?slug=bob-finance
    Gateway-->>AliceApp: 200 Agent Card JSON
  end

  AliceApp->>AliceApp: cache JSON-RPC URL<br/>…/a2a/v1/bob-finance
```

---

## UC-2 — Alice sends the **first** message to Bob’s agent (on-platform)

First turn: Alice’s app generates a **`contextId`** (UUID) for the UI thread and a **`messageId`** on the `Message`. Gateway creates a **new `Task`**, writes **inbound** side-effects for **Bob** (owner of slug).

```mermaid
sequenceDiagram
  autonumber
  actor AliceApp
  participant Proxy as Proxy (optional)
  participant Gateway as a2a-gateway
  participant DB as Postgres + RLS

  AliceApp->>AliceApp: contextId := uuid()<br/>messageId := uuid()

  alt Via Vercel
    AliceApp->>Proxy: POST …/a2a/v1/bob-finance<br/>JSON-RPC SendMessage
    Note right of AliceApp: message { messageId, contextId, role, parts[] }<br/>configuration?, metadata?
    Proxy->>Gateway: POST …/a2a-gateway/a2a/v1/bob-finance (forward headers)
  else Direct
    AliceApp->>Gateway: POST …/a2a-gateway/a2a/v1/bob-finance
  end

  Gateway->>Gateway: parse slug bob-finance<br/>readIncomingText(params.message)

  Gateway->>DB: resolve discoverable owner (Bob user_id)

  par Inbound side-effects (Bob’s mailbox)
    Gateway->>DB: UPSERT agent_inbound_notifications<br/>(grouped by sender when signed-in)
    Gateway->>DB: INSERT direct_message_events<br/>(Bob user_id, thread_id, inbound, metadata.contextId…)
  end

  Gateway->>Gateway: run model / legacy reply<br/>taskStore[path:taskId] := Task

  Gateway-->>AliceApp: JSON-RPC result { task }<br/>taskId, contextId, status completed

  AliceApp->>DB: INSERT direct_message_events (optional client pair)<br/>outbound + inbound for Alice’s thread
  Note over AliceApp,DB: Same contextId stored for transcript merge on Bob’s side
```

---

## UC-3 — Alice sends a **follow-up** (same thread, new task, prior ref)

A2A v1: **same `contextId`**, new **server `taskId`**, client may send **`referenceTaskIds: [previousTaskId]`**.

```mermaid
sequenceDiagram
  autonumber
  actor AliceApp
  participant Gateway as a2a-gateway
  participant DB as Postgres

  AliceApp->>AliceApp: load session map<br/>contextId, lastTaskId

  AliceApp->>Gateway: SendMessage<br/>message.contextId = (unchanged)<br/>message.referenceTaskIds = [lastTaskId]<br/>message.messageId = new uuid

  Gateway->>DB: append inbound row for Bob<br/>(same contextId in metadata)

  Gateway->>Gateway: new taskId<br/>taskStore := Task

  Gateway-->>AliceApp: Task completed + reply
  AliceApp->>AliceApp: upsert session map<br/>lastTaskId := new taskId
```

---

## UC-4 — Bob sees **Requests** and opens **Direct** with Alice

Bob’s app reads **inbound notifications** and **transcript** rows keyed by **Bob’s user_id** + **thread_id** (hash of Alice’s canonical RPC URL).

```mermaid
sequenceDiagram
  autonumber
  actor BobApp
  participant DB as Postgres
  participant RT as Realtime

  BobApp->>DB: SELECT agent_inbound_notifications<br/>WHERE owner = Bob

  BobApp->>BobApp: tap row (Alice as sender)

  BobApp->>DB: SELECT direct_message_events<br/>WHERE user_id = Bob AND thread_id = …

  BobApp->>BobApp: chain rows by metadata.contextId<br/>(single thread in hub UI)

  BobApp->>DB: UPDATE inbound unread_count = 0

  RT-->>BobApp: (optional) postgres_changes on<br/>direct_message_events / agent_inbound_notifications
```

---

## UC-5 — **Message-only** reply (no `Task` in `SendMessage` response)

A2A v1 allows **`SendMessageResponse`** with **only `message`** (no `GetTask` polling). Frontier client handles **`messageOnly`** on submit.

```mermaid
sequenceDiagram
  autonumber
  actor AliceApp
  participant Remote as Remote agent (non-Frontier)
  participant Local as Frontier gateway (for contrast)

  Note over AliceApp,Local: Example: strict v1 agent returns message, not task

  AliceApp->>Remote: SendMessage { message … }

  alt Agent returns { message }
    Remote-->>AliceApp: result.message (parts, contextId…)
    AliceApp->>AliceApp: normalizeTaskSubmit → messageOnly<br/>NO GetTask poll loop
  else Frontier gateway today
    Local-->>AliceApp: result.task (completed)
    AliceApp->>Remote: GetTask (only when needed / not messageOnly)
  end
```

---

## UC-6 — Bob receives **live** transcript while Alice chats

```mermaid
sequenceDiagram
  autonumber
  actor AliceApp
  participant Gateway as a2a-gateway
  participant DB as Postgres
  actor BobApp

  AliceApp->>Gateway: SendMessage …
  Gateway->>DB: INSERT direct_message_events (Bob)

  DB-->>BobApp: Realtime INSERT event<br/>(filter user_id = Bob)

  BobApp->>DB: SELECT … direct_message_events<br/>ORDER BY created_at
  BobApp->>BobApp: setMessages(merged transcript)
```

---

## UC-7 — **Push notification config** (optional, subscription-style tasks)

Best-effort registration after submit; many agents return **method not found** — app ignores failure.

```mermaid
sequenceDiagram
  autonumber
  actor AliceApp
  participant Gateway as a2a-gateway (or remote)

  AliceApp->>Gateway: SendMessage + configuration.returnImmediately…

  AliceApp->>Gateway: tasks/pushNotificationConfig/set<br/>(JSON-RPC alias in app)

  alt Supported
    Gateway-->>AliceApp: ok
  else Not implemented
    Gateway-->>AliceApp: -32601 Method not found
    AliceApp->>AliceApp: swallow (non-fatal)
  end
```

---

## Legend — one agent (Bob) reference

| Symbol | Meaning |
|--------|---------|
| **Bob** | Discoverable agent; **slug** routes RPC to `a2a-gateway` |
| **BobApp** | Bob’s Frontier client (owner of inbox + transcript rows) |
| **AliceApp** | Caller’s Frontier client |
| **`thread_id`** | Stable storage key for Bob ↔ Alice peer RPC (hashed canonical URL + Bob’s user scope) |
| **`contextId`** | A2A session id; **same** across turns in one UI conversation |

---

## File location

- Path: `Frontier/docs/A2A_DIRECT_SEQUENCE_DIAGRAMS.md`
- Render Mermaid in: GitHub, VS Code (preview), many doc tools.

If you want these split per **screen** (Directory vs Chat vs Settings) or to add **off-platform proxy** (`downstream_url`) as another swimlane, say which flows to expand next.
