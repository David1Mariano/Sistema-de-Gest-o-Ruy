# Handoff — Agente 2

## Resumo do módulo desenvolvido

Backend local de dados (fachada `src/api/base44Client.js`) com seleção explícita `gr_data_backend` entre `local-api` (LOCAL) e `supabase` (NUVEM), transporte HTTP genérico com timeout/abort, CSRF, idempotência em memória e bloqueios conservadores para auth/transações. Módulo de delivery (Central de Delivery + atendimento operacional) preservado.

## Funcionalidades aproveitáveis

- Seleção de backend sem fallback silencioso (`src/lib/backendSelection.mjs`).
- Transporte HTTP local (`src/lib/localHttpTransport.mjs`) com timeout incluindo corpo, 401/403/409/402/5xx, resposta inválida, resultado desconhecido.
- Fachada de entidades síncrona com Purchase/PurchaseItem (`src/lib/localApiClient.js`).
- Auth local bloqueado até contrato C1 (`src/lib/localApiAuth.js`).
- Delivery: central, contatos, atendimento operacional, migrations.

## Arquivos e contratos importantes

- `src/api/base44Client.js`, `src/lib/backendSelection.mjs`, `src/lib/localHttpTransport.mjs`, `src/lib/localApiClient.js`, `src/lib/localApiAuth.js`, `src/lib/localPgDb.js`.
- `src/pages/CentralDelivery.jsx`, `src/components/integrations/AttendanceCenter.jsx`, `src/components/integrations/CustomerDirectory.jsx`.
- `supabase/functions/_shared/*` (delivery), migrations `20260925/29/30`.
- `scripts/test-local-api.mjs`, `scripts/delivery-*.test.mjs`.

## Testes realizados

- `npm run test:delivery`: 66/66 pass.
- `node scripts/test-local-api.mjs`: 46/46 pass.
- `npm run lint`: sem erros.
- `npm run build`: sucesso.
- `npm run typecheck`: erros pré-existentes em RH.jsx, Setores.jsx, Vales.jsx (não relacionados).

## Alterações pendentes

- Auth local e transações bloqueadas aguardando contrato C1/B.
- Integração do seletor visual bloqueada.
- AuthContext/Login ainda vinculados ao Supabase.

## Dependências externas

- Supabase (nuvem), contrato C1 (backend local), PGlite preservado.

## Conflitos previstos com outras branches

- agente-5 (financeiro/gastos), agente-3 (RH/setores/funções), agente-1 (estoque). Financeiro/Compras edits (upload) tocar arquivos compartilhados.

## Commits e status do push

- Ver git log após commit.
- Push em `origin/agente-2`.
