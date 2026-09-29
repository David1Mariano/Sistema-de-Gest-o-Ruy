-- Preparada apenas para revisão desta fase. NÃO aplicar no Supabase real, não aplicar
-- policies e não publicar: a aplicação exige autorização explícita e ambiente aprovado.
-- Operação da Central de Atendimento: marcador de leitura por operador, eventos de
-- atendimento que a trilha de handoff não cobre e desenho da outbox futura.
-- Regras: identidade composta por provider/loja, nenhuma função de envio, nenhuma
-- escrita a partir do navegador (somente backend verificado com service_role).
begin;

-- Não lidas por operador: o modelo anterior não permitia derivar o estado de leitura
-- entre atendentes (mode/version/assigned_to não registram quem leu). O marcador é
-- persistido por usuário+conversa, nunca apenas no navegador.
create table public.delivery_conversation_reads (
  user_id uuid not null,
  conversation_id uuid not null,
  provider text not null check(provider in ('ifood','99food','whatsapp','own')),
  merchant_id text not null check(length(merchant_id) between 1 and 200),
  last_read_at timestamptz not null,
  last_read_version integer not null default 0 check(last_read_version>=0),
  updated_at timestamptz not null default now(),
  primary key(user_id, conversation_id),
  foreign key(conversation_id,provider,merchant_id)
    references public.delivery_conversations(id,provider,merchant_id)
);
create index delivery_conversation_reads_scope
  on public.delivery_conversation_reads(provider,merchant_id);

-- Eventos de atendimento que a trilha de handoff não cobre. Nada é inserido nesta
-- fase: a tabela existe para a próxima fase ligar ingestão/rascunho sem inventar
-- histórico passado. Corpo de mensagem nunca é copiado aqui, apenas o ID externo.
create table public.delivery_attendance_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  provider text not null check(provider in ('ifood','99food','whatsapp','own')),
  merchant_id text not null check(length(merchant_id) between 1 and 200),
  event_type text not null check(event_type in ('message_received','draft_created','draft_invalidated')),
  message_external_id text not null check(length(message_external_id) between 1 and 200),
  actor_id uuid,
  conversation_version integer check(conversation_version>=1),
  created_at timestamptz not null default now(),
  foreign key(conversation_id,provider,merchant_id)
    references public.delivery_conversations(id,provider,merchant_id)
);
create index delivery_attendance_events_history
  on public.delivery_attendance_events(conversation_id,created_at desc);

-- Outbox transacional (desenho para revisão; nenhum envio existe no código).
-- Estado pendente -> leased -> sent|failed|cancelled; idempotência por loja+chave;
-- lease com expiração para retry seguro. Antes de qualquer envio futuro, o worker
-- deverá revalidar modo e versão da conversa sob lock e cancelar itens anteriores.
create table public.delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('ifood','99food','whatsapp','own')),
  merchant_id text not null check(length(merchant_id) between 1 and 200),
  conversation_id uuid not null,
  idempotency_key text not null check(length(idempotency_key) between 1 and 200),
  reply_to_external_id text check(reply_to_external_id is null or length(reply_to_external_id) between 1 and 200),
  body text not null check(length(body) between 1 and 4000),
  conversation_version integer not null check(conversation_version>=1),
  conversation_mode text not null check(conversation_mode in ('human','ai')),
  approved_by uuid,
  status text not null default 'pending'
    check(status in ('pending','leased','sent','failed','cancelled')),
  attempts integer not null default 0 check(attempts>=0),
  max_attempts integer not null default 5 check(max_attempts between 1 and 50),
  lease_owner text check(lease_owner is null or length(lease_owner) between 1 and 200),
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  external_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,merchant_id,idempotency_key),
  foreign key(conversation_id,provider,merchant_id)
    references public.delivery_conversations(id,provider,merchant_id),
  constraint delivery_outbox_sent check(status<>'sent' or (sent_at is not null and external_message_id is not null)),
  constraint delivery_outbox_lease check(status<>'leased' or lease_until is not null)
);
create index delivery_outbox_pending on public.delivery_outbox(status,next_attempt_at);
create index delivery_outbox_conversation on public.delivery_outbox(conversation_id,created_at desc);

-- Sem nenhuma policy para anon/authenticated: nenhum acesso direto do navegador.
-- A autorização por loja continua acontecendo no servidor antes de qualquer leitura.
alter table public.delivery_conversation_reads enable row level security;
alter table public.delivery_attendance_events enable row level security;
alter table public.delivery_outbox enable row level security;
revoke all on public.delivery_conversation_reads,public.delivery_attendance_events,
  public.delivery_outbox from public,anon,authenticated;
grant all on public.delivery_conversation_reads,public.delivery_attendance_events,
  public.delivery_outbox to service_role;
-- service_role nunca é exposto no frontend: somente a Edge Function verificada o utiliza.
commit;
