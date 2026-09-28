# Delivery: configuração e homologação

## Estado auditado

Workspace `C:\Users\Pichau\gestao-ruy-agente-2`, branch `agente-2`, início em
`b34dde0d1e800b0aee47852df9d44c53cdd507f0`, árvore limpa. Supabase/JWT, comprovantes
e produção local da main foram preservados. Não houve deploy, credenciais reais,
loja real ou teste manual no navegador. Migrations não foram aplicadas no Supabase;
testes SQL usam PGlite em memória. Código testado não significa integração homologada.

## Correção da premissa sobre webhook

[Webhook é exclusivo da autenticação centralizada](https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/webhook-overview).
O adaptador atual usa autorização **distribuída**. A preparação anterior estava
incorreta ao recomendar webhook nesse fluxo. Agora ifood-webhook responde 501
WEBHOOK_UNAVAILABLE_FOR_DISTRIBUTED sem aceitar ou persistir eventos. Não cadastrar
ou implantar esse webhook. Nenhuma flag o habilita silenciosamente. A primitiva
HMAC permanece testada, mas não representa webhook operante.

O transporte suportado é polling, desligado até configuração/homologação. A API
recusa sync sem IFOOD_POLLING_ENABLED=true. Não implementamos client_credentials;
o modelo centralizado exigirá implementação própria, inclusive presença.

## Endpoints oficiais confirmados

Host: `https://merchant-api.ifood.com.br`.

| Método e caminho | Fonte |
|---|---|
| POST `/authentication/v1.0/oauth/userCode` | [Autorização distribuída](https://developer.ifood.com.br/en-US/docs/food/guides/modules/authentication/distributed) |
| POST `/authentication/v1.0/oauth/token` | Mesmo contrato: authorization_code e refresh_token |
| GET `/merchant/v1.0/merchants?page=1&size=100` | [Merchants](https://developer.ifood.com.br/en-US/docs/food/guides/modules/merchant/endpoints) |
| GET `/order/v1.0/orders/{id}` | [Pedidos](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/endpoints) |
| GET `/events/v1.0/events:polling` | [Eventos](https://developer.ifood.com.br/es-CO/docs/food/guides/modules/events/polling-overview) |
| POST `/events/v1.0/events/acknowledgment` | Mesmo contrato; ACK após persistência |

[Detalhes](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/details)
fundamentam os campos normalizados. Não usamos blogs/terceiros como autoridade.
[Rate limits](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/rate-limit/)
variam por endpoint. Há timeout, backoff e tratamento de 429.
[Uso indevido](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/improper-use)
proíbe polling abaixo de 30 segundos e consultas excessivas do mesmo pedido.
Descoberta: até 20 páginas, falha explícita se exceder. Polling: até 100 merchants,
ACK em lotes de 1000 somente depois de persistir.

[Workflow](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/workflow)
documenta detalhes por até 7 dias e retry de 404 inicial por até 10 minutos.
Não é endpoint de listagem histórica; não há backfill automático. Detalhes usam
uma tentativa HTTP por processamento, podendo repetir uma vez após refresh em 401.
Após três processamentos com erro, ou 404 fora da janela, ORDER_RETRY_EXHAUSTED
retira o evento da fila automática, ainda pendente para conferência. Esse limite
é por evento, não orçamento global por pedido.

As regras de [HMAC](https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/webhook-signature)
e [resposta webhook](https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/webhook-request)
foram verificadas, mas não autorizam webhook no modelo distribuído.

## Arquitetura, arquivos e segurança

Componentes: `src/components/integrations/{DeliverySettings,DeliveryAccess,DeliveryFinancialPanel}.jsx`.
Cliente, estados e cálculos: `src/lib/integrations/{deliveryClient,deliveryStatus,deliverySummary}.js`.
Backend: `supabase/functions/delivery-api/index.ts`, `ifood-webhook/index.ts` (bloqueado),
`_shared/{handlers,ifood,provider-http,repository,delivery-domain}.mjs`.
Infraestrutura: `supabase/config.toml`, migration `202609250001_delivery_integrations.sql`,
script opcional `supabase/ops/enable-delivery-worker.sql`, não executado.
Testes: `scripts/test-delivery-integrations.mjs`, mocks e banco em memória.
Montagens existentes: Configuracoes, CashMovementPanel, DirectionCashFlow.

| Tabela | Conteúdo |
|---|---|
| delivery_integrations | Estado, credenciais cifradas, datas observadas e lease |
| delivery_merchants | Lojas autorizadas por plataforma/merchant |
| delivery_events | Envelope mínimo, chave plataforma/merchant/evento, fila e tentativas |
| delivery_orders | Pedido, chave plataforma/merchant/pedido, vínculo ao caixa |

RLS e grants somente para service_role; anon/authenticated não acessam tabelas/RPCs.
Nenhuma tabela/policy antiga é alterada. Tokens/verifier usam AES-256-GCM com chave
externa à tabela. Status projeta metadados, nunca credenciais. Não há segredos
delivery em React, VITE, records, localStorage ou IndexedDB, nem logs de tokens.
Erros não propagam corpos do fornecedor.

Operador: verificação adicional Supabase `/auth/v1/user` e allowlist de UUIDs.
Sessão adicional em memória, distinta do token iFood e do login principal intacto.
Viewer somente leitura; CORS por origem exata; worker com segredo só para sync.
verify_jwt=false não elimina essas verificações internas obrigatórias.

## Autorização, eventos e Financeiro

userCode público → verifier cifrado → autorização no portal → código em input
mascarado e limpo após envio → troca server-side → tokens cifrados → descoberta
de merchants antes de marcar conectado. Refresh ocorre 60 segundos antes da
expiração ou uma vez após 401; falhas exigem atenção/reautenticação. Desconectar
elimina tokens locais e desabilita lojas; revogar também no portal, sem endpoint deduzido.

Constraints, transação e locks impedem duplicação. Mesmo ID com envelope divergente
falha; merchant incorreto é recusado. Eventos antigos não desfazem cancelamento ou
conclusão. Replay não cria receita. Falhas parciais não avançam last_sync_at.
pending é limitado a 20, não contagem global. PLC/CFM/RTP/DSP/CON/CAN são suportados;
demais ficam identificados como não suportados. first_event_at é primeiro observado.

CashMovement é conferência diária, não pedido. Financeiro vincula pedido ao movimento
existente do mesmo dia/canal; servidor grava apenas metadados em delivery_orders.
Não cria CashMovement, Revenue, FinancialExpense ou pagamento. O vínculo não prova
liquidação nem conciliação automática de valores.

Configurações distingue Não configurado, Não conectado, Conectando, Conectado,
Requer atenção, Erro e Reautenticação necessária. Código de autorização não aparece
em texto aberto; userCode é código público de vinculação. Erros desconhecidos são genéricos.
Resumo preserva Balcão/Caixa e separa delivery próprio/iFood/99Food. Sem métricas
fictícias de plataforma sem sincronização. Taxas, líquido, recebíveis, estornos e
repasses continuam indisponíveis. Leitura de pedidos é manual; cron precisa de
instalação. Não há promessa de tempo real nem de ausência de vendas quando a fila está vazia.

## 99Food

O [portal oficial](https://developer-food.99app.com/pt-BR/openapi/index) não forneceu
contrato legível nesta sessão. Não encontramos OpenAPI suficiente no projeto ou
documentação pública verificável de autorização/payloads. Configuração necessária,
botão desabilitado. Não implementados: endpoints, OAuth, tokens, assinatura,
webhooks, normalização ou estados presumidos. Adaptador recusa FOOD99_NOT_AVAILABLE.

## AÇÃO NECESSÁRIA DO PROPRIETÁRIO

1. Criar/selecionar aplicativo distribuído no iFood Developer, módulos Merchant/Order/Event
   e lojas de teste; cumprir os critérios oficiais de homologação.
2. Confirmar com iFood uso de leitura/conferência, polling, presença e coexistência
   com o PDV que confirma pedidos. Não ligar polling em loja real sem validação.
3. Escolher Supabase de teste e revisar histórico remoto antes de aplicar manualmente,
   com autorização, a migration preparada. Nenhuma aplicação remota nesta tarefa.
4. Configurar operadores Auth, e-mail/OTP, template `{{ .Token }}` e UUIDs autorizados.
5. Secrets server-side: `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET`, `DELIVERY_ENCRYPTION_KEY`,
   `DELIVERY_ADMIN_USER_IDS`, `DELIVERY_VIEWER_USER_IDS` (opcional), `DELIVERY_ALLOWED_ORIGINS`,
   `DELIVERY_WORKER_SECRET`, `IFOOD_POLLING_ENABLED`. AES: 32 bytes aleatórios Base64;
   worker: mínimo 32 caracteres aleatórios. Guardar backup seguro. Runtime fornece
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Nada em VITE.
6. Implantar somente delivery-api no projeto de teste correto. Não cadastrar webhook.
   Verificar operador → Conectar iFood → autorizar no portal → enviar código mascarado
   → conferir merchants.
7. Habilitar IFOOD_POLLING_ENABLED=true no ambiente aprovado. Para automação, configurar
   Cron/pg_net/Vault, secrets Vault `delivery_project_url` e `delivery_worker_secret`,
   revisar/executar o script de worker, validar intervalo de 30 segundos e monitorar fila.
8. Testar ponta a ponta com pedidos de teste: refresh, revogação, 401/403/429, quedas,
   duplicatas, cancelamentos e vínculo sem dupla contagem. Investigar eventos
   ORDER_RETRY_EXHAUSTED antes de qualquer reprocessamento manual.
9. Contratos/permissões de financeiro/histórico ainda exigem desenvolvimento, não só credenciais.
10. Obter contrato oficial e sandbox 99Food antes de implementar seu adaptador.
11. Só após homologação, revisar PR e autorizar separadamente merge, deploy e publicação.

## Validação

test:delivery, lint, build; regressões test-payment-proof, test-payable-attachment,
test-production e test-fase2a. Mocks, loopback e banco efêmero, sem plataformas reais.
check-fase2a tem falha histórica e não foi reescrito. Exposições históricas de
localAuth/Web3Forms não são credenciais delivery e não foram alteradas nesta etapa.
