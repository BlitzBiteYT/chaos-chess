# Supabase Setup Guide for Chaos Chess Multiplayer

This guide explains how to set up your Supabase project for Chaos Chess online matchmaking and synchronized gameplay.

---

## 1. Create a Supabase Project

1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Click **New project**, choose your organization, enter a name (e.g. `chaos-chess`), and set a secure database password.
3. Choose the region closest to your players and click **Create new project**.

---

## 2. Enable Anonymous Sign-ins

Chaos Chess uses anonymous authentication so players can jump into matchmaking instantly without email or passwords.

1. In your Supabase dashboard, go to **Authentication** (icon in the left sidebar).
2. Select **Providers** under the Configuration menu.
3. Scroll down to **Anonymous Sign-ins**.
4. Toggle **Enable Anonymous Sign-ins** to **ON**.
5. Click **Save**.

---

## 3. Apply the Database Migration

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase/migrations/20261024000000_multiplayer_schema.sql` from this repository.
4. Copy the entire file contents and paste them into the SQL Editor.
5. Click **Run** (or press Ctrl/Cmd + Enter).
6. Verify that the query completes with `Success. No rows returned`.

### What This Migration Sets Up:
- `public.player_sessions`: Player identity and presence tracking.
- `public.matchmaking_queue`: Global FIFO queue with uniqueness constraints to prevent duplicate entries.
- `public.matches`: Authoritative match records, shared seed, and state versioning.
- `public.match_moves`: Authoritative log of applied moves with unique constraints preventing duplicate move processing.
- **Row Level Security (RLS)**: Enforces that clients can only access matches they participate in, and prevents clients from forging match state.
- **Supabase Realtime**: Enables live broadcasts for queue and match events.

---

## 4. Obtain Your API Credentials

Go to **Project Settings** (gear icon) -> **API**:

- **Project URL**: Found under `Project URL` (e.g. `https://xyzcompany.supabase.co`).
- **Anon / Public Key**: Found under `Project API keys` labeled `anon` `public`.
- **Service Role Secret**: Found under `Project API keys` labeled `service_role` (click to reveal).

> [!CAUTION]
> The `service_role` key bypasses all Row Level Security policies. It is **only** used in secure server-side environments (such as Netlify Functions) and must **never** be committed to Git or exposed to the client browser.

---

## 5. Configure Netlify Environment Variables

In your [Netlify Dashboard](https://app.netlify.com):

1. Select your site -> **Site configuration** -> **Environment variables**.
2. Add the following variables:
   - `SUPABASE_URL`: `https://your-project.supabase.co`
   - `SUPABASE_ANON_KEY`: `eyJhbGciOi...` (anon key)
   - `SUPABASE_SERVICE_ROLE_KEY`: `eyJhbGciOi...` (service-role key)
3. Trigger a redeploy for the variables to take effect.

---

## 6. Testing Your Setup

Once configured:
- Run `npm test` locally to verify schema and function unit tests.
- When live credentials are supplied, testing with two browser windows will pair them in the global queue.
