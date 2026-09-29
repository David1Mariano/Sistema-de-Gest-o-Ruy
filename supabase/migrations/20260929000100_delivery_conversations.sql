-- Preparada apenas para revisão desta fase. NÃO aplicar no Supabase real, não aplicar
-- policies e não publicar: a aplicação exige autorização explícita e ambiente aprovado.
-- Atendimento da Central de Delivery: clientes, conversas, mensagens e handoff humano.
-- Regras: identidade composta por provider/loja, deduplicação por ID externo, versão
-- monotônica por conversa e nenhuma operação de envio de mensagem.
begin;
-- Escopo de atendimento por operador: quem enxerga e quem pode assumir/devolver cada loja.
-- Leitura não depende de política RLS no navegador: só o backend verificado usa service_role.
create table public.delivery_operator_scopes (
  user_id uuid not null,
  provider text not null check(provider in ('ifood','99food','whatsapp','own')),
  merchant_id text not null check(length(merchant_id) between 1 and 200),
  can_manage boolean not null default false,
  primary key(user_id,provider,merchant_id)
);
-- Cliente: identidade composta provider + loja + external_customer_id. Telefone nunca
-- identifica nem associa pessoas; nome/telefone só existem quando o provedor informar.
create table public.delivery_customers (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('ifood','99food','whatsapp','own')),
  merchant_id text not null check(length(merchant_id) between 1 and 200),
  external_id text not null check(length(external_id) between 1 and 200),
  name text check(length(name) between 1 and 200), phone text check(length(phone) between 1 and 40),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider,merchant_id,external_id), unique(id,provider,merchant_id)
);
-- Conversa: estado explícito em mode (ai|human), responsável atual e versão monotônica.
-- Nasce em 'human': nenhuma resposta automática é habilitada implicitamente.
create table public.delivery_conversations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('ifood','99food','whatsapp','own')),
  merchant_id text not null check(length(merchant_id) between 1 and 200),
  external_id text not null check(length(external_id) between 1 and 200),
  customer_id uuid not null,
  mode text not null default 'human' check(mode in ('human','ai')),
  version integer not null default 0 check(version>=0),
  assigned_to uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider,merchant_id,external_id), unique(id,provider,merchant_id),
  foreign key(customer_id,provider,merchant_id) references public.delivery_customers(id,provider,merchant_id)
);
-- Mensagem: a identidade deduplica por (conversa, direção, external_id) e a conversa já
-- carrega provider+loja, então o mesmo ID externo em outra loja/provedor não colide.
-- occurred_at é o horário do provedor; received_at é o horário de recebimento no sistema.
create table public.delivery_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.delivery_conversations(id),
  external_id text not null check(length(external_id) between 1 and 200),
  direction text not null check(direction in ('inbound','outbound')),
  author text not null check(author in ('customer','ai','human','system')),
  body text not null check(length(body) between 1 and 4000),
  occurred_at timestamptz not null, received_at timestamptz not null default now(),
  conversation_version integer not null check(conversation_version>=1),
  status text not null check(status in ('received','draft','invalidated')),
  invalidated boolean not null default false,
  unique(conversation_id,direction,external_id),
  constraint delivery_messages_direction_author check
    (case direction when 'inbound' then author in ('customer','system') else author in ('ai','human','system') end),
  constraint delivery_messages_invalidation check((status='invalidated')=invalidated)
);
create index delivery_messages_history on public.delivery_messages(conversation_id,occurred_at,id);
-- Trilha do handoff: uma linha por transição de estado, sem corpo de mensagem.
create table public.delivery_handoff_audit (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.delivery_conversations(id),
  actor_id uuid not null, mode text not null check(mode in ('human','ai')),
  version integer not null check(version>=1), created_at timestamptz not null default now(),
  unique(conversation_id,version)
);

-- Ingestão confiável (fila/verificação do provedor). Não é endpoint do navegador e não
-- altera modo, responsável ou pedido. Replay não duplica e não inventa horário ausente.
create function public.delivery_receive_message(p_provider text,p_merchant text,p_customer text,
  p_conversation text,p_message text,p_body text,p_occurred_at timestamptz,
  p_name text default null,p_phone text default null) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare customer uuid; conv delivery_conversations; old delivery_messages; next_version integer;
begin
  if p_provider is null or p_provider not in ('ifood','99food','whatsapp','own') then raise exception 'UNKNOWN_PROVIDER'; end if;
  if p_merchant is null or length(p_merchant) not between 1 and 200 then raise exception 'INVALID_MERCHANT'; end if;
  if p_customer is null or length(p_customer) not between 1 and 200 then raise exception 'INVALID_CUSTOMER_IDENTITY'; end if;
  if p_conversation is null or length(p_conversation) not between 1 and 200 then raise exception 'INVALID_CONVERSATION_IDENTITY'; end if;
  if p_message is null or length(p_message) not between 1 and 200 then raise exception 'INVALID_MESSAGE_ID'; end if;
  if p_body is null or length(p_body) not between 1 and 4000 then raise exception 'INVALID_MESSAGE'; end if;
  if p_occurred_at is null then raise exception 'INVALID_MESSAGE_DATE'; end if;
  if p_name is not null and length(p_name) not between 1 and 200 then raise exception 'INVALID_CUSTOMER_NAME'; end if;
  if p_phone is not null and length(p_phone) not between 1 and 40 then raise exception 'INVALID_CUSTOMER_PHONE'; end if;
  insert into delivery_customers(provider,merchant_id,external_id,name,phone)
    values(p_provider,p_merchant,p_customer,p_name,p_phone) on conflict(provider,merchant_id,external_id) do nothing;
  select id into customer from delivery_customers where provider=p_provider and merchant_id=p_merchant and external_id=p_customer;
  -- Preenche apenas lacunas: identidade já registrada nunca é sobrescrita por dado novo.
  if p_name is not null or p_phone is not null then
    update delivery_customers set name=coalesce(name,p_name),phone=coalesce(phone,p_phone),updated_at=now()
      where id=customer and (name is null or phone is null);
  end if;
  insert into delivery_conversations(provider,merchant_id,external_id,customer_id)
    values(p_provider,p_merchant,p_conversation,customer) on conflict(provider,merchant_id,external_id) do nothing;
  select * into conv from delivery_conversations where provider=p_provider and merchant_id=p_merchant and external_id=p_conversation for update;
  if conv.customer_id <> customer then raise exception 'CUSTOMER_SCOPE_MISMATCH'; end if;
  select * into old from delivery_messages where conversation_id=conv.id and direction='inbound' and external_id=p_message;
  if found then
    if old.body<>p_body or old.occurred_at<>p_occurred_at then raise exception 'MESSAGE_ID_CONFLICT'; end if;
    return conv.id;
  end if;
  next_version := conv.version + 1;
  insert into delivery_messages(conversation_id,external_id,direction,author,body,occurred_at,conversation_version,status)
    values(conv.id,p_message,'inbound','customer',p_body,p_occurred_at,next_version,'received');
  -- Falha segura: mensagem atrasada continua invalidando rascunho pendente da IA.
  update delivery_messages set status='invalidated',invalidated=true where conversation_id=conv.id and status='draft';
  update delivery_conversations set version=next_version,updated_at=now() where id=conv.id;
  return conv.id;
end $$;

-- Handoff auditable IA<->humano. Exige operador com can_manage no escopo da loja.
-- Repetição do mesmo clique é idempotente: não altera versão nem duplica auditoria.
create function public.delivery_set_handoff(p_actor uuid,p_provider text,p_merchant text,
  p_conversation uuid,p_expected integer,p_mode text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare conv delivery_conversations;
begin
  if p_actor is null then raise exception 'CONTACT_ACCESS_DENIED'; end if;
  if not exists(select 1 from delivery_operator_scopes where user_id=p_actor and provider=p_provider and merchant_id=p_merchant and can_manage) then raise exception 'CONTACT_ACCESS_DENIED'; end if;
  if p_mode is null or p_mode not in ('human','ai') then raise exception 'INVALID_HANDOFF_MODE'; end if;
  if p_expected is null or p_expected < 0 then raise exception 'INVALID_HANDOFF_VERSION'; end if;
  select * into conv from delivery_conversations where id=p_conversation and provider=p_provider and merchant_id=p_merchant for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if conv.mode=p_mode and (p_mode='ai' or conv.assigned_to=p_actor) then
    return jsonb_build_object('mode',conv.mode,'version',conv.version,'idempotent',true);
  end if;
  if conv.version<>p_expected then raise exception 'CONVERSATION_CHANGED'; end if;
  update delivery_conversations set mode=p_mode,assigned_to=case when p_mode='human' then p_actor else null end,
    version=conv.version+1,updated_at=now() where id=conv.id;
  update delivery_messages set status='invalidated',invalidated=true where conversation_id=conv.id and status='draft';
  insert into delivery_handoff_audit(conversation_id,actor_id,mode,version) values(conv.id,p_actor,p_mode,conv.version+1);
  return jsonb_build_object('mode',p_mode,'version',conv.version+1,'idempotent',false);
end $$;

-- Compare-and-swap imediatamente antes de persistir: handoff humano, novo inbound ou
-- qualquer mudança de versão descarta a resposta antiga da IA. Nunca envia mensagem,
-- nunca cria pedido e nunca altera valor financeiro.
create function public.delivery_save_ai_draft(p_provider text,p_merchant text,p_customer uuid,
  p_conversation uuid,p_expected integer,p_message text,p_reply text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare conv delivery_conversations; next_version integer;
begin
  if p_message is null or length(p_message) not between 1 and 200 then raise exception 'INVALID_MESSAGE_ID'; end if;
  if p_reply is null or length(p_reply) not between 1 and 4000 then raise exception 'INVALID_MESSAGE'; end if;
  select * into conv from delivery_conversations where id=p_conversation and provider=p_provider
    and merchant_id=p_merchant and customer_id=p_customer for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if p_expected is null or conv.mode<>'ai' or conv.version<>p_expected then return false; end if;
  if not exists(select 1 from delivery_messages where conversation_id=conv.id and direction='inbound' and external_id=p_message) then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if exists(select 1 from delivery_messages where conversation_id=conv.id and direction='outbound' and external_id=p_message) then return false; end if;
  next_version := conv.version + 1;
  insert into delivery_messages(conversation_id,external_id,direction,author,body,occurred_at,conversation_version,status)
    values(conv.id,p_message,'outbound','ai',p_reply,now(),next_version,'draft');
  update delivery_conversations set version=next_version,updated_at=now() where id=conv.id;
  return true;
end $$;

-- Sem nenhuma policy para anon/authenticated: nenhum acesso direto do navegador, nem
-- global para usuário autenticado. A autorização por loja é feita no servidor pelo
-- escopo do operador (delivery_operator_scopes + can_manage) antes de qualquer leitura.
alter table public.delivery_operator_scopes enable row level security;
alter table public.delivery_customers enable row level security;
alter table public.delivery_conversations enable row level security;
alter table public.delivery_messages enable row level security;
alter table public.delivery_handoff_audit enable row level security;
revoke all on public.delivery_operator_scopes,public.delivery_customers,public.delivery_conversations,
 public.delivery_messages,public.delivery_handoff_audit from public,anon,authenticated;
grant all on public.delivery_operator_scopes,public.delivery_customers,public.delivery_conversations,
 public.delivery_messages,public.delivery_handoff_audit to service_role;
revoke all on function public.delivery_receive_message(text,text,text,text,text,text,timestamptz,text,text),
 public.delivery_set_handoff(uuid,text,text,uuid,integer,text),
 public.delivery_save_ai_draft(text,text,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.delivery_receive_message(text,text,text,text,text,text,timestamptz,text,text),
 public.delivery_set_handoff(uuid,text,text,uuid,integer,text),
 public.delivery_save_ai_draft(text,text,uuid,uuid,integer,text,text) to service_role;
-- service_role nunca é exposto no frontend: somente a Edge Function verificada o utiliza.
commit;
