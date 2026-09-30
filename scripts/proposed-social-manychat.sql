-- PROPOSTA, NÃO APLICAR. Sem timestamp; fora do runner de migrations.
-- Complementa proposed-social-schema.sql. Base termina em ROLLBACK: para uma
-- futura migration real, revisar/consolidar ambos em uma transação e testar.
begin;
alter table public.social_accounts drop constraint social_accounts_provider_check;
alter table public.social_accounts add constraint social_accounts_provider_check
  check (provider in ('instagram','facebook','tiktok','whatsapp'));
alter table public.social_comments add column transport text not null default 'meta'
  check (transport in ('meta','manychat'));
alter table public.social_comments add column external_contact_id text;
-- Existing UNIQUE(provider, account_id, external_comment_id) intentionally unchanged:
-- native channel IDs deduplicate Meta and ManyChat. Transport is not part of that key.
create table public.social_integrations (
  id uuid primary key default gen_random_uuid(),
  transport text not null check (transport = 'manychat'),
  external_account_id text not null,
  sync_status text not null default 'not_configured',
  last_synced_at timestamptz,
  last_event_at timestamptz,
  last_error_code text,
  unique(transport, external_account_id)
); -- No credential column. Secrets live in backend secret manager only.
create table public.social_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  channel text not null,
  transport text not null check (transport = 'manychat'),
  manychat_account_id text not null,
  external_contact_id text not null,
  name text, first_name text, last_name text, status text, language text, timezone text, inbox_url text,
  foreign key(account_id, channel) references public.social_accounts(id, provider),
  unique(account_id, channel, transport, manychat_account_id, external_contact_id)
);
create table public.social_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  channel text not null check(channel in ('instagram','facebook','whatsapp')),
  transport text not null check(transport = 'manychat'),
  external_message_id text not null,
  external_contact_id text not null,
  text text not null,
  created_at timestamptz not null,
  status text not null default 'pending',
  version integer not null default 1 check(version > 0),
  foreign key(account_id, channel) references public.social_accounts(id, provider),
  unique(account_id, channel, transport, external_message_id)
);
create table public.social_ingress_receipts (
  receipt_key text primary key,
  payload_hash text not null,
  account_id uuid not null references public.social_accounts(id),
  transport text not null check(transport = 'manychat'),
  received_at timestamptz not null default now()
);
create table public.social_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  fingerprint text not null,
  account_id uuid not null,
  channel text not null,
  transport text not null check(transport = 'manychat'),
  comment_id uuid references public.social_comments(id),
  message_id uuid references public.social_messages(id),
  text text not null check(length(trim(text)) between 1 and 2000),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null,
  record_version integer not null,
  status text not null check(status in ('pending','sent','failed','retrying','cancelled')),
  blocked_reason text not null default 'SEND_DISABLED',
  attempts integer not null default 0 check(attempts between 0 and 3),
  next_attempt_at timestamptz,
  foreign key(account_id, channel) references public.social_accounts(id, provider),
  check(num_nonnulls(comment_id,message_id) = 1)
);
create index social_messages_recent on public.social_messages(account_id,created_at desc);
create index social_outbox_pending on public.social_outbox(status,next_attempt_at);
-- Reuse append-only audit table, adding channel provenance via existing provider.
alter table public.social_events add column transport text not null default 'meta';
alter table public.social_events add column message_id uuid references public.social_messages(id);
alter table public.social_events drop constraint social_events_action_check;
alter table public.social_events add constraint social_events_action_check check(action in
 ('comment_received','draft_generated','human_approved','reply_sent','reply_failed',
  'event_received','contact_synced','deduplicated','action_requested','action_sent','failure'));
do $$ declare t text; begin
  foreach t in array array['social_integrations','social_contacts','social_messages','social_ingress_receipts','social_outbox'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
  end loop;
end $$;
-- Future repository must check account relationships, lock version, compare payload
-- fingerprint on replay, preserve approvals and append an event on each status change.
-- No policies, grants, sender, SQL RPC or trigger with external effects.
rollback;
