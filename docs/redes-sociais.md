# Redes Sociais — fundação, fase 1

Auditoria em 29/09/2026. Branch `agente-redes-sociais`, criada exatamente de
`origin/main` em `8c5f426349c70b3c480db3e3631efa5a1051fbef`, após fetch/prune e status limpo.
Não houve merge, publicação, aplicação de SQL, deploy ou conexão de contas.

## Auditoria e reaproveitamento

| Área | Encontrado na base | Decisão |
|---|---|---|
| Menu | `src/lib/navigation.js`, Sidebar e Topbar derivados de NAV_GROUPS | Adicionar somente item na seção Gestão |
| Rotas | `src/App.jsx`, React Router, ProtectedRoute e Layout | Nova rota `/redes-sociais` dentro da proteção existente |
| Dashboard/cards | Home, `components/shared/StatCard.jsx`, painéis com bordas arredondadas | Reutilizar StatCard e convenções visuais; Home intacta |
| Gráficos | Recharts instalado, `components/ui/chart.jsx`, gráficos financeiros | Reutilizar Recharts, sem dependências novas e sem acoplar dados financeiros |
| Componentes | Tabs, Sheet, Input, Button, Textarea | Reutilizados |
| Autenticação | AuthContext → supabaseAuth/authAdapter → Supabase Auth e perfil legado | Reutilizada; não criar login paralelo |
| Autorização | `app_metadata.system_role`, useUserRole, filtros visuais de menu | Matriz social por ação; serviço exige identidade verificada e acesso à conta |
| Banco | cloudDb sobre `public.records`; fallback legado localDb | Não adicionar entidades sociais ao fallback local nem assumir RLS de records |
| Base44 | Cliente com nome legado; comentário confirma que app não depende do Base44; Vite sem plugin Base44 | Nenhum trabalho específico Base44 ou instalação de SDK/skills desnecessários |
| Integrações | Core.UploadFile e serviços Supabase; sem framework social/OAuth reutilizável encontrado | Reutilizar sessão Supabase futuramente; providers isolados |
| Delivery | DeliverySettlement e painéis financeiros; sem Central Delivery de atendimento nesta base | Nenhuma tabela, componente ou regra reutilizada |
| Meta/social | Busca por Instagram, Facebook, TikTok, webhook e delivery; sem integração social encontrada | Nova fundação isolada |
| SQL | Scripts de inspeção/proposta; diretório supabase citado no README não existe nesta base | Proposta revisável em scripts, não migration executável automaticamente |

A inspeção foi do código versionado, não do projeto Supabase remoto. Policies/grants
atuais de `records` permanecem desconhecidos, conforme auditoria de autenticação existente.

## Entrega e limites

Menu, rota, cards, períodos, filtros, pesquisa, lista recente, painel de comentário,
gráfico selecionável, relatório e integrações. Não há números sintéticos no produto.
`socialClient` devolve arrays vazios e rejeita geração/envio; não faz HTTP nem guarda dados locais.
O painel de comentário aparece quando há registro recebido pelo contrato de dados;
na produção desta fase a lista fica vazia. Fixtures existem somente nos testes.

Relatórios mostram estrutura, período anterior equivalente, fórmula da taxa e estados
vazios. Rankings, agregação de métricas oficiais e comparação numérica aguardam dados e
definições verificadas. Cards não passam a exibir números apenas porque um provider existe.

`SocialProvider` oferece connect/status/listComments/replyComment/listPosts/getInsights/refresh.
InstagramProvider e FacebookProvider são contratos desconectados; todas as operações
externas retornam NOT_CONFIGURED. TikTokProvider rejeita comentários, respostas e insights
genéricos com UNSUPPORTED. Capacidade potencial não significa permissão concedida.
Não há endpoint oficial hardcoded ou pedido público sendo enviado.

## APIs oficiais: evidências e pendências

### Instagram — confirmado oficialmente

A [coleção oficial Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-d34db4fa-de2e-433a-9449-a55a755b5bc0)
confirma contas profissionais Business/Creator, mídia, comentários e respostas.
Facebook Login exige Página vinculada; escopos relevantes: `pages_show_list`,
`instagram_basic`, `pages_read_engagement`, `instagram_manage_comments`.
Publicar mídia é outro escopo e não faz parte desta fase.
A [documentação oficial de Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)
confirma a alternativa sem Página vinculada e os escopos `instagram_business_basic`
e `instagram_business_manage_comments`.

### Instagram — ainda precisa validação

Tentativas de acessar [moderação](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation)
e [insights](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/insights)
diretamente não retornaram conteúdo acessível nesta sessão. Portanto a auditoria atual
de insights/webhooks NÃO está encerrada. Antes do adapter real, conferir escopos de
insights conforme o login escolhido (`instagram_manage_insights` ou
`instagram_business_manage_insights`), métricas atuais, versão Graph, elegibilidade,
retenção e assinatura dos campos comments/live_comments. Esses nomes são itens a
revalidar, não garantia de autorização. Não mapear automaticamente impressões para views.

### Facebook — confirmado oficialmente

A [coleção oficial Meta de tokens de Página](https://www.postman.com/meta/facebook/request/bqfxwbp/get-access-tokens-of-pages-you-manage)
confirma que a conexão usa identidade autorizada e token da Página com tarefas permitidas.

### Facebook — ainda precisa validação

As páginas oficiais de [posts](https://developers.facebook.com/docs/pages-api/posts/),
[webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
e Pages API retornaram 429/indisponibilidade. Não tratar a auditoria de endpoints,
permissões de comentários e Page Insights como concluída.

Checklist para revalidação oficial: leitura da Página/posts (`pages_read_engagement`),
conteúdo de usuários (`pages_read_user_content`), respostas (`pages_manage_engagement`),
lista de Páginas (`pages_show_list`), Insights (`read_insights`) e inscrição de webhooks
(`pages_manage_metadata`, evento feed). Solicitar apenas permissões necessárias;
confirmar dependências, tarefas da Página e revisão do app. Não há endpoints implementados.

### TikTok — confirmado oficialmente

A [Display API](https://developers.tiktok.com/docs/en/display-api-overview) documenta
perfil e vídeos com `user.info.basic` e `video.list`. O
[objeto de vídeo](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object)
inclui like_count, comment_count, share_count e view_count; são contadores, não a
lista de comentários e não alcance/impressões equivalentes à Meta.
A [consulta de comentários](https://developers.tiktok.com/docs/en/research-api-specs-query-video-comments)
é do produto Research; o [acesso Research](https://developers.tiktok.com/docs/en/research-api-get-started)
depende de projeto aprovado. Não pressupor elegibilidade comercial nem capacidade de responder.
UI mostra funcionalidade indisponível.

### TikTok — ainda precisa validação

Produtos de parceiros exigem auditoria própria. Não há confirmação de elegibilidade
da conta Ruy, nem de produto que permita listar/responder comentários para nosso uso.

## Arquitetura e autorização

```text
Frontend / sessão Supabase existente
  → futuro transporte autenticado (não configurado)
  → serviço social / identidade verificada / permissão por ação e conta
  → repositório transacional (não implementado)
  → provider oficial ou SocialAIService (não configurados)
```

| Papel verificado | Visualizar | Relatório | Responder | Aprovar IA | Configurar |
|---|---|---|---|---|---|
| admin / super_admin | Sim | Sim | Sim | Sim | Sim |
| manager / gerente | Sim | Sim | Não | Não | Não |
| demais / sem sessão | Não | Não | Não | Não | Não |

O frontend espelha a matriz para UX. `createSocialService` verifica novamente por ação;
`verifyIdentity` é uma dependência backend obrigatória, não implementada com role do browser.
O adapter futuro deve usar Supabase Auth getUser, verificar vínculo/perfil ativo como o
authAdapter existente, e fornecer somente `app_metadata` confiável. `commentFor`,
`snapshotFor` e `canAccessAccount` devem filtrar as contas acessíveis ao usuário.
Não há endpoint implantado, nem leitura de tabela social pelo frontend. A proposta SQL
nega todo acesso anon/authenticated; não estamos afirmando que RLS foi aplicada remotamente.

## Dados, métricas e idempotência

Comentários normalizados têm identidade provider + account + external_comment_id,
autor mínimo, texto, publicação, datas, status e permalink HTTPS. Metadados brutos são
descartados pelo normalizador. Reimportação preserva id interno/status/resposta e atualiza
conteúdo remoto. Persistência real deverá usar UNIQUE + upsert transacional; o helper
em memória é a regra de reconciliação, não proteção contra concorrência no banco.

Métricas exigem provider, account, metric, definition, unit, period_type, period,
value e collected_at. Null não vira zero. Gráficos separam conta/definição/unidade/tipo
de período e escolhem a coleta mais recente do mesmo ponto; não somam snapshots.
“Todas” não soma métricas de plataformas distintas. Seguidores são snapshots; alcance
único não deve ser somado entre dias. Taxa de resposta usa a coorte de comentários
recebidos no período, com status de resposta confirmada. Sem denominador, mostrar “—”.
Horários dos filtros usam America/Sao_Paulo; armazenamento de instantes em UTC.

## IA e aprovação

Política central em `server/social/ai.mjs`: tom, instruções, versão e lista human-only.
Classify/draft retornam AI_NOT_CONFIGURED. Moderação local só sinaliza atenção;
não é um classificador confiável para liberar automação. Toda saída mantém
automaticAllowed=false, inclusive elogios. Reclamações e termos sensíveis bloqueiam
a geração no serviço e orientam escrita humana.

Devolução, compensação, desconto não autorizado, dados pessoais, colaboradores,
salário/RH, senhas, banco, jurídico, ameaças e ofensas de risco permanecem human-only.
Não há alteração financeira/operacional nem ferramenta da IA com poder de envio.

O painel exige revisão explícita, texto e permissão. O serviço exige confirmação,
versão do comentário e identidade autenticada. Mesmo uma solicitação válida termina
NOT_CONFIGURED: nenhuma aprovação/envio público é persistida nesta fase.
Ao implementar envio real: validar draft pertence ao comentário/versão, gravar texto
exato aprovado + autor + hash + idempotency key atomicamente; qualquer edição invalida
a aprovação. Concorrência deve resultar em conflito, nunca dois envios.

## OAuth, secrets e webhooks futuros

OAuth será iniciado no backend após permissão configure, com state aleatório de uso
único vinculado à sessão, expiração e redirect URI allowlisted; PKCE onde suportado.
Callback troca código no servidor. Tokens e renovação ficam em secret manager/backend,
nunca em VITE, storage do browser ou records. Validar conta e escopos realmente concedidos.
Renovar conforme o fluxo/produto; revogação ou expiração muda status, sem fingir conexão.
Não há tela para colar tokens, credencial real, endpoint OAuth ou refresh implementado.

`webhook.mjs` prepara challenge, HMAC-SHA256 dos bytes brutos, comparação constante,
limite de corpo, forma básica do payload e hash de entrega. Não há listener HTTP.
Meta não oferece um timestamp de entrega universal assinado: não impor janela arbitrária
que descarte retries legítimos. Validar entry.time quando presente; política de atrasos,
reprocessamento e expiração de receipts exige definição antes do deploy.
O handler futuro deve validar cada change conforme versão/campo, mapear somente contas
conectadas, e gravar receipt + comentário + evento numa transação antes de ACK.
Hash impede repetição exata via chave única; UNIQUE do comentário impede duplicata
quando envelopes diferentes carregam o mesmo comentário. Nenhum cache em memória substitui isso.

## Banco e auditoria

`scripts/proposed-social-schema.sql` propõe social_accounts, social_comments,
social_replies, social_metrics, social_ai_drafts, social_events e social_webhook_receipts.
Razão para tabelas próprias: unicidade composta, relacionamentos, RLS separado e histórico
imutável sem alterar records/Delivery. Sem tokens. SQL tem rollback deliberado, RLS forçada,
grants revogados para browser e triggers append-only em events/drafts.
Nenhuma migration aplicada ou testada num Postgres nesta entrega.

`socialEvent` define registro allowlisted de recebimento/sugestão/aprovação/envio/erro,
autor, conta, plataforma e data. Erros externos não são guardados em bruto. Persistência
e integração da auditoria ao repositório ainda precisam ser implementadas: nenhum evento
real existe nesta fase. Retenção e exclusão por privacidade precisam de procedimento
administrativo próprio antes da coleta real, sem edição silenciosa de histórico.

## Validação e riscos

Validação executada: `node --test --test-concurrency=1 scripts/test-*.mjs`:
165 testes aprovados (23 novos e 142 existentes), zero falhas/skip.
Regressões: test-funcoes, test-sectors, test-daily-expenses, test-payment-proof,
test-payable-attachment, test-fase2a e test-production. Também passou
`node scripts/check-fase2a.mjs`. Não há suíte específica de Delivery ou Estoque
nesta base; Fase2A inclui comparação de estoque. test-production valida a
infraestrutura de produção local; não confundir com cobertura integral do módulo Produção.
Lint, build e diff check passaram. Build avisou sobre bundle grande, importação
mista do cliente legado e Browserslist antigo. Testes legados emitiram ruído de
dep-scan/servidor Vite, mas finalizaram com código zero.

Testes novos cobrem regras, autorização backend com dependências
simuladas e renderização React real das abas; não são testes de APIs ao vivo ou de RLS.
Browser indisponível nesta sessão: revisão visual/interativa permanece pendente.
O serviço é uma fundação não implantada. OAuth, repositório, transporte HTTP, adapters,
AI provider, retenção, revisão oficial pendente da Meta e validação Postgres são gates
para outra fase. Não habilitar envio simplesmente removendo o bloqueio de fase um.

## Repository transacional (fase 2, 29/09/2026)

`server/social/repository.mjs` substitui o double em memória por uma
implementação sobre **Postgres/Supabase**. Continua na mesma camada: `SocialProvider`,
`ManyChatProvider`, `SocialAIService`, `manychatIngress`, `outbox`, `channel` e
`transport` **não mudaram**. Nenhuma arquitetura paralela foi criada.

### Por que SQL dedicado

A base social já é SQL (`proposed-social-schema.sql` + `proposed-social-manychat.sql`),
com constraints e RLS. O `records` genérico do projeto **não** oferece unicidade nem
transação, então o repository fala SQL direto — e só pode rodar com service role
**no backend**.

### Contrato

`createSocialRepository({ withClient, isAccountVisible, now })`:

- `transaction(work)` → entrega um `tx` com `claimReceipt`, `upsertContact`,
  `upsertRecord('comment'|'message')`, `appendEvent`, `recordForUpdate`,
  `canAccessAccount`, `insertOutboxOnce`;
- leituras: `commentFor`, `snapshotFor`, `read`, `readMany`;
- `appendDraftAndEvent` (rascunho + evento na mesma transação);
- `recordFailure` (auditoria de falha em transação **própria**);
- `resolveBinding`, `integrationStatus`.

### Atomicidade

`BEGIN`/`COMMIT`/`ROLLBACK` no **mesmo** client; `release()` devolve o pool
inclusive no caminho do erro. Se qualquer etapa crítica falhar, o rollback
impede registro parcial. Nada é uma sequência de escritas independentes.

### Idempotência no banco (nunca SELECT-then-INSERT)

| Domínio | Garantia |
|---|---|
| Evento de transporte | `insert ... on conflict (receipt_key) do nothing returning` |
| Comentário | `unique (provider, account_id, external_comment_id)` |
| Mensagem | `unique (account_id, channel, transport, external_message_id)` |
| Aprovação/outbox | `unique (idempotency_key)` + comparação de `fingerprint` |

Mesmo ID com corpo diferente é **conflito**, nunca sobrescrita. E reentrega
**não** reseta `status`: um comentário já respondido não volta para `pending`.

### Autorização

`isAccountVisible(userId, accountId)` é obrigatório. Sem ele configurado, o
repository **falha fechado** (`FORBIDDEN`) em vez de assumir permissão — não há
autorização fraca. `recordForUpdate` usa `SELECT ... FOR UPDATE`, então versão e
acesso são conferidos dentro da mesma transação (sem TOCTOU).

### Não implementado nesta fase

Sem PGlite no projeto, os testes usam um **executor semântico** que modela unique,
`on conflict`, snapshot/rollback de verdade e `for update`. Isso prova a lógica
transacional e o desenho das constraints — **não substitui um Postgres real**,
que segue pré-requisito de deploy. Nenhuma dependência nova foi adicionada.

O servidor de produção **não** foi transformado em host de integrações. O
handler de ingress continua montável e não montado.


As seções anteriores registram a primeira entrega sobre 8c5f426. Nesta sincronização,
a main encontrada foi exatamente `cce30ecaf2370aa505d13eab76c1d65463e3a271`.
HEAD inicial local/remoto: `af8eccf7442cb18e31fecb4aa6d80c0cf97ae0c2`.
Divergência inicial main...social: 5 à esquerda / 1 à direita.
Merge sem conflitos: `f3e0b05b689f4259fd7793913af2492e54f6a53b`.
Commits incorporados: bc5a358, 00c03c7, 4eee7d4, 77712d7 e cce30ec.

O módulo social, App e navigation foram comparados com af8eccf e permaneceram
idênticos. Estoque, scripts de estoque, package.json e migrations permaneceram
idênticos à main. Somente este documento foi atualizado após o merge.
Todas as rotas/entradas anteriores e Redes Sociais foram preservadas. Delivery
não aparece na navegação nem nas rotas. Nenhuma regra de Estoque foi editada.

### Inventário exato da proposta SQL social

Arquivo: `scripts/proposed-social-schema.sql`. Sem timestamp no nome, fora de
`supabase/migrations`, com BEGIN/ROLLBACK deliberado. Continua proposta; não foi
aplicado, renomeado nem convertido em migration.

| Tabela | Chaves, relações e checks explícitos |
|---|---|
| social_accounts | PK id UUID; UNIQUE(provider, external_account_id); UNIQUE(id, provider); provider instagram/facebook/tiktok; status disconnected/connected/expired/error |
| social_comments | PK id UUID; FK(account_id, provider) → accounts(id, provider); UNIQUE(provider, account_id, external_comment_id); status pending/awaiting_approval/replied; version > 0; raw_metadata até 2048 bytes |
| social_ai_drafts | PK id UUID; FK comment_id → comments; FK generated_by → auth.users |
| social_replies | PK id UUID; FK comment_id → comments; FK draft_id → drafts; FK approved_by → auth.users; UNIQUE idempotency_key; texto aparado entre 1 e 2000 caracteres; status approved/sending/sent/failed/unknown |
| social_metrics | PK id UUID; FK(account_id, provider) → accounts; UNIQUE(account_id, metric, definition, unit, period_type, period, collected_at) |
| social_events | PK id UUID; FK(account_id, provider) → accounts; FK comment_id → comments; FK actor_id → auth.users; action em cinco eventos permitidos; result ok/error; ator obrigatório em human_approved/reply_sent |
| social_webhook_receipts | PK delivery_key; provider instagram/facebook |

Índices explícitos: `social_comments_recent(account_id, created_at DESC)` e
`social_events_comment(comment_id, created_at)`. PKs/UNIQUE também criariam seus
índices implícitos. Campos obrigatórios usam NOT NULL conforme o SQL; não há
constraints ou índices de Estoque reaproveitados.

Grants: nenhum GRANT explícito. REVOKE ALL nas sete tabelas para PUBLIC, anon e
authenticated. RLS ENABLE + FORCE nas sete tabelas; nenhuma policy criada
(acesso do browser negado por padrão). Privilégios efetivos/default privileges
do servidor não foram consultados nesta tarefa.

Função: `public.social_reject_history_mutation() RETURNS trigger`, PL/pgSQL,
search_path public, invoker por padrão; lança exceção para impedir alteração.
Triggers: `social_events_immutable` e `social_drafts_immutable`, ambos BEFORE
UPDATE OR DELETE FOR EACH ROW nas respectivas tabelas. Não há trigger de envio.

Dependências: schema public, auth.users, papéis anon/authenticated e
gen_random_uuid() disponíveis; accounts antes de comments; comments antes de
drafts/replies/events; drafts antes de replies; função antes dos triggers.
Não depende de records nem de migrations do Estoque. Datas do arquivo são
created_at/replied_at/approved_at/collected_at/received_at (timestamptz), e period
(date); não são versões de migration. Constraints sem nome explícito receberiam
nomes gerados pelo PostgreSQL. Nenhum teste de aplicação SQL foi executado.

### Comparação com todas as migrations da main

`Get-ChildItem supabase\migrations | Sort-Object Name` encontrou somente:

| Arquivo | Timestamp do nome | Objeto e dependências |
|---|---|---|
| 20260929010000_estoque_client_token_unico.sql | 2026-09-29 01:00:00 | Índice único parcial records_movimento_client_token_unico sobre records.data->>'client_token', restrito a StockMovement com token não vazio; depende de records e ausência de duplicados |
| 20260929010100_estoque_rpc_transacional.sql | 2026-09-29 01:01:00 | Função aplicar_movimentacao_estoque(text,text,numeric,numeric,numeric,date,text,text,text,text,text), retorna jsonb; SECURITY DEFINER; search_path public,pg_temp; depende do índice anterior, records e gen_random_bytes/pgcrypto |

Formato dos dois nomes: 14 dígitos AAAAMMDDHHMMSS + descrição + .sql. Ordem:
índice antes da RPC, timestamps distintos. Nenhuma colisão de timestamp ou nome
de objeto com a proposta social. Nenhuma migration renomeada ou aplicada.
Os próprios arquivos descrevem seu estado como propostas não aplicadas; estado
do banco remoto não foi consultado. Nenhuma das duas cria tabela, policy RLS ou trigger.

**Risco herdado encontrado na inspeção:** os REVOKE da RPC de Estoque estão nas
linhas 209–219, dentro do corpo `AS $$ ... $$` (linhas 75–245), e portanto não
revogam acesso no momento do CREATE FUNCTION. Não se pode concluir que a criação
deixa a RPC inacessível; isso depende também dos default privileges. Revisar esse
posicionamento e a autorização antes de qualquer aplicação. Arquivo preservado
integralmente, conforme a proibição de alterar Estoque nesta tarefa. As suítes
JavaScript aprovadas não validam segurança/execução PostgreSQL dessa proposta.

### Verificações após sincronização

| Comando | Resultado |
|---|---|
| node scripts/test-social.mjs | 23/23 |
| npm.cmd run test:stock | 121/121, 21 cenários |
| npm.cmd run check:stock | STOCK_INTEGRITY_OK, autoteste 8/8 |
| node scripts/test-funcoes.mjs | 11/11 |
| node scripts/test-sectors.mjs | 27/27 |
| node scripts/test-daily-expenses.mjs | 77/77 |
| node scripts/test-payment-proof.mjs | 13/13 |
| node scripts/test-payable-attachment.mjs | 8/8 |
| node scripts/test-fase2a.mjs | FASE2A_OK 7/7 |
| node scripts/check-fase2a.mjs | FASE2A_STATIC_OK |
| node scripts/test-production.mjs | 5/5 |
| npm.cmd run lint | Passou |
| npm.cmd run build | Passou; avisos de bundle, importação mista e Browserslist |
| git diff --check | Passou |

Zero ocorrência literal de InventoryItem.update em src/. Preservados
criarItemComEstoqueInicial, saldo_inicial e saldo_inicial_sem_historico.
Nenhuma outra suíte test/check foi encontrada em scripts. A suíte production
testa a infraestrutura local, não todos os fluxos operacionais de Produção.

Segurança social reconfirmada por inspeção e testes: sem segredo/token/chave IA
no frontend social, sem secret social VITE, sem HTTP social real no browser,
automaticReplies=false, automaticAllowed=false, revisão humana obrigatória e
assuntos sensíveis human-only. Não houve OAuth, conexão real, IA paga, envio,
chamada de produção, Edge Function ou aplicação SQL. Persistem as limitações
da fundação descritas acima e a ausência de validação visual em navegador.

## ManyChat (transporte de integração)

> Estado em 29/09/2026. Fase de **recebimento e preparação de outbox**, sem
> envio. Nenhuma conta real ManyChat foi conectada, nenhum segredo existe no
> repositório e nenhum SQL foi aplicado.

### Papel na arquitetura

A **Central de Redes Sociais é o sistema principal**. O ManyChat é apenas um
**transporte/provider**: entra como ponte, não como dono dos dados nem da IA.

- Canal real (`instagram`, `facebook`, `whatsapp`) continua sendo a verdade.
- `transport = 'manychat'` registra **como** o dado chegou.
- A IA **não pertence ao ManyChat**: permanece em `server/social/ai.mjs`
  (`SocialAIService`). Não existe `ManyChatAIService` nem arquitetura paralela.

### Canal x transport

| Conceito | Valor | Exemplo |
|---|---|---|
| `channel` | canal real do usuário | `instagram` |
| `transport` | como o evento chegou | `manychat` |
| `provider` (tabela de comentários) | **sempre o canal**, nunca `manychat` | `instagram` |

A Central exibe `Instagram · via ManyChat`, `Facebook · via ManyChat` e
`WhatsApp · via ManyChat` (`originLabel` em `src/lib/social/integrations.js`).

### Mensagem privada x comentário público

Domínios separados, nunca misturados. `SocialMessages` lista mensagens privadas
(DM, Messenger, WhatsApp) e `CommentPanel` lista comentários públicos; uma DM
**nunca** vira comentário. Cada um carrega `kind`, `channel`, `transport`,
`external_message_id` ou `external_comment_id` e `external_contact_id`.

### `ManyChatProvider`

`server/social/manychat.mjs`. Estende o `SocialProvider` de
`server/social/providerBase.mjs` — **não substitui** os providers de canal
(`providers` continua `instagram`/`facebook`/`tiktok`; `transports.manychat` é
separado).

Capacidades atuais:

| Operação | Estado |
|---|---|
| `getContact` | **habilitada** (leitura de contato) |
| `connect` | `false` |
| `listComments` | `false` |
| `replyComment` | `false` |
| `listPosts` | `false` |
| `getInsights` | `false` |
| `refresh` | `false` |

`replyComment()` lança `UNSUPPORTED_CHANNEL`. A UI **nunca** chama ManyChat
diretamente: passa pelo `socialClient` e pelo serviço.

### Client ManyChat (backend)

`createManyChatClient` só faz GET de leitura, em endpoints conferidos na
OpenAPI oficial do Page_API:

- **timeout** com `AbortController` + `Promise.race` (cobre headers *e* corpo);
- **401** → `AUTHENTICATION_FAILED`, **403** → `FORBIDDEN` (sem retry);
- **429** → `RATE_LIMITED` com backoff exponencial limitado (máx. 3 tentativas);
- **`Retry-After`** respeitado; pausa longa (>5s) **não** é antecipada;
- **5xx** → `PROVIDER_FAILURE` com retry limitado; nunca há loop infinito;
- erro de rede nunca expõe header nem chave.

**Rate limit:** não há número oficial confirmado, então **nenhum limite foi
inventado** — apenas tratamento genérico de 429 e retry limitado.

### Health

`connectionCheck()` devolve apenas `configured`, `reachable`, `authenticated`,
`status` e `error_code`. **Nunca** devolve `Authorization`, API key ou resposta
bruta. Sem chave: `configured:false` e **nenhuma chamada HTTP é feita**. A UI
mapeia para 5 estados reais: Não configurado, Configurado, Conectado, Erro de
autenticação e Atenção.


### Ingress (recebimento ManyChat → sistema)

`server/social/manychatIngress.mjs`, handler Fetch **montável, não montado**:

```
POST → autenticação → content-type → limite de tamanho (64 KiB)
     → normalização → transação → ACK
```

- **Autenticação fail-closed**: header `x-ruy-integration-secret`, comparação
  com `timingSafeEqual` sobre SHA-256, segredos com no mínimo 32 caracteres.
  Segredo vem de configuração segura do backend, **nunca do body**.
- **Account mapping** (`binding`) vem da configuração do backend:
  `manychat_account_id` + `channel` + `account_id`, com `native_ids_verified`.
  Conta **nunca** é inferida por nome.
- **Comentário público exige** ID nativo real (`external_comment_id`) **e**
  mapping validado; sem qualquer um dos dois é **recusado** (fail-closed). Não
  se gera ID falso nem hash do texto. Comentário de WhatsApp é recusado.
- **Mensagem privada** exige `external_message_id` e é normalizada separadamente.
- **Idempotência** por `channel + account + external_comment_id` para
  comentários, `channel + account + external_message_id` para mensagens e
  `manychat + external_event_id` para eventos. Mesmo ID com corpo diferente é
  **conflito**, não sobrescrita.
- **Não há deduplicação por texto, nome ou timestamp.** Dois comentários com o
  mesmo texto e autor, mas IDs nativos diferentes, são dois registros.
- Falha em qualquer etapa crítica **não persiste registro parcial**: a transação
  faz rollback e a auditoria de falha vai em transação separada, sem dado bruto
  nem segredo.

### Outbox e aprovação humana

Fluxo implementado: `comentário/mensagem → IA sugere → humano aprova → outbox
pending`. E **para aí**.

- Estados: `pending`, `sent`, `failed`, `retrying`, `cancelled`.
- Nesta fase **só** `pending` é criado, sempre com `blocked_reason:
  'SEND_DISABLED'`.
- `SOCIAL_AUTOMATION = { enabled: false, manychat: false }`.
- Aprovação exige `confirmHuman`, texto, `expectedVersion` e
  `idempotencyKey`; registra `approved_by`, `approved_at`, canal, destino,
  origem, transport, referência ao registro e o outbox.
- `dispatchSocialOutbox()` existe **apenas para lançar `SEND_DISABLED`**.

### Segredos

`MANYCHAT_API_KEY` aparece **apenas** em `manyChatFromEnvironment(env)`, no
servidor. Zero ocorrências em `src/`, zero `VITE_*`, zero chave em bundle, zero
segredo em log ou resposta. Sem infraestrutura de secret, a integração fica em
**`NOT_CONFIGURED`** — nada é improvisado no browser.

### Proposta SQL (NÃO aplicada)

`scripts/proposed-social-manychat.sql` complementa `proposed-social-schema.sql`
e termina em **`ROLLBACK`**. Cobre `social_integrations`, `social_contacts`,
`social_messages`, `social_ingress_receipts`, `social_outbox` e o CHECK de
provider das `social_accounts`. **Nada foi aplicado**: sem `db push`, sem
`migration up`, sem `psql`, sem SQL Editor.

### Implementado agora

- `ManyChatProvider` estendendo o contrato social, com `getContact` habilitado;
- distinção `channel` x `transport` em toda a cadeia;
- mensagens privadas separadas de comentários públicos;
- ingress fail-closed com `timingSafeEqual`, mapping obrigatório e ID nativo
  obrigatório para comentários;
- idempotência por ID nativo, sem deduplicação por conteúdo;
- client com timeout, 401/403/429/5xx e retry limitado;
- health conceitual sem segredo, com 5 estados na UI;
- outbox somente `pending` + aprovação humana rastreável;
- card ManyChat com estado real, sem campo de segredo;
- proposta SQL com rollback, não aplicada.

### Preparado para fase futura

- repository real com `UNIQUE`, locks e rollback (hoje há apenas um double de
  teste; **permanece pré-requisito de deploy**);
- binding de conta ManyChat por ambiente;
- montagem do handler em um host de integrações (o servidor de produção atual
  serve estáticos e **não** deve virar servidor de integrações implícito);
- idempotência de transporte por chave composta na tabela de migração.

### Deliberadamente NÃO implementado

- **worker de outbox NÃO existe**;
- **nenhum envio real foi habilitado** — nada é disparado no ManyChat;
- nenhuma resposta automática, disparo de fluxo, tag ou custom field;
- nenhum sync ativo nem worker de retry de outbox;
- nenhuma conta ManyChat real conectada;
- nenhuma chamada de escrita (POST) na API.

### Possíveis capacidades futuras (somente auditoria, sem código)

Pela documentação pública do ManyChat, candidatas para fase posterior —
**nenhuma implementada aqui**: envio de mensagem, disparo de fluxo, tags, custom
fields, exportação e sincronização incremental. Cada uma exigiria verificação de
API oficial e nova revisão de segurança antes de entrar.

### Duplicidade Meta x ManyChat

Reconciliação só quando os IDs realmente permitem: o comentário recebe a mesma
chave `commentKey({ provider: canal, account_id, external_comment_id })` usada
pelo caminho direto da Meta, então o mesmo comentário **reconcilia em um
registro só**. Quando não é possível afirmar equivalência entre o ID da Meta e o
do ManyChat, o registro **não** é reconciliado — não há heurística por conteúdo,
por nome ou por timestamp.
