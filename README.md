# Frontier

Fork of the MCP server manager / A2A chat app, split out as a separate product with its own identity.

## Differences from the upstream project

- **App name:** Frontier  
- **npm package:** `frontier`  
- **Expo slug / scheme:** `frontier` (deep links: `frontier://…`)  
- **iOS bundle ID:** `com.frontier.app`  
- **Android package:** `com.frontier.app`  
- **Local storage keys** are namespaced (`frontier_*`) so data does not collide with the original app on the same device.  
- **OAuth redirect** uses the `frontier` URL scheme.  
- **EAS / Firebase:** This repo does not ship the parent app’s `eas.projectId`, `owner`, or `googleServicesFile`. Add your own [EAS](https://docs.expo.dev/build/introduction/) project and, for Android FCM, a `google-services.json` that matches `com.frontier.app`.

## Custom domain for on-platform agents (Vercel + Supabase)

Public JSON-RPC is normally `https://<ref>.supabase.co/functions/v1/a2a-gateway/a2a/v1/<slug>`. To use your own host (no ngrok):

1. Deploy the small Next proxy in **`agent-public-host/`** to Vercel and set `SUPABASE_A2A_GATEWAY_URL` (see that folder’s README).
2. Set Supabase secret **`A2A_PUBLIC_RPC_BASE`** on Edge Function **`a2a-gateway`** to the same public origin (e.g. `https://agents.example.com`).
3. Set **`EXPO_PUBLIC_A2A_GATEWAY_PUBLIC_BASE_URL`** in the Expo app (EAS / `app.json` `extra`) to that origin and rebuild so discoverable cards and Direct thread IDs match.

## Setup

```bash
cd Frontier
npm install
npx expo start
```

Use `npm run start:clear` if Metro serves a stale bundle.

## Relationship to upstream

The source was copied from `mcp-server-manager` in the same workspace. Keep upstream changes merged manually, or treat Frontier as a long-lived divergent product.
