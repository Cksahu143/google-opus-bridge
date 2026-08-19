-- supabase/migrations/notebooklm_vault_setup.sql
--
-- UNTESTED — review before applying. Sets up:
--   1. vault_create_secret / vault_delete_secret_by_name RPC wrappers
--      (Supabase's supabase_vault extension exposes vault.create_secret /
--      vault.update_secret directly, but not a delete-by-name lookup out of
--      the box — these wrappers make the Edge Function code simpler and
--      keep raw vault table access out of application code).
--   2. notebooklm_connections table — tracks CONNECTION METADATA ONLY
--      (never the secret value itself) so the UI can show connection status.
--
-- PREREQUISITE: the `supabase_vault` extension must be enabled on this
-- project (Dashboard > Database > Extensions > vault, or
-- `create extension if not exists supabase_vault;` — note this typically
-- requires being run by Supabase support / via the dashboard on hosted
-- projects, not always via a plain migration — CONFIRM before relying on
-- this migration running standalone).

-- 1a. Metadata table: who is connected, when, current status.
create table if not exists public.notebooklm_connections (
  user_id uuid primary key,
  vault_secret_name text not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'expired')),
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  last_used_at timestamptz
);

alter table public.notebooklm_connections enable row level security;

-- Users can see only their own connection status. Adjust policy name/scope
-- to match how the rest of this project defines "the current user" (assumed
-- to be auth.uid() here — verify against existing RLS policies in this repo
-- for consistency).
create policy "Users can view their own notebooklm connection"
  on public.notebooklm_connections
  for select
  using (auth.uid() = user_id);

-- Only the service role (used by the Edge Functions) can write. No direct
-- client-side insert/update/delete policy is created on purpose — all
-- writes must go through notebooklm-connect, which validates the shared
-- secret or the disconnect caller's own JWT.

-- 1b. RPC wrapper: create (or overwrite) a Vault secret by name.
-- SECURITY DEFINER so it can call vault.create_secret with elevated
-- privileges while still being callable via supabase.rpc() using the
-- service-role key from the Edge Function.
create or replace function public.vault_create_secret(
  secret_value text,
  secret_name text,
  secret_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  new_id uuid;
begin
  select vault.create_secret(secret_value, secret_name, secret_description)
    into new_id;
  return new_id;
end;
$$;

-- 1c. RPC wrapper: delete a Vault secret by its name.
create or replace function public.vault_delete_secret_by_name(secret_name text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where name = secret_name;
end;
$$;

-- Lock these functions down to service_role only — they must never be
-- callable directly by an authenticated end user, since they take a raw
-- secret_name/secret_value with no ownership check baked in (the Edge
-- Function is what enforces "only your own userId").
revoke all on function public.vault_create_secret(text, text, text) from public, authenticated, anon;
revoke all on function public.vault_delete_secret_by_name(text) from public, authenticated, anon;
grant execute on function public.vault_create_secret(text, text, text) to service_role;
grant execute on function public.vault_delete_secret_by_name(text) to service_role;
