# Chaos Chess — Online Multiplayer Edition

An enhanced, production-ready version of **Chaos Chess** featuring global online multiplayer, hosted on **Netlify** with a **Supabase** backend (PostgreSQL, Row Level Security, and Realtime WebSocket subscriptions).

All original game modes (You vs AI as White, You vs AI as Black, Local Two-Player), all 22 deterministic chaos mechanics, procedural Web Audio effects, board animations, customizable AI difficulty, and developer diagnostics remain **100% operational and unmodified in behavior**.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Browser Client (index.html)                     │
│  - Zero-build vanilla web app (no Webpack, Vite, or bundle step)       │
│  - UMD Engine modules: src/engine/chess.js & src/engine/chaos.js       │
│  - Online Client: auth.js, matchmaking.js, multiplayer.js, config.js   │
└───────────────────▲────────────────────────────────▲───────────────────┘
                    │ REST API                       │ Realtime WebSocket
                    │ (JWT Bearer)                   │ (Postgres Changes)
┌───────────────────▼──────────────────────┐         │
│         Netlify Serverless Functions     │         │
│  - /.netlify/functions/session           │         │
│  - /.netlify/functions/queue             │         │
│  - /.netlify/functions/match-state       │         │
│  - /.netlify/functions/match-move        │         │
│  - /.netlify/functions/match-action      │         │
│  - /.netlify/functions/heartbeat         │         │
└───────────────────▲──────────────────────┘         │
                    │ Service Role (Admin)           │
┌───────────────────▼────────────────────────────────▼───────────────────┐
│                           Supabase Cloud                               │
│  - Auth: Anonymous Guest Sessions (No account signup required)         │
│  - Database: Tables (player_sessions, matchmaking_queue, matches...)   │
│  - Concurrency: Atomic RPC process_matchmaking_queue (SKIP LOCKED)     │
│  - Security: Row Level Security (RLS) policies on every table          │
│  - Realtime: Postgres change broadcasting to match channel subscribers │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Core Features

1. **Global Matchmaking Queue**:
   - Single global FIFO matchmaking queue.
   - **Zero Elo rating dependency**: Elo ratings, rankings, and win rates are completely ignored. The first two available players in the queue are paired immediately.
   - Concurrency-safe: Postgres `FOR UPDATE SKIP LOCKED` guarantees no two players can be double-matched or stranded.

2. **Synchronized Authoritative State**:
   - Moves, checkmates, stalemates, and draws are evaluated authoritatively on the server using the shared `chess.js` rules engine.
   - State versions increment sequentially with optimistic concurrency control (`eq('state_version', match.state_version)`).
   - Network retries are idempotent: duplicate move submissions return the accepted state without corrupting the game or double-stepping plies.

3. **Deterministic Chaos Synchronization**:
   - Unique PRNG seed generated authoritatively per match.
   - Chaos events are selected deterministically once by the server on move execution and broadcast to both players.
   - Both players experience the identical sequence of events, meter reductions, banners, audio cues, board reshaping (*Growth*, *Squeeze*), and piece mutations.
   - Safety invariants guaranteed: chaos events never fire on game-ending checkmate.

4. **Game Endings & Player Actions**:
   - Checkmate, stalemate, threefold repetition, 50-move rule, and insufficient material automatically finalize matches as `'completed'`.
   - Two-tap confirmation for resignation (`"Tap again to resign"`).
   - In-game draw offers and mutual draw acceptances.
   - Playing a regular move automatically declines any pending draw offer.
   - Completed match results are immutable: subsequent moves are rejected with HTTP `400`.

5. **Reconnection & Network Reliability**:
   - Page refresh seamlessly restores active match state (`localStorage` restoration).
   - Live presence indicator: displays `"Opponent: Connected"` (green) or `"Opponent: Disconnected"` (amber).
   - Background heartbeats ping every 10s.
   - If an opponent disconnects and fails to return within 60 seconds, the active player can claim a win by abandonment.

6. **Local & AI Preservation**:
   - Undo is blocked only in online matches (with toast alert) and remains fully functional in local & AI modes.
   - Offline play requires no network access and operates completely standalone.

---

## Setup & Deployment Guide

### Prerequisites
- A [Netlify](https://www.netlify.com/) account.
- A [Supabase](https://supabase.com/) account (free tier works great).

---

### Step 1: Configure Supabase

1. **Create a new Supabase Project**:
   - Open your [Supabase Dashboard](https://app.supabase.com/) and click **New Project**.
   - Note your **Project URL** and **API Keys** under **Project Settings -> API**:
     - `Project URL` (e.g., `https://xyzcompany.supabase.co`)
     - `anon` `public` key
     - `service_role` `secret` key (never expose this to the browser client)

2. **Run Database Migrations**:
   - In the Supabase Dashboard, go to the **SQL Editor**.
   - Create a **New query**, paste the entire contents of [`supabase/migrations/20261024000000_multiplayer_schema.sql`](file:///data/data/com.termux/files/home/Antigravity-for-Android/supabase/migrations/20261024000000_multiplayer_schema.sql), and click **Run**.
   - Create another **New query**, paste the contents of [`supabase/migrations/20261024000001_matchmaking_rpc.sql`](file:///data/data/com.termux/files/home/Antigravity-for-Android/supabase/migrations/20261024000001_matchmaking_rpc.sql), and click **Run**.

3. **Enable Anonymous Sign-ins**:
   - Go to **Authentication -> Providers -> Email** (or **Authentication -> Settings**).
   - Under **General Settings**, enable **Allow Anonymous Sign-ins**.
   - Click **Save**.

---

### Step 2: Configure Environment Variables & Deploy to Netlify

#### Option A: Deploy via Netlify Dashboard (Git integration)
1. Push this repository to GitHub or GitLab.
2. In Netlify, click **Add new site** -> **Import an existing project**.
3. Select your repository.
4. Set the build settings:
   - **Publish directory**: `.` (or root)
   - **Functions directory**: `netlify/functions`
5. Under **Environment variables**, add:
   - `SUPABASE_URL`: Your Supabase Project URL
   - `SUPABASE_ANON_KEY`: Your Supabase public `anon` key
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase `service_role` secret key
6. Click **Deploy Site**.

#### Option B: Deploy via Netlify CLI
```bash
# 1. Install Netlify CLI
npm install -g netlify-cli

# 2. Link your site
netlify link

# 3. Set environment variables
netlify env:set SUPABASE_URL "https://your-project.supabase.co"
netlify env:set SUPABASE_ANON_KEY "your-anon-key"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "your-service-role-key"

# 4. Deploy production build
netlify deploy --prod
```

---

### Step 3: Test Online Multiplayer with Another Player

1. Open your deployed Netlify URL in a desktop browser window.
2. Select **Mode: Online Multiplayer (Global Matchmaking)** from the dropdown.
3. Click **Join Queue**. The status will display *"Searching for an opponent…"*.
4. Open your deployed URL in a second private/incognito window (or on a mobile device).
5. In the second window, select **Mode: Online Multiplayer** and click **Join Queue**.
6. Both sessions will match instantly:
   - Player 1 will be assigned White (or Black) with the board oriented correctly.
   - Player 2 will be assigned the opposite color with their board oriented correctly.
   - Moves and deterministic chaos events will execute authoritatively and synchronize on both screens in real time.
7. Test refreshing either browser tab: the active game will reload from the server seamlessly without losing state.

---

## Running the Automated Test Suite

The project includes an exhaustive, zero-dependency regression test suite covering all chess rules, chaos safety invariants, database migrations, functions, and concurrency:

```bash
# Run all 13 test suites
npm test

# Run specific test suites
npm run test:perft        # 15 Perft tests (Kiwipete, evasions, pins)
npm run test:chaos        # Chaos stress test (6,900+ events without invariant failure)
npm run test:schema       # SQL schema and RLS verification
npm run test:session      # Netlify session endpoint tests
npm run test:auth         # Client guest authentication tests
npm run test:queue        # Concurrency & atomic FIFO matchmaking tests
npm run test:match        # Authoritative match state snapshot tests
npm run test:sync         # PRNG seed determinism & state restoration tests
npm run test:move         # Authoritative move validation & optimistic locking
npm run test:chaossync    # Authoritative chaos event synchronization
npm run test:endings      # Checkmate, stalemate, resignation & draw rules
npm run test:reconnection # Heartbeat, presence, auto-reconnect & abandonment
npm run test:security     # Secret leakage audit, bounds checks & rate limiting
```

---

## File Structure

```
├── .env.example                               # Environment variable templates
├── .gitignore                                 # Git ignore patterns
├── Chaos_Chess___Stage_7_8.html               # Original standalone reference
├── index.html                                 # Production web application
├── netlify.toml                               # Netlify headers, caching & build configuration
├── package.json                               # Scripts and test runner configuration
├── README.md                                  # Production documentation (this file)
├── docs/
│   └── SUPABASE_SETUP.md                      # Detailed Supabase configuration guide
├── netlify/
│   └── functions/
│       ├── heartbeat.js                       # Presence & abandonment resolution
│       ├── match-action.js                    # Resignation & draw agreement
│       ├── match-move.js                      # Authoritative move & chaos processor
│       ├── match-state.js                     # Authoritative state snapshot provider
│       ├── queue.js                           # Atomic matchmaking queue endpoint
│       ├── session.js                         # Guest session token generator
│       └── utils/
│           ├── rate-limiter.js                # In-memory sliding window rate limiter
│           ├── supabase.js                    # Admin client & auth verification
│           └── validation.js                  # Move coordinate & payload bounds checking
├── src/
│   ├── engine/
│   │   ├── chaos.js                           # Modularized Chaos engine (22 events, PRNG)
│   │   └── chess.js                           # Modularized Chess engine (rules, legal moves)
│   └── online/
│       ├── auth.js                            # Anonymous Supabase client auth module
│       ├── config.js                          # Supabase URL & Key manager
│       ├── matchmaking.js                     # Client matchmaking queue state machine
│       └── multiplayer.js                     # State synchronization, presence & moves
├── supabase/
│   └── migrations/
│       ├── 20261024000000_multiplayer_schema.sql  # Tables, RLS policies, Realtime publication
│       └── 20261024000001_matchmaking_rpc.sql     # Atomic FIFO queue RPC (FOR UPDATE SKIP LOCKED)
└── tests/                                     # 13 automated test suites
```

---

## License

MIT License. Open source and free for personal and educational use.
