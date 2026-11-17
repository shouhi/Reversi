# COLOR HIDE — Cloudflare realtime Worker (PartyServer + Durable Objects)

The production realtime backend for COLOR HIDE. One **Durable Object per room**
runs the shared, transport-agnostic `ColorHideServer` netcode (the exact code the
local WS host runs). It holds **only ephemeral live positions** — the durable room
record stays in the Vercel app + Upstash, read over HTTP.

> ⚠️ **Deploy / billing are NOT part of the current approval.** The commands in
> "Deploy" and "Rollback" are documented for a future, separately-approved step.
> **Do not run them without explicit approval.** Nothing here provisions a
> Cloudflare account, changes a billing plan, or deploys.

## Files

- `src/index.ts` — Worker entry: `routePartykitRequest` + Origin allowlist + `/health`.
- `src/party.ts` — the `ColorHide` Durable Object (PartyServer `Server`): auth, tick
  loop, per-recipient snapshots, catch, rate limiting, prod-secret enforcement.
- `wrangler.toml` — DO binding + SQLite migration + non-secret vars.
- `tsconfig.json` — Worker typecheck (`npm run cf:typecheck`).
- `.dev.vars.example` — copy to `.dev.vars` (gitignored) for local dev.

Shared with the app (single source of truth, bundled by wrangler):
`src/games/color-hide/net/realtime.ts`, `net/protocol.ts`, `server/httpProvider.ts`,
`lib/realtimeShared.ts`, and the pure engine libs.

## Environment variables

| Var | Where | Required | Notes |
|---|---|---|---|
| `COLOR_HIDE_APP_URL` | wrangler var | yes | Absolute Vercel app URL (room authority). |
| `COLOR_HIDE_RT_SECRET` | **wrangler secret** | yes (prod) | Shared with the app's `COLOR_HIDE_RT_SECRET`. MUST be a strong random value in prod; the DO **fails closed** if it is empty or the dev default when `ENVIRONMENT=production`. Never commit it. |
| `COLOR_HIDE_ALLOWED_ORIGINS` | wrangler var | prod | Comma-separated Origins allowed to open a WS (e.g. `https://zen-gamebox.vercel.app`). Empty = allow any (dev only). |
| `ENVIRONMENT` | wrangler var | yes | `development` \| `production`. Gates the secret requirement. |

The Vercel app needs the **same** `COLOR_HIDE_RT_SECRET` and
`NEXT_PUBLIC_COLOR_HIDE_WS_URL = wss://<your-worker-host>` (no path — the client
appends `/parties/color-hide/<roomId>`).

## Local development (no account, no deploy)

```bash
cp cloudflare/color-hide/.dev.vars.example cloudflare/color-hide/.dev.vars   # once
# terminal 1 — the app (memory store; never touches prod Redis)
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= KV_REST_API_URL= KV_REST_API_TOKEN= \
  REVERSI_MEMORY_STORE=1 npm run dev          # http://localhost:3000
# terminal 2 — the Worker on local workerd
npm run cf:dev                                 # ws://localhost:8787
# point the browser client at the Worker:
NEXT_PUBLIC_COLOR_HIDE_WS_URL=ws://localhost:8787 npm run dev
```

Integration test against local workerd (real WebSockets):
```bash
npm run test:partyserver
```

## Deploy (DOCUMENTED ONLY — requires separate approval)

```bash
# 0. One-time: authenticate (opens browser) and confirm the account.
wrangler login
wrangler whoami

# 1. Set the production secret (never in git / wrangler.toml):
wrangler secret put COLOR_HIDE_RT_SECRET --config cloudflare/color-hide/wrangler.toml
#    → paste a strong random value; set the SAME value in Vercel env.

# 2. Deploy, overriding the production vars:
wrangler deploy --config cloudflare/color-hide/wrangler.toml \
  --var ENVIRONMENT:production \
  --var COLOR_HIDE_APP_URL:https://zen-gamebox.vercel.app \
  --var COLOR_HIDE_ALLOWED_ORIGINS:https://zen-gamebox.vercel.app

# 3. In Vercel (prod env), set and redeploy:
#      NEXT_PUBLIC_COLOR_HIDE_WS_URL = wss://color-hide-realtime.<subdomain>.workers.dev
#      COLOR_HIDE_RT_SECRET          = <same strong value as step 1>
#      (COLOR_HIDE_* phase-timer overrides should be UNSET in prod.)

# 4. Smoke check:
curl https://color-hide-realtime.<subdomain>.workers.dev/health   # → ok
```

First deploy applies the `v1` SQLite migration (declares the DO class; we store no
rows). The DO class name `ColorHide` ⇒ route namespace `color-hide`.

## Rollback (DOCUMENTED ONLY)

```bash
# A. Instantly disable realtime WITHOUT touching Cloudflare:
#    In Vercel, UNSET NEXT_PUBLIC_COLOR_HIDE_WS_URL and redeploy. The client falls
#    back to the local-host URL (unreachable in prod) → the lobby/paint/results still
#    work (HTTP); only the live 3D round is affected. This is the safest kill-switch.

# B. Roll the Worker back to a previous version:
wrangler deployments list --config cloudflare/color-hide/wrangler.toml
wrangler rollback [<version-id>] --config cloudflare/color-hide/wrangler.toml

# C. Remove the Worker entirely (last resort):
wrangler delete --config cloudflare/color-hide/wrangler.toml
```

Because the DO holds no durable data, rollback/redeploy loses nothing but
in-flight live positions (clients reconnect; the app state is intact).

## Cost & abuse controls (verify current figures before launch)

Pricing below is from the Cloudflare DO pricing page fetched **2026-11-17** —
re-verify at launch. Assumptions: 6 players, 5 min/match, 15 Hz out / 18 Hz in.

- **Billed:** incoming WS messages 20:1 → ~1,620 req/match; connections ~6 req;
  duration 300 s × 0.128 GB = 38.4 GB-s/match. **Outgoing messages + bandwidth are
  not billed.** We persist **nothing** in the DO (no storage/rows cost).

| matches/mo | CF billable req | CF duration GB-s | **CF cost** |
|---|---|---|---|
| 100 | ~162k | ~3.8k | **$5** (Workers Paid base; within free allowances) |
| 1,000 | ~1.63M | ~38k | **~$5.1** |
| 10,000 | ~16.3M | ~384k | **~$7.3** (req overage ~$2.3; duration under the 400k-GB-s include) |

- **Hidden cost to watch — Vercel, not Cloudflare:** the DO polls the app
  `GET /rooms/:id` every ~1 s per active room (`META_REFRESH_MS`) → ≈ match-seconds
  of Vercel function invocations (≈3M/mo at 10k matches). Mitigations: raise
  `META_REFRESH_MS` to 2–3 s, or move to push-based phase updates. The realtime
  (Cloudflare) cost itself stays single-digit dollars.
- **Abuse controls (available):** app-level — 6-player room cap, room TTL, auth
  gating (only roster members connect), per-connection flood limit (40 msg/s),
  Origin allowlist. Platform-level — Cloudflare automatic DDoS protection; add WAF
  / Rate-Limiting Rules on the Worker route if needed.
- **Spend cap:** Cloudflare provides **billing/usage notifications (alerts)**, but
  (as of the researched date) **no hard spend cap** for Workers/DO — rely on the
  app-level limits + alerts. **Verify current spend-control options before launch.**

## Security

See the threat model and trust boundary in `docs/COLOR_HIDE.md` (Phase 3 section).
Summary: per-connection token auth (verified against the app), one-DO-per-room
isolation, server-authoritative movement/visibility/catch, Origin allowlist,
rate limiting, and a production secret requirement. The secret is never logged.
