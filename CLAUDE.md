# Decked — Custom Card Games Platform

## Overview
A platform for creating and playing Cards Against Humanity-style party games. "KM Against Chaos" is the flagship built-in deck, but users can create any theme.

## Tech Stack
- **Client:** Next.js 15 (React 19, static export), Tailwind CSS, Zustand, Socket.IO client
- **Server:** Express, Socket.IO, PostgreSQL (pg driver), TypeScript
- **AI:** Anthropic API (Claude Sonnet) for card generation
- **Deploy:** Railway with Railpacks builder (auto-deploys on push to `master` on GitHub)

## Project Structure
```
client/src/
  app/              # Next.js pages (/, /decks, /decks/new, /decks/edit)
  components/       # React components (DeckForm, GameScreen, GoogleSignIn, etc.)
  lib/              # API client, socket, Zustand stores, auth
server/src/
  index.ts          # Express + Socket.IO server entry
  deckRoutes.ts     # REST API for deck CRUD
  deckStore.ts      # Deck database operations
  authRoutes.ts     # Google OAuth endpoints
  auth.ts           # JWT + Google token verification, requireAuth middleware
  game.ts           # Game engine (rounds, scoring, judging)
  lobby.ts          # Lobby management (join, leave, reconnect)
  sessions.ts       # Session tracking (localStorage session IDs)
  db.ts             # PostgreSQL pool + schema init
  aiGenerate.ts     # Claude API card generation
```

## Key Patterns
- npm workspaces monorepo (`client/` and `server/` as workspaces)
- Static Next.js export served by Express in production
- Socket.IO for real-time game state; REST API for deck CRUD
- Google OAuth protects deck management; unauthenticated users can still play games
- Deck ownership: users can only edit/delete their own decks
- Built-in decks have `owner_id = NULL` and `built_in = TRUE`
- Manual JSON body parsing in route files (no express.json() middleware)

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth Client ID
- `JWT_SECRET` — Secret for signing auth JWTs
- `ANTHROPIC_API_KEY` — For AI card generation
- `CLIENT_URL` — Client origin for CORS (default: http://localhost:3000)
- `PORT` — Server port (default: 3001)

## Commands
- `npm run dev` — Run both client and server in dev mode (from root)
- `npm run build` — Build both client and server
- `npm start` — Start production server (serves static client)

## Deploy
Push to `master` on GitHub — Railway auto-deploys.
Production URL: https://graceful-quietude-production.up.railway.app/
