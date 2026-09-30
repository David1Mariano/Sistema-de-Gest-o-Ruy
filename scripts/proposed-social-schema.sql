-- PROPOSTA PARA REVISÃO. NÃO APLICADA. Não executar automaticamente.
-- Domínio separado: records não oferece aqui constraints/RLS sociais comprovadas.
-- Sem tokens: usar secret manager backend em uma futura implementação OAuth.
begin;
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('instagram','facebook','tiktok')),
  external_account_id text not null,
  display_name text not null,
  status text not null default 'disconnected' check (status in ('disconnected','connected','expired','error')),
  created_at timestamptz not null default now(),
  unique (provider, external_account_id), unique (id, provider)
);
create table public.social_comments (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  account_id uuid not null,
  external_comment_id text not null,
  external_post_id text,
  author_id text,
  author_name text,
  text text not null,
  created_at timestamptz not null,
  replied_at timestamptz,
  status text not null default 'pending' check (status in ('pending','awaiting_approval','replied')),
  permalink text,
  version integer not null default 1 check (version > 0),
  requires_attention boolean not null default false,
  raw_metadata jsonb not null default '{}' check (octet_length(raw_metadata::text) <= 2048),
  foreign key (account_id, provider) references public.social_accounts(id, provider),
  unique (provider, account_id, external_comment_id)
);
create table public.social_ai_drafts (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.social_comments(id),
  text text not null,
  category text,
  sentiment text,
  policy_version integer not null,
  generated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.social_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.social_comments(id),
  draft_id uuid references public.social_ai_drafts(id),
  text text not null check (length(trim(text)) between 1 and 2000),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null,
  status text not null check (status in ('approved','sending','sent','failed','unknown')),
  external_reply_id text,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now()
);
create table public.social_metrics (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  account_id uuid not null,
  metric text not null,
  definition text not null,
  unit text not null,
  period_type text not null,
  period date not null,
  value numeric not null,
  collected_at timestamptz not null default now(),
  foreign key (account_id, provider) references public.social_accounts(id, provider),
  unique (account_id, metric, definition, unit, period_type, period, collected_at)
);
create table public.social_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  account_id uuid not null,
  comment_id uuid references public.social_comments(id),
  action text not null check (action in ('comment_received','draft_generated','human_approved','reply_sent','reply_failed')),
  actor_id uuid references auth.users(id),
  result text not null check (result in ('ok','error')),
  error_code text,
  created_at timestamptz not null default now(),
  foreign key (account_id, provider) references public.social_accounts(id, provider),
  check (action not in ('human_approved','reply_sent') or actor_id is not null)
);
create table public.social_webhook_receipts (
  delivery_key text primary key,
  provider text not null check (provider in ('instagram','facebook')),
  received_at timestamptz not null default now()
);
create index social_comments_recent on public.social_comments (account_id, created_at desc);
create index social_events_comment on public.social_events (comment_id, created_at);

-- Fail closed: no browser access, including authenticated. Future backend must
-- verify Auth/profile + per-operation role + account access before any service_role use.
do $$ declare t text; begin
  foreach t in array array['social_accounts','social_comments','social_ai_drafts','social_replies','social_metrics','social_events','social_webhook_receipts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
create function public.social_reject_history_mutation() returns trigger
language plpgsql set search_path = public as $$ begin
  raise exception 'Social history is append-only';
end $$;
create trigger social_events_immutable before update or delete on public.social_events
for each row execute function public.social_reject_history_mutation();
create trigger social_drafts_immutable before update or delete on public.social_ai_drafts
for each row execute function public.social_reject_history_mutation();
-- No worker, function endpoint, OAuth route, grant or automation is deployed here.
rollback; -- Deliberate: review artifact cannot accidentally persist this proposal.
