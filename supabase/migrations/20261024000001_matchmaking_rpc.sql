-- ==============================================================================
-- Chaos Chess - Stage 3: Concurrency-Safe Global Matchmaking Queue RPC
-- Strictly FIFO: matches any two available players without skill checks.
-- ==============================================================================

-- Stored procedure to atomically pair the two oldest waiting players
create or replace function public.process_matchmaking_queue()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_player1 record;
    v_player2 record;
    v_match_id uuid;
    v_white_id uuid;
    v_black_id uuid;
    v_seed bigint;
    v_initial_pos jsonb;
    v_result jsonb;
begin
    -- 1. Lock and select the first waiting player using FOR UPDATE SKIP LOCKED
    select id, player_id, queued_at
    into v_player1
    from public.matchmaking_queue
    where status = 'waiting'
    order by queued_at asc
    limit 1
    for update skip locked;

    if not found then
        return jsonb_build_object('matched', false, 'reason', 'no_players_waiting');
    end if;

    -- 2. Lock and select the second waiting player
    select id, player_id, queued_at
    into v_player2
    from public.matchmaking_queue
    where status = 'waiting' and id != v_player1.id
    order by queued_at asc
    limit 1
    for update skip locked;

    if not found then
        return jsonb_build_object('matched', false, 'reason', 'waiting_for_opponent');
    end if;

    -- 3. Pair the players: randomly assign White and Black (50/50 flip)
    if random() < 0.5 then
        v_white_id := v_player1.player_id;
        v_black_id := v_player2.player_id;
    else
        v_white_id := v_player2.player_id;
        v_black_id := v_player1.player_id;
    end if;

    -- Generate a unique match ID and authoritative random seed for mulberry PRNG
    v_match_id := gen_random_uuid();
    v_seed := floor(random() * 4000000000)::bigint;

    -- Standard starting board position state
    v_initial_pos := jsonb_build_object(
        'fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        'turn', 'w',
        'cast', 'KQkq',
        'ep', null,
        'hm', 0,
        'fm', 1
    );

    -- 4. Create the authoritative match record
    insert into public.matches (
        id,
        white_player_id,
        black_player_id,
        status,
        current_turn,
        state_version,
        seed,
        chaos_settings,
        board_ranks,
        game_state
    ) values (
        v_match_id,
        v_white_id,
        v_black_id,
        'active',
        'w',
        0,
        v_seed,
        '{"on": true, "every": 5, "burst": 1}'::jsonb,
        8,
        jsonb_build_object(
            'pos', v_initial_pos,
            'hist', '[]'::jsonb,
            'sans', '[]'::jsonb,
            'scol', '[]'::jsonb,
            'caps', '[]'::jsonb,
            'chaos', jsonb_build_object(
                'seed', v_seed,
                'meter', 9,
                'max', 9,
                'n', 0,
                'next', null,
                'last', null
            )
        )
    );

    -- 5. Atomically update the queue entries to 'matched' with the match_id
    update public.matchmaking_queue
    set status = 'matched',
        match_id = v_match_id,
        updated_at = now()
    where id in (v_player1.id, v_player2.id);

    v_result := jsonb_build_object(
        'matched', true,
        'match_id', v_match_id,
        'white_player_id', v_white_id,
        'black_player_id', v_black_id,
        'seed', v_seed
    );

    return v_result;
end;
$$;

-- Helper function to cancel stale queue entries older than 10 minutes
create or replace function public.cleanup_stale_matchmaking_queue()
returns integer
language plpgsql
security definer
as $$
declare
    v_deleted_count integer;
begin
    update public.matchmaking_queue
    set status = 'cancelled',
        updated_at = now()
    where status = 'waiting'
      and queued_at < (now() - interval '10 minutes');

    get diagnostics v_deleted_count = row_count;
    return v_deleted_count;
end;
$$;
