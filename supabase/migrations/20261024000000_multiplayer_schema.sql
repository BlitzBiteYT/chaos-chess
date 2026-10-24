-- ==============================================================================
-- Chaos Chess - Staged Online Multiplayer Database Migration
-- Stage 2: Database Schema, Player Sessions, Matches, and Row Level Security
-- ==============================================================================

-- 1. Player Sessions table (links 1:1 to Supabase auth.users for anonymous and registered players)
create table if not exists public.player_sessions (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default 'Anonymous Player',
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

-- Index for session queries
create index if not exists idx_player_sessions_last_seen on public.player_sessions(last_seen_at);

-- 2. Matchmaking Queue table (strict FIFO queue, no Elo, concurrency safe)
create table if not exists public.matchmaking_queue (
    id uuid primary key default gen_random_uuid(),
    player_id uuid not null unique references auth.users(id) on delete cascade,
    status text not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
    match_id uuid,
    queued_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_matchmaking_queue_status_queued on public.matchmaking_queue(status, queued_at);
create index if not exists idx_matchmaking_queue_player on public.matchmaking_queue(player_id);

-- 3. Matches table (authoritative match state and metadata)
create table if not exists public.matches (
    id uuid primary key default gen_random_uuid(),
    white_player_id uuid not null references auth.users(id),
    black_player_id uuid not null references auth.users(id),
    status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
    current_turn text not null default 'w' check (current_turn in ('w', 'b')),
    state_version integer not null default 0,
    seed bigint not null,
    chaos_settings jsonb not null default '{"on": true, "every": 5, "burst": 1}'::jsonb,
    board_ranks integer not null default 8,
    game_state jsonb not null,
    result text,
    winner_id uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_matches_white on public.matches(white_player_id);
create index if not exists idx_matches_black on public.matches(black_player_id);
create index if not exists idx_matches_status on public.matches(status);

-- 4. Match Moves table (authoritative log of accepted moves with idempotency protection)
create table if not exists public.match_moves (
    id uuid primary key default gen_random_uuid(),
    match_id uuid not null references public.matches(id) on delete cascade,
    move_number integer not null,
    player_id uuid not null references auth.users(id),
    color text not null check (color in ('w', 'b')),
    san text not null,
    move_data jsonb not null,
    chaos_event jsonb,
    created_at timestamptz not null default now(),
    constraint uq_match_move_number unique (match_id, move_number)
);

create index if not exists idx_match_moves_match_id on public.match_moves(match_id, move_number);

-- ==============================================================================
-- Row Level Security (RLS) Configuration
-- ==============================================================================

alter table public.player_sessions enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.matches enable row level security;
alter table public.match_moves enable row level security;

-- Player Sessions Policies
create policy "Authenticated players can view sessions"
    on public.player_sessions for select
    to authenticated
    using (true);

create policy "Players can create their own session"
    on public.player_sessions for insert
    to authenticated
    with check (auth.uid() = id);

create policy "Players can update their own session"
    on public.player_sessions for update
    to authenticated
    using (auth.uid() = id);

-- Matchmaking Queue Policies
create policy "Players can view their own queue status"
    on public.matchmaking_queue for select
    to authenticated
    using (auth.uid() = player_id);

create policy "Players can enqueue themselves"
    on public.matchmaking_queue for insert
    to authenticated
    with check (auth.uid() = player_id);

create policy "Players can update their own queue entry"
    on public.matchmaking_queue for update
    to authenticated
    using (auth.uid() = player_id);

create policy "Players can cancel/delete their own queue entry"
    on public.matchmaking_queue for delete
    to authenticated
    using (auth.uid() = player_id);

-- Matches Policies
-- Participants can view matches they are part of
create policy "Participants can view their matches"
    on public.matches for select
    to authenticated
    using (auth.uid() in (white_player_id, black_player_id));

-- Direct insertion or modification by browser clients is strictly disallowed.
-- Only authoritative server functions (service_role) or secure RPCs can create/update matches.

-- Match Moves Policies
-- Participants can view moves from their own matches
create policy "Participants can view moves from their matches"
    on public.match_moves for select
    to authenticated
    using (
        exists (
            select 1 from public.matches m
            where m.id = match_moves.match_id
            and auth.uid() in (m.white_player_id, m.black_player_id)
        )
    );

-- Direct move insertion by browser clients is strictly disallowed.
-- Only authoritative server functions (service_role) can record verified moves.

-- ==============================================================================
-- Realtime Subscriptions Configuration
-- ==============================================================================
-- Enable Realtime replication for matchmaking queue, active matches, and moves
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'matchmaking_queue'
    ) then
        alter publication supabase_realtime add table public.matchmaking_queue;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'matches'
    ) then
        alter publication supabase_realtime add table public.matches;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'match_moves'
    ) then
        alter publication supabase_realtime add table public.match_moves;
    end if;
end $$;
