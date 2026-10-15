# AGENTE 1 — Entrega do módulo Delivery (isolado, pronto p/ cherry-pick)

## Diagnóstico e comparativo
- `docs/agente-1-delivery-auditoria-1.md`: base, isolamento, arquitetura Ruy.
- `docs/agente-1-delivery-auditoria-2.md`: beepbite (MIT/Apache, Go, referência),
  restaurant-ordering-saas (MIT, template inseguro, inspiração UX),
  ordering-management (MIT, PHP/Vue, especificação de fluxo).
- Decisão: implementação NATIVA. Zero código copiado, zero marca copiada.

## Recursos aproveitados e licenças
- Nenhum código externo copiado. Só ideias de fluxo/UX. Licenças MIT/Apache
  verificadas como compatíveis mesmo assim.

## Funcionalidades implementadas (laboratório, dados sintéticos)
- Painel: faturamento, líquido, pedidos, ticket, canal, pagamento, top produtos.
- Pedidos: novo, busca/filtros, avançar, cancelar com motivo, anti-duplicidade.
- Entregadores: status, entregas, repasse, fechamento individual.
- Financeiro: bruto/descontos/taxas/líquido/recebido/pendente (≠ caixa).
- Planilhas: ordenar, totais, CSV, imprimir/PDF. Clientes LGPD. Cardápio/canal.
- Integrações: conectores DEMO + import CSV com dedup. Sem scraping.

## Telas / fluxos testados
- `/delivery` (após wiring): 8 abas, novo pedido, avançar, cancelar, CSV, import.
- `node scripts/test-delivery.mjs`: 21/21 OK. `test:stock`: 121/121 OK.
- Lint dos arquivos novos: 0 erros. Módulos existentes: NÃO tocados.

## Arquivos (todos NOVOS)
- `src/lib/delivery/`: money, deliveryRules, deliveryService,
  channelConnectors, deliverySeed, deliveryPanel.jsx
- `src/pages/Delivery.jsx`, `src/components/delivery/`: PedidosTab,
  NovoPedidoDialog, DeliveryTabs1/2/3
- `scripts/test-delivery.mjs`, `docs/agente-1-delivery-*` (4 docs)

## Wiring pendente (3 linhas, pós-homologação)
- Ver `docs/agente-1-delivery-wiring.md`: ENTITY_NAMES + navigation + App.jsx
  + script `test:delivery`. Aplicar no cherry-pick para `agente-1@48fd752`.

## Pendências
- Commit na `agente-1` bloqueado por lock fantasma do Git nesta worktree
  (detalhes no chat). Arquivos prontos para cherry-pick/commit.
- Sem credenciais iFood/99Food/WhatsApp: conectores seguem em DEMO.
