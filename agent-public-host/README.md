# Frontier agent public host (Vercel)

Thin reverse proxy in front of Supabase Edge Function **`a2a-gateway`**, so agent JSON-RPC and agent-card URLs use your **custom domain** instead of `*.supabase.co` or ngrok.

## What it forwards

| Public URL | Upstream |
|------------|----------|
| `GET /health` | `…/a2a-gateway/health` |
| `GET /.well-known/agent-card.json?slug=…` | same path on Supabase function |
| `GET /.well-known/frontier-agents/:slug/agent-card.json` | rewritten to `agent-card.json?slug=:slug` |
| `POST /a2a/v1/:slug` | same path on Supabase function |

Headers copied: `authorization`, `content-type`, `a2a-version`, `accept`, `x-supabase-access-token`, `x-client-info`, `apikey`, push headers, `ngrok-skip-browser-warning`.

## Vercel setup

1. Create a **new Vercel project** and set the root directory to **`Frontier/agent-public-host`** (or deploy this folder as its own repo).
2. **Environment variable** (Production + Preview as needed):

   - `SUPABASE_A2A_GATEWAY_URL` — full URL, no trailing slash, e.g.  
     `https://<project-ref>.supabase.co/functions/v1/a2a-gateway`

3. Attach your **custom domain** in Vercel (e.g. `agents.yourdomain.com`).

4. In **Supabase** → Edge Function **`a2a-gateway`** → Secrets, set:

   - `A2A_PUBLIC_RPC_BASE` — same public origin as Vercel, e.g. `https://agents.yourdomain.com`  
     (no trailing slash). This makes inbound notifications and stored RPC URLs match the app when traffic is proxied.

5. Redeploy **`a2a-gateway`** after setting the secret.

## Frontier mobile app

In `app.json` / EAS env, set (same origin as Vercel, no trailing slash):

- `EXPO_PUBLIC_A2A_GATEWAY_PUBLIC_BASE_URL` — e.g. `https://agents.yourdomain.com`

Optional:

- `EXPO_PUBLIC_DISCOVERY_BASE_URL` — if discovery / `discoverable/register` live elsewhere; if omitted, it defaults to the same value as `EXPO_PUBLIC_A2A_GATEWAY_PUBLIC_BASE_URL`.

Then rebuild the app and run **sync discoverable** (or whatever triggers `pushDiscoverableAgentsToCloud`) so `discoverable_user_agents.card_json.url` uses the public domain.

## Local check

```bash
cd agent-public-host
echo 'SUPABASE_A2A_GATEWAY_URL=https://YOUR_REF.supabase.co/functions/v1/a2a-gateway' > .env.local
npm install
npm run dev
```

Open `http://localhost:3040/health` — you should see the gateway health JSON.
