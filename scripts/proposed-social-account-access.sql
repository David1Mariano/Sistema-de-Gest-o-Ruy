-- ===========================================================================
-- MIGRATION PROPOSTA — AUTORIZAÇÃO POR CONTA SOCIAL. NÃO APLICADA.
--
-- Objetivo: resolver a lacuna de `isAccountVisible` com um modelo REAL de
-- vínculo usuário -> conta, em vez de "admin vê tudo" ou deny-all eterno.
--
-- O que já existe (proposto, NÃO aplicado): `social_accounts` tem PK `id`,
-- `provider`, `status` (disconnected/connected/expired/error) e a chave única
-- (provider, external_account_id). `social_comments`, `social_messages`,
-- `social_metrics` e `social_events` referenciam (account_id, provider).
-- Esta migration NÃO recria nada disso: adiciona APENAS a tabela de acesso.
--
-- DECISÃO DE MODELO (por que não é só `system_role`):
--   `system_role` diz O QUE a pessoa pode fazer no sistema (função). Ele NÃO diz
--   A QUAL conta ela pode aplicar isso. Sem a segunda dimensão, qualquer admin
--   veria e responderia em toda conta social — inclusive contas de outra filial
--   ou de outro cliente. Por isso a autorização final é a INTerseção de:
--     (a) permissão funcional  -> app_metadata.system_role (já existe, e é o que
--         `socialPermissions` no domínio já lê), e
--     (b) vínculo com a conta  -> esta tabela.
--   Ter (a) sem (b) NÃO dá acesso. Ter (b) sem (a) também não.
--
-- PERMISSÕES POR DIMENSÃO (não é uma flag genérica "pode tudo"):
--   can_view      -> ver comentários/mensagens/métricas da conta
--   can_reply     -> preparar/aprovar resposta
--   can_approve_ai-> aprovar sugestão da IA
--   can_admin     -> configurar a integração da conta
--   Um operador de atendimento pode ter can_view+can_reply e NÃO can_admin.
--
-- IDENTIFICADOR DO USUÁRIO: `auth_user_id uuid references auth.users(id)`.
-- Escolha deliberada: o `legacy_auth_user_id` do app_metadata é um id do
-- inventário local (`records`), não do Auth. Guardar os dois permitiria que
-- alguém trocasse o vínculo de um usuário para o de outro. O vínculo é
-- REVOGÁVEL por UPDATE (active=false) e verificável em uma única consulta.
--
-- ESTA MIGRATION NÃO CONCEDE ACESSO A NINGUÉM. Não há INSERT. Sem isso, aplicar
-- o arquivo criaria vínculos em massa a partir de uma lista inventada — que é
-- exatamente a autorização fake que a fase 3 proibiu.
-- ===========================================================================
begin;

create table public.social_account_access (
  id uuid primary key default gen_random_uuid(),
  -- Composite FK: garante que a conta exista E que o provider do vínculo
  -- case com o da conta. Um vínculo não pode apontar para conta inexistente.
  account_id uuid not null,
  provider text not null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  -- Papel no escopo DA CONTA, independente do system_role global.
  scope_role text not null default 'operator'
    check (scope_role in ('viewer','operator','manager','admin')),
  can_view boolean not null default false,
  can_reply boolean not null default false,
  can_approve_ai boolean not null default false,
  can_admin boolean not null default false,
  active boolean not null default true,
  -- Um vínculo revogado continua no histórico (auditoria), mas não autoriza.
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, provider) references public.social_accounts(id, provider),
  -- Um usuário não aparece duas vezes na mesma conta. `unique` (e não
  -- `exclude`) porque não é chave parcialmente indexada: o vínculo único é
  -- total, revogar é UPDATE, não segunda linha.
  unique (account_id, auth_user_id),
  -- Coerência interna: revogação e permissões precisam ser coerentes para o
  -- CHECK ser útil (abaixo).
  check ((revoked_at is null) = active)
);

-- Um vínculo inativo NÃO pode carregar permissão alguma. Sem esta trava, um
-- UPDATE só em `active=false` deixaria can_reply=true "dormindo" para quando
-- alguém reativasse o vínculo sem revisar.
alter table public.social_account_access
  add constraint social_account_access_active_no_permission
  check (active or (not can_view and not can_reply and not can_approve_ai and not can_admin));

-- Quem responde, precisa poder ver. Sem isso, existiria um vínculo com
-- can_reply e can_view=false, um estado impossível de explicar ao usuário.
alter table public.social_account_access
  add constraint social_account_access_implies_view
  check ((can_reply or can_approve_ai or can_admin) = false or can_view);

-- Quem administra, precisa poder responder. A cascata evita privilégio
-- "administrador que não vê" — quase sempre erro de cadastro.
alter table public.social_account_access
  add constraint social_account_access_admin_implies_reply
  check (can_admin = false or can_reply);

-- `updated_at` é mantido pelo banco, não pelo cliente: a API não pode dizer
-- que não alterou nada.
create or replace function public.social_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$ begin
  new.updated_at := now();
  return new;
end $$;

create trigger social_account_access_touch
  before update on public.social_account_access
  for each row execute function public.social_touch_updated_at();

-- Índices. O quente é a verificação de acesso por conta+usuário, em toda
-- leitura e em toda operação; o índice parcial cobre só vínculos ativos, então
-- um vínculo revogado não ocupa a busca.
create index social_account_access_active_lookup
  on public.social_account_access (auth_user_id, account_id)
  where active;

-- Listagem do que um usuário enxerga, por conta: suporte e relatórios.
create index social_account_access_by_account
  on public.social_account_access (account_id)
  where active;

-- RLS: MESMO PADRÃO DO RESTANTE DO DOMÍNIO SOCIAL (ver
-- proposed-social-schema.sql:92-98 e proposed-social-manychat.sql:84-90):
-- RLS ENABLE + FORCE + REVOKE ALL para public/anon/authenticated, e NENHUMA
-- policy. Sem policy, até um usuário autenticado não lê nada: o acesso passa a
-- ser decidido pelo backend, que já valida o JWT e cruza com esta tabela.
-- Isso é deliberado — abrir policy para `authenticated` entregaria a lista
-- completa de contas a qualquer usuário logado, que é o oposto de escopo.
alter table public.social_account_access enable row level security;
alter table public.social_account_access force row level security;
revoke all on public.social_account_access from public, anon, authenticated;
revoke all on function public.social_touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- REGISTRO DE AUDITORIA DAS OPERAÇÕES DE ACESSO (Fase 7).
--
-- A tela de Configurações concede, edita, revoga e reativa. Cada uma dessas
-- ações precisa deixar rastro: quem fez, em qual conta, sobre quem e quando.
--
-- TABELA PRÓPRIA, e não uma linha em `social_events`: `social_events` tem CHECK
-- de `action` fechado para o ciclo de comentários e respostas
-- (`comment_received`, `human_approved`, `reply_sent`, ...), e esta fase é
-- justamente sobre acesso administrativo. Forçar essas ações no CHECK de um
-- histórico que já tem dono transformaria duas-importantas linhas em uma só —
-- e apagar a distinção entre "comentário recebido" e "acesso revogado".
--
-- `details` guarda o antes/depois das permissões. NÃO guarda token, senha nem
-- identificador de plataforma: esta tabela é consultável e pode ir para
-- relatório.
-- ---------------------------------------------------------------------------
create table public.social_account_access_audit (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  provider text not null,
  action text not null check (action in
    ('access_granted','access_updated','access_revoked','access_reactivated')),
  target_user_id uuid not null references auth.users(id),
  operator_user_id uuid not null references auth.users(id),
  details jsonb not null default '{}' check (octet_length(details::text) <= 4096),
  created_at timestamptz not null default now(),
  foreign key (account_id, provider) references public.social_accounts(id, provider),
  -- Quem opera é informação obrigatória: sem ela o registro não serve para
  -- auditoria, e permitir `null` tornaria o buraco silencioso.
  check (operator_user_id is not null)
);

-- Consulta típica: "o que aconteceu nesta conta, em ordem".
create index social_account_access_audit_recent
  on public.social_account_access_audit (account_id, created_at desc);
-- "Quem me mudou o acesso?": resposta rápida sem varrer a tabela inteira.
create index social_account_access_audit_target
  on public.social_account_access_audit (target_user_id, created_at desc);

-- Histórico é imutável, como `social_events`: corrigir um registro de acesso
-- seria reescrever a história de quem autorizou o quê.
create or replace function public.social_reject_access_audit_mutation() returns trigger
language plpgsql set search_path = public as $$ begin
  raise exception 'social_account_access_audit e append-only';
end $$;

create trigger social_account_access_audit_immutable
  before update or delete on public.social_account_access_audit
  for each row execute function public.social_reject_access_audit_mutation();

-- Mesmo padrão de RLS do restante do domínio: sem policy, acesso só pelo backend
-- autenticado, que valida `configure` + `can_admin` a cada operação.
alter table public.social_account_access_audit enable row level security;
alter table public.social_account_access_audit force row level security;
revoke all on public.social_account_access_audit from public, anon, authenticated;
revoke all on function public.social_reject_access_audit_mutation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- NENHUM INSERT / NENHUM GRANT.
--
-- A tabela nasce VAZIA e inacessível por padrão. O backend só deve ler depois
-- que o responsável cadastrar os vínculos, revisando conta por conta.
-- Enquanto a tabela estiver vazia, `isAccountVisible` devolve false para todo
-- mundo: fail-closed preservado, e o motivo passa a ser "vínculo não
-- cadastrado" em vez de "schema inexistente".
-- ---------------------------------------------------------------------------

rollback;
