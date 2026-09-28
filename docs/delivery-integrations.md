# Integrações de delivery — agente-2

## Baseline e limites

Auditoria em 25/09/2026, HEAD `45f2ff8712938b0ffa25388a950dc83dac0b6a05`, branch
`agente-2` inicialmente limpa. Nenhum arquivo de outro worktree foi utilizado.
React/Vite fala diretamente com `records`, usando chave pública e IndexedDB como
fallback. Não havia backend, pasta Supabase, Edge Functions ou integrações de API.
`CashMovement` representa conferências diárias por caixa/canal, com dinheiro,
PIX, débito, crédito, vouchers e saídas. Não é tabela de pedidos. `Revenue` e
`FinancialExpense` já são usados nos indicadores oficiais. Importar um pedido
como nova receita/movimento automaticamente duplicaria lançamentos manuais.

Configurações: `src/pages/Configuracoes.jsx`. Financeiro usa `CashMovementPanel`.
Resumo existente: `src/components/direcao/DirectionCashFlow.jsx`. Rotas em
`src/App.jsx`. A autenticação legada não é prova de identidade para o backend:
`localAuth.js` possui senha fixa histórica (`e3b0676`, também em origin/main).
`emailSender.js` contém configuração Web3Forms histórica. Esses arquivos não são
alterados nem usados para autorizar as integrações; a exposição histórica exige
tratamento separado. Nenhum novo segredo será colocado em `records` ou `VITE_*`.

Baseline de validação: lint/build passam; `test-fase2a.mjs` passa 7/7;
`check-fase2a.mjs` falha em `dialogo-consulta-sem-escrita` porque a expressão
proíbe inclusive a leitura de `current_stock`. Teste e estoque serão preservados.

## Referências oficiais consultadas

- [iFood: autorização distribuída](https://developer.ifood.com.br/en-US/docs/food/guides/modules/authentication/distributed)
- [iFood: aprovação de merchants/homologação](https://developer.ifood.com.br/en-US/docs/getting-started/first-steps/request-access)
- [iFood: endpoints de pedidos](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/endpoints)
- [iFood: campos do pedido](https://developer.ifood.com.br/en-US/docs/guides/modules/order/details/)
- [iFood: eventos e acknowledgment](https://developer.ifood.com.br/es-CO/docs/food/guides/modules/events/polling-overview)
- [iFood: assinatura do webhook](https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/webhook-signature)
- [iFood: resposta do webhook](https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/webhook-request)
- [iFood: limites](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/rate-limit/)
- [iFood: uso indevido/presença](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/improper-use)
- [iFood: API financeira](https://blog-parceiros.ifood.com.br/conciliacao-financeira/)
- [99Food: portal oficial](https://developer-food.99app.com/pt-BR/openapi/index)

99Food: o portal apresentou apenas a aplicação JavaScript, sem contrato técnico
de endpoints legível nesta sessão; navegador indisponível. Não foi obtido OpenAPI
oficial autorizado nem sandbox. Nenhum endpoint 99Food será deduzido. O adaptador
recusa operações com `AGUARDANDO HOMOLOGAÇÃO/CREDENCIAIS 99FOOD`. Também é necessário
fornecer o contrato oficial e validar assinatura, unidades monetárias e eventos
antes de habilitar normalização/persistência 99Food.

Não há garantia de histórico infinito. Os endpoints confirmados nesta etapa são
de eventos incrementais e detalhe por ID; não foi confirmado um endpoint de
listagem histórica. Não são inventados cursores, períodos, taxas, repasses ou
líquido. A API financeira exige permissões/homologação e contrato próprio; seus
campos não serão inferidos de `orderAmount` (valor cobrado do consumidor).

## Arquitetura entregue

`Configurações → acesso verificado → delivery-api → API oficial iFood`.
O acesso adicional usa OTP por e-mail do Supabase Auth e é limitado aos UUIDs
configurados pelo proprietário. A sessão exclusiva fica em memória, sem
localStorage/IndexedDB, e não troca a autenticação do restante do aplicativo.
Papéis/usuários vindos de `records` ou localAuth não são aceitos como autorização.
A Edge consulta `/auth/v1/user` a cada chamada e confere allowlist server-side.

Tokens iFood e verifier são cifrados com AES-256-GCM, chave somente nos secrets
da Edge Function. A tabela de integrações não tem grants para anon/authenticated.
O endpoint status seleciona explicitamente apenas metadados. Nenhuma resposta
ao browser inclui client secret, verifier, access token ou refresh token iFood.
Administrações e refresh/sync são serializados por lease de cinco minutos; em
queda da função, o lease expira. Guardar backup seguro da chave de cifragem;
rotacioná-la exige recifrar credenciais ou reconectar, nunca publicar a chave.

Rotas oficiais utilizadas no host `https://merchant-api.ifood.com.br`:

| Método | Caminho | Uso |
|---|---|---|
| POST | `/authentication/v1.0/oauth/userCode` | Início da autorização distribuída |
| POST | `/authentication/v1.0/oauth/token` | Troca de código e refresh |
| GET | `/merchant/v1.0/merchants?page=...&size=100` | Merchants autorizados, até 20 páginas |
| GET | `/order/v1.0/orders/{id}` | Detalhes de pedido de evento recebido |
| GET | `/events/v1.0/events:polling` | Alternativa opcional, desligada por padrão |
| POST | `/events/v1.0/events/acknowledgment` | Confirma evento já persistido |

O fluxo distribuído devolve código ao lojista no portal iFood, que o informa no
sistema. Não há callback OAuth fictício: a ação `complete` da Edge recebe esse
código e troca server-side usando verifier cifrado. Refresh acontece antes da
expiração ou após um 401, com apenas uma repetição após renovar. 403/revogação
exigem atenção/reconexão. Desconectar apaga tokens locais e desabilita merchants;
o responsável deve revogar também no Portal do Parceiro (nenhum endpoint de
revogação não documentado foi inventado).

Webhook `ifood-webhook`: HMAC-SHA256 nos bytes originais usando client secret,
conferido antes do JSON. Aceita eventos **de pedidos**, valida merchant habilitado,
persiste o envelope mínimo e só então responde 202. Não busca detalhes antes de
responder; chamadas ao banco têm timeout curto. Assinatura inválida → 401; banco
indisponível → erro, permitindo retry do fornecedor. Configurar somente eventos
de pedidos no portal; presença e payloads sem orderId não estão implementados.

`delivery-api` ação `sync` drena a fila. Pode ser chamada manualmente por operador
autorizado ou por cron com segredo próprio; esse segredo não autoriza conexão,
desconexão, leitura de pedidos ou status. O worker processa lotes de até 20 eventos,
com orçamento de tempo e retomada. Erros ficam pendentes com backoff até uma hora;
eventos não suportados ficam registrados como tal, sem inventar status. Um erro
parcial não avança `last_sync_at`. O número `pending` retornado é limitado a 20;
ele indica backlog, não uma contagem global exata.

Estados suportados: PLC, CFM, RTP, DSP, CON, CAN. Cancelamento conhecido pode ser
aplicado mesmo sem consultar novamente o pedido. Atualização atômica de pedido e
evento evita duplicação; data anterior ou regressão de estado terminal não desfaz
cancelamento/conclusão. Envelope duplicado é ignorado; ID reutilizado com conteúdo
divergente falha. Pedidos não contêm nome/endereço/telefone do consumidor.

Polling só é usado se `IFOOD_POLLING_ENABLED=true`. Filtra merchants (até 100),
respeita intervalo mínimo de 30 segundos e envia ACK após persistir. Não confirmar,
aceitar ou cancelar pedidos é uma decisão intencional: esta integração é de leitura
para conferência, e a operação de atendimento continua no sistema já usado pela
loja. Polling pode afetar presença/online no iFood; habilitar somente depois de
homologação e revisão desse efeito com o iFood. Preferir webhook nesta etapa.

## Persistência, financeiro e histórico

Quatro tabelas novas: `delivery_integrations`, `delivery_merchants`,
`delivery_events`, `delivery_orders`. Itens e pagamentos são projeções JSON
normalizadas dentro do pedido; não é necessário criar sete tabelas vazias.
Segredos nunca vão a `records`. Todas as tabelas têm RLS e grants apenas para
service_role. Funções SQL são SECURITY INVOKER e também restritas ao service_role.
A migration não altera tabelas ou policies existentes.

Financeiro recebe a lista de pedidos importados dentro de **Caixas & Delivery**.
O operador pode vincular um pedido ao `CashMovement` existente do mesmo dia/canal.
A Edge verifica o registro novamente, não aceita campos financeiros enviados pelo
cliente. O vínculo fica apenas em `delivery_orders`; não escreve nem soma valores
em `CashMovement`, `Revenue` ou `FinancialExpense`. Um movimento diário pode
representar vários pedidos; cabe ao Financeiro reconciliar seus valores.

O resumo da Direção exibe a mesma consulta em modo leitura, separando pedidos
das entradas oficiais. Delivery próprio vem dos lançamentos existentes; não
inventamos sua quantidade de pedidos/ticket. Consolidado das APIs não é somado
ao total oficial nem às entradas manuais. Essa etapa entrega **conferência**, não
conciliação financeira automática ou reconhecimento contábil de receita.

Somente pedidos concluídos entram em valor bruto/ticket da consulta operacional;
cancelados não entram. Taxas, comissão, líquido do restaurante, recebíveis,
estornos e repasses ficam `null`/“Não disponível” porque não foram obtidos da API
financeira. Importações parciais/sem conexão não provam ausência de vendas.

Histórico: sem backfill não documentado. `first_event_at` é o primeiro evento
observado, não a primeira data disponível no fornecedor; `last_event_at` é o
último observado. A consulta visual é paginada por dia, até 10 mil registros
(excesso gera erro, não total incompleto). Merchant discovery tem paginação real;
polling de eventos não inventa cursor. Para períodos anteriores é necessário
aprovar um módulo histórico/financeiro oficial e implementar seu contrato.

Não há promessa de “Tempo real”. O badge antigo do resumo agora informa leitura
periódica de 20s dos caixas; pedidos importados mostram a última sincronização e
um botão de atualização. O agendador fica desativado até instalação manual.

## AÇÃO NECESSÁRIA DO PROPRIETÁRIO

1. **iFood Developer:** criar/selecionar aplicativo **distribuído** para o CNPJ,
   solicitar módulos Merchant/Order/Event e cumprir a homologação. Obter credenciais
   do aplicativo e lojas de teste. Não enviar esses valores por chat ou Git.
2. **99Food:** acessar o portal oficial, cadastrar aplicativo/parceria, obter
   sandbox, contrato OpenAPI atual, método de autorização/assinatura, escopos e
   processo de homologação. Fornecer a documentação sem segredos para implementar
   o adaptador. O botão continuará bloqueado até essa etapa; não há API 99Food
   funcional nesta entrega. Solicitar também disponibilidade do módulo financeiro.
3. **Supabase:** revisar e aplicar `supabase/migrations/202609250001_delivery_integrations.sql`
   primeiro em ambiente de teste; não foi aplicada ao banco remoto nesta sessão.
   Se o projeto já tiver histórico de migrations remoto, conciliar esse histórico
   antes de usar `db push`; não sobrescrever migrations antigas automaticamente.
4. **Supabase Auth:** criar/confirmar os e-mails dos responsáveis. Anotar os UUIDs
   reais de `auth.users`. Habilitar entrega de OTP por e-mail e configurar o
   template Magic Link para conter `{{ .Token }}`. Não migrar AuthUser legado.
   A verificação vale só para integrações, sem substituir o login existente.
5. **Secrets das Edge Functions**, somente server-side:
   `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET`, `DELIVERY_ENCRYPTION_KEY` (32 bytes
   aleatórios em Base64), `DELIVERY_ADMIN_USER_IDS` (UUIDs separados por vírgula),
   `DELIVERY_VIEWER_USER_IDS` (opcional), `DELIVERY_ALLOWED_ORIGINS` (origens exatas,
   incluindo a porta), `DELIVERY_WORKER_SECRET` (aleatório, mínimo 32 caracteres).
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` são fornecidos
   pelo runtime Supabase. `IFOOD_POLLING_ENABLED` é opcional e permanece falso.
   Não criar nenhuma variável VITE para credencial de plataforma. Credenciais
   99Food ainda não têm nomes assumidos porque seu contrato não foi confirmado.
6. **Deploy das funções**, após revisar os secrets e selecionar o projeto correto:

   ```powershell
   npx supabase functions deploy delivery-api --project-ref SEU_PROJECT_REF
   npx supabase functions deploy ifood-webhook --project-ref SEU_PROJECT_REF
   ```

   A configuração `verify_jwt=false` é intencional: a API valida token com Auth
   remoto/allowlist ou segredo exclusivo do worker, e o webhook valida HMAC.
   Não remover as verificações internas. Sem essas verificações, não publicar.
7. **No aplicativo:** Configurações → verificar e-mail autorizado → Conectar
   iFood → autorizar no Portal do Parceiro → informar código devolvido. Só fica
   conectado depois de obter token e listar merchants reais autorizados.
8. **iFood webhook:** cadastrar URL HTTPS
   `https://SEU_PROJECT_REF.supabase.co/functions/v1/ifood-webhook`, selecionar
   eventos de pedidos e testar assinatura válida/inválida e duplicatas no sandbox.
9. **Automação:** habilitar Cron, pg_net e Vault no Supabase. Criar secrets Vault
   `delivery_project_url` e `delivery_worker_secret` (mesmo valor do worker).
   Revisar/executar `supabase/ops/enable-delivery-worker.sql` para processamento
   a cada 30 segundos. Não fica automático só por fazer deploy. Monitorar
   `cron.job_run_details`, respostas HTTP e `delivery_events.last_error`.
   Intervalos em segundos exigem Postgres compatível conforme documentação.
10. **Validar ponta a ponta:** criar pedido de teste pela plataforma, receber
    evento, sincronizar, conferir pedido no Financeiro, vincular ao lançamento
    existente e conferir resumo sem dupla contagem. Repetir cancelamento,
    revogação, refresh, falha de rede e replay. Só então liberar uso real.
11. **Financeiro/histórico:** solicitar homologação/permissões específicas para
    relatórios financeiros e histórico. Não considerar bruto/pagamento informado
    pelo cliente como repasse liquidado. Não cadastrar taxas estimadas como reais.

Referências Supabase: [OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[autorização de Edge Functions](https://supabase.com/docs/guides/functions/auth),
[agendamento com Vault](https://supabase.com/docs/guides/functions/schedule-functions),
[Cron e intervalos](https://supabase.com/docs/guides/cron/quickstart).

## Validação e merge posterior

Retomada em 28/09/2026: preservados os 5 arquivos modificados e 17 novos
encontrados sobre o HEAD inicial. Concluídas validação de payload JSON, preservação
do estado da conexão em erros de vínculo financeiro e indicação de eventos não
suportados na sincronização manual. Corrigido texto do badge de leitura.

Resultado local: lint e build PASS; 16 testes delivery PASS; fase2a 7/7 PASS;
Deno check das duas Edge Functions PASS. A suíte delivery bloqueia fetch de rede,
usa fixtures sintéticas e PostgreSQL apenas em memória. A migration foi executada
somente nesse banco efêmero de teste, nunca em Supabase ou produção.
check-fase2a mantém a falha conhecida de baseline. Build apresenta aviso de tamanho
de chunk; não houve teste manual de navegador nem validação em loja real.
Auditoria dos 22 arquivos: nenhum segredo privado novo, JWT real ou .env incluído;
literais de tokens encontrados são fixtures de teste. As exposições históricas
descritas no baseline continuam pendentes de tratamento separado.

- `npm.cmd run test:delivery`: contratos/provedores com mocks + migration/RPC/RLS
  executados em PostgreSQL local WebAssembly (PGlite). Nenhuma chamada a lojas reais.
- `node scripts/test-fase2a.mjs`: baseline preservado.
- `node scripts/check-fase2a.mjs`: falha conhecida preservada, não desabilitada.
- `npm.cmd run lint`, `npm.cmd run build`.
- `npx deno check supabase/functions/delivery-api/index.ts supabase/functions/ifood-webhook/index.ts`.

As alterações de UI existentes são pequenas: um import/componente em Configurações,
um em CashMovementPanel, e um em DirectionCashFlow com correção do badge.
`Financeiro.jsx`, Estoque, Gastos, Compras, Produção, localAuth e cloudDb não foram
alterados. Ao integrar com agente-1, revisar principalmente esses dois componentes
financeiros e package.json/package-lock.json. Preservar módulos novos e não somar
os pedidos importados novamente às receitas/caixas existentes.
