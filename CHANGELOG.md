# Changelog

All notable changes to the **Chaos Chess** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-10-24

### Added
- **6 Brand New Chaos Events**:
  - **🕳️ Black Hole (`blackhole`)**: Cosmic singularity pulls non-king pieces 1 square inward toward the center (`d4, d5, e4, e5`).
  - **👑 King's Ransom (`bounty`)**: Golden crown marks a minor piece; capturing it awards an immediate bonus pawn.
  - **👻 Phantom Split (`phantom`)**: Creates a ghostly decoy blocking an adjacent square for 4 turns.
  - **⚡ Overcharge (`overcharge`)**: Surges one piece per side with crackling electric energy.
  - **🧟 Graveyard Necromancy (`necromancy`)**: Resurrects fallen pieces onto open home back ranks.
  - **🌋 Magma Floor (`magma`)**: Two active tactical squares turn into boiling molten lava that cannot be stepped on.
- **Telegraphed Danger Zones ("Evacuate" Mechanic)**:
  - When the Chaos Meter hits 1, target squares for spatial events (`Meteor`, `Lightning`, `Magma`, `Frozen`) pulse red with hazard reticles (`.sq.danger-zone`).
  - Status displays: `Next: Meteor · ⚠️ EVACUATE: d4, e4, d5, e5!`.
  - Players have exactly 1 ply to evacuate pieces before the event strikes.
- **Sudden Death Overdrive**:
  - In endgames (4 or fewer non-king/pawn pieces remaining), chaos accelerates to every 3 moves.
  - Chaos bar glows in fiery red/orange with `⚡ OVERDRIVE` notification to prevent sluggish draws.
- **The Chaos Draft (Player's Choice)**:
  - Added setting toggle `[x] Chaos Draft (Choose from 2 events when meter hits 0)`.
  - Presents a 2-card interactive selection modal when chaos triggers during local/AI play.
- **Interactive Changelog Modal**:
  - In-game version changelog viewer accessible via top navbar `✨ Changelog` and lobby banner.
- **Chess.com Two-Screen Layout**:
  - Screen 1: Main Lobby with mode cards, active game resumption banner, visual assist toggles, and developer diagnostics.
  - Screen 2: Active Chessboard with opponent/player strips, turn dots, captured pieces, and move history notation table.

### Changed
- **Tactical Freeze (`frozen`)**: Rebalanced to only select empty squares that are legally reachable by pieces on the board, eliminating useless corner freezes.
- **True Fog of War (`fog`)**: Now persists until the next chaos event trigger (rather than vanishing after 2 plies). Threat arrows, heatmaps, and hanging rings are completely hidden during fog.
- Total event pool expanded from 22 to **28 unique chaos mechanics**.
- Updated all lobby card descriptions and event guides to reflect 28 total events.

---

## [1.1.0] - 2026-10-24

### Added
- **Online Multiplayer Engine**:
  - Netlify Functions serverless backend (`session`, `queue`, `match-state`, `match-move`, `match-action`, `heartbeat`).
  - Supabase PostgreSQL database schema with Row Level Security (RLS) and Realtime broadcasts.
  - Atomic FIFO Matchmaking via `FOR UPDATE SKIP LOCKED`.
  - Authoritative move validation enforcing standard chess rules and deterministic chaos sequencing.
  - Idempotency key tracking on `(match_id, move_number)`.
  - Auto-reconnect and state restoration on page reload.
  - Live opponent heartbeat monitoring and 60-second abandonment claim.
  - Realtime draw offers and two-tap resignation confirmation.
- Automated test suites expanded to 13 suites covering perft, draws, chaos stress testing, and multiplayer concurrency.

---

## [1.0.0] - 2026-10-24

### Added
- Complete single-file Chaos Chess web application (`index.html`).
- 22 original chaos mechanics: Earthquake, Portal, Frozen Square, Swap Meet, Promotion Rush, Fog of War, Double Time, Lightning, Growth, Squeeze, Tide, Meteor, Defection, Stampede, Reinforcements, Mirror, Mutation, Rift, Coronation, Trade Deal, Gravity, Fault Line.
- Full chess rules engine (castling, en passant, pawn promotion, checkmate, stalemate, 50-move rule, threefold repetition).
- Built-in AI with 4 difficulty levels (Easy, Medium, Hard, Master/Custom Elo).
- Visual assists: threat arrows, attacked piece rings, legal move dots, last move highlight, and multiple board color themes.
