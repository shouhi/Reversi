# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

A **browser game platform**: a single Next.js app that hosts multiple online
games you can play with a friend by sharing a URL — no account, no install.
The first game is **Reversi (オセロ)**; the catalog is built so more games can be
added over time.

- **To add a new game, follow [`docs/ADDING_GAMES.md`](docs/ADDING_GAMES.md).**
  It defines the directory layout, naming conventions, and the full checklist.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
Upstash Redis (via `@upstash/redis`) · Vitest · Playwright · deployed on Vercel.
Sync is **polling** (~1.2s), not WebSockets — good enough for a face-to-face game.

## Architecture (where things live)

```
src/
├── app/                      # routes
│   ├── page.tsx              # game catalog (home)
│   ├── games/reversi/        # Reversi start/detail page
│   ├── room/[roomId]/        # Reversi game room  (URL kept for compatibility)
│   └── api/rooms/*           # Reversi API        (URL kept for compatibility)
├── games/
│   ├── registry.ts           # the game catalog — single source of truth
│   ├── types.ts              # GameMeta etc.
│   └── reversi/              # everything Reversi-specific (engine, service, UI)
├── components/{layout,game}/ # SiteHeader, SiteFooter, GameCard (shared UI)
└── lib/                      # shared infra: store/, tokens, apiHelpers, site
```

**Rule of thumb:** game-specific code goes under `src/games/<slug>/`; only put
something in `src/lib` / `src/components` when it's clearly used by multiple games.
Don't over-abstract — a single Next.js app is the right size for now.

## Design principles (do not break these)

- **Server is the source of truth.** Clients send only the intended move; the
  server re-computes board/turn/winner with the pure engine and never trusts the
  client's board.
- **Atomic updates.** Room writes go through `store.compareAndSwap` (Redis Lua
  CAS on `version`); on conflict, re-read and re-validate.
- **Secrets stay server-side.** Per-player tokens are hashed; only the hash is
  stored. The raw token lives in the player's `localStorage` and is sent per
  request. Public state never contains token hashes.
- **No-store everywhere.** All API responses carry `Cache-Control: no-store`.
- **No silent memory fallback in prod.** If Redis isn't configured and memory
  isn't explicitly opted in, we throw rather than guess.

## Backward-compatibility invariants (Reversi) — NEVER change

These keep existing shared URLs, saved rooms, and saved tokens working:

- Redis key: `reversi:room:<roomId>` (and its record shape).
- localStorage key: `reversi:token:<roomId>`; request header `x-reversi-token`.
- Share URL: `/room/<roomId>`; API: `/api/rooms/*`.
- Env var names: `UPSTASH_REDIS_REST_URL/TOKEN`, `KV_REST_API_URL/TOKEN`
  (Vercel Upstash Marketplace), and `REVERSI_MEMORY_STORE=1` (local/test only).

New games should use their own prefixes (`<slug>:room:`, `x-<slug>-token`, etc.)
and the `/api/games/<slug>/...` namespace — see `docs/ADDING_GAMES.md`.

## Commands

```bash
npm run dev         # local dev (set REVERSI_MEMORY_STORE=1 to run without Redis)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (unit)
npm run build       # next build
npm run test:e2e    # playwright (builds + starts, uses memory store)
```

## Safety when testing locally

`.env.local` may contain **real** `KV_REST_API_*` credentials. Because
`getStore()` prefers Redis when credentials are present, running `next start` /
E2E against that file would write to the **real** database. To exercise the app
without touching production data, force the memory store by blanking the Redis
vars for that process:

```bash
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= \
KV_REST_API_URL= KV_REST_API_TOKEN= REVERSI_MEMORY_STORE=1 npm run test:e2e
```

Do **not** change production env vars, run production deploys, or mutate
production Redis data from here.
