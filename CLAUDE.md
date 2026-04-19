# Decked — Custom Card Games Platform

## Overview
A platform for creating and playing Cards Against Humanity-style party games. "KM Against Chaos" is the flagship built-in deck, but users can create any theme.

## Tech Stack
- **Client:** Next.js 15 (React 19, static export), Tailwind CSS, Zustand, Socket.IO client (websocket-only transport for multi-replica stickiness)
- **Server:** Express, Socket.IO, PostgreSQL (pg driver), TypeScript
- **Shared state:** Redis (`ioredis`) + `@socket.io/redis-adapter` for cross-replica pub/sub. All live game state — sessions, presence, chat, lobbies, game engines — reads from Redis with an in-memory Map fallback when `REDIS_URL` is unset (tests, local dev).
- **Object storage:** Cloudflare R2 (S3 API via `@aws-sdk/client-s3`) served at `cdn.decked.gg`. Card backs, AI art, card imageUrls, and TTS cache live here. Local disk fallback when `R2_*` env vars are unset.
- **AI:** Anthropic API (Claude Sonnet) for card text generation, fal.ai for card imagery
- **Deploy:** Railway with Railpacks builder, **2 replicas** in us-west2, auto-deploys on push to `master` on GitHub

## Project Structure
```
client/src/
  app/              # Next.js pages (/, /decks, /decks/new, /decks/edit)
  components/       # React components (DeckForm, GameScreen, GoogleSignIn, etc.)
  lib/              # API client, socket, Zustand stores, auth
server/src/
  index.ts          # Express + Socket.IO server entry
  redis.ts          # Shared ioredis client (null when REDIS_URL unset)
  storage.ts        # R2/disk abstraction for object uploads
  db.ts             # PostgreSQL pool + schema init
  sessions.ts       # Persistent sessionId ↔ socketId (Redis-backed, async)
  presence.ts       # Online/in-game + userId ↔ socketId (Redis-backed)
  lobby.ts          # Lobby management (Redis-backed JSON blob per lobby)
  game.ts           # CAH / Joking Hazard / Apples-to-Apples engine (Redis)
  unoGame.ts        # Uno engine (Redis)
  codenamesGame.ts  # Codenames engine (Redis)
  snapshot.ts       # SIGTERM snapshot of live state to Postgres → restored on next boot
  socketHelpers.ts  # Broadcast helpers, timer scheduling with at-most-once Redis locks
  handlers/         # Socket event handlers split per game + lobby + social
  deckRoutes.ts     # REST API for deck CRUD (card backs → R2 via storage.putObject)
  deckStore.ts      # Deck database operations
  authRoutes.ts     # Google OAuth endpoints
  auth.ts           # JWT + Google token verification, requireAuth middleware
  aiGenerate.ts     # Claude API card text generation
  imageGenerate.ts  # fal.ai card image generation → R2 via art_library table
  artLibraryRoutes.ts  # /api/art-library — 302-redirects to cdn.decked.gg
  ttsRoutes.ts      # ElevenLabs TTS cache via R2
```

## Key Patterns
- npm workspaces monorepo (`client/` and `server/` as workspaces)
- Static Next.js export served by Express in production
- Socket.IO for real-time game state; REST API for deck CRUD
- Google OAuth protects deck management; unauthenticated users can still play games
- Deck ownership: users can only edit/delete their own decks
- Built-in decks have `owner_id = NULL` and `built_in = TRUE`
- Manual JSON body parsing in route files (no express.json() middleware)
- **All state-module public APIs are async** (lobby.ts / game.ts / unoGame.ts / codenamesGame.ts / sessions.ts / presence.ts / chat history in socketHelpers.ts). Every mutation is `load from Redis → mutate in memory → save back`.
- **Timer callbacks** (round/turn timers in `socketHelpers.ts`) claim a `SET NX` Redis lock keyed to the phase deadline before running, so the same timer firing on two replicas is at-most-once.
- **Socket.IO polling is disabled** on the client (`transports: ["websocket"]`). WebSocket = one TCP stream = sticky to one replica by construction; the Redis adapter handles cross-replica broadcasts.

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string (Railway `Redis` service). When unset, every state module falls back to in-memory Maps.
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_URL` — Cloudflare R2. When unset, `storage.ts` writes to `./uploads` on local disk.
- `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth Client ID
- `JWT_SECRET` — Secret for signing auth JWTs
- `ANTHROPIC_API_KEY` — For AI card text generation
- `FAL_KEY` — For AI card image generation
- `ELEVENLABS_API_KEY` — For TTS
- `CLIENT_URL` — Client origin for CORS (default: http://localhost:3000)
- `PORT` — Server port (default: 3001)

## Commands
- `npm run dev` — Run both client and server in dev mode (from root)
- `npm run build` — Build both client and server
- `npm start` — Run `node server/dist/index.js` (Railway's `startCommand`)
- `npm --prefix server test` — Vitest suite

## Deploy
Push to `master` on GitHub — Railway auto-deploys. Config lives in `railway.json` (2 replicas, 30s overlap, `/health` check). Redis and Postgres are separate Railway services. Railway's persistent volume was removed once R2 took over (multi-replica requires a stateless service).

Production URL: https://www.decked.gg (also https://decked.gg). CDN: https://cdn.decked.gg.

## Testing notes
- 403 tests currently pass (`npm --prefix server test`).
