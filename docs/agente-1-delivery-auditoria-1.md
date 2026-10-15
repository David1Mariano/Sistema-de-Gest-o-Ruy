# AGENTE 1 — Auditoria Delivery (Etapa A, parte 1/2)

> Worktree: `gestao-ruy-agente-1` em `codex-storage-r2@78f0f74` com trabalho local do
> outro agente (R2/storage). Checkout p/ `agente-1@48fd752` bloqueado p/ nao sobrescrever.
> Estrategia: APENAS arquivos novos (`src/lib/delivery/*`, `src/pages/Delivery.jsx`,
> `scripts/test-delivery.mjs`, `docs/agente-1-delivery-*`). Sem merge/rebase/reset, sem
> tocar :8080, sem Supabase real, so dados sinteticos.

## 1. Base e isolamento

- Commit-base `agente-1`: `48fd752 Corrige estoque, movimentacoes e gastos diarios`.
- HEAD atual: `78f0f74 feat(armazenamento): ativa o R2 por feature flag`.
- Arquivos sujos do agente storage PRESERVADOS, nao mexidos aqui.
- Wiring minimo (`navigation.js`, `App.jsx`, `base44Client.js`) documentado em
  `docs/agente-1-delivery-wiring.md` para cherry-pick posterior.

## 2. Arquitetura Ruy (reuso, nao duplicacao)

- React 18 + Vite 6 + Tailwind + shadcn, router v6, react-query, recharts, jspdf.
- Backend: `VITE_DATA_BACKEND=postgres` -> API propria; senao Supabase (`records`
  generica entity/id/data) ou IndexedDB (`localDb.js`). Interface unica:
  list/filter/get/create/update/delete/bulkCreate/deleteMany/subscribe + transact.
- Entidades: nenhuma de delivery em uso exceto placeholder `DeliverySettlement`.
  Nomes `DeliveryOrder/Item/Customer/Address/DriverAssignment/Payment/Fee/Settlement/
  AuditEvent` estao LIVRES (sem duplicacao).
- Reuso: `numberUtils.js` (pt-BR), `stockService.js` (client_token + transact),
  `logAudit` + `AuditLog`, `financialReportUtils.js` (CSV `;` + BOM),
  `NAV_GROUPS` + filtro por papel, `<Route element={<Layout/>}>`.
- D1/C2: IndexedDB + upsert 200 + compare-and-swap. Novas entidades herdam de graca
  ao registrar em `ENTITY_NAMES`. Sem nova sincronizacao na producao.
