# AGENTE 1 — Comparativo open source (Etapa A, parte 2/2)

Pesquisa em 15/10/2026. Nenhum codigo copiado — so especificacao/UX como referencia.
Zero risco de licenca/marca (nada da Brendi copiado).

## 1. vul-os/beepbite (https://github.com/vul-os/beepbite)

- Licenca: MIT OR Apache-2.0 — comercial OK, sem copyleft.
- Stack: Go + React + Postgres proprio, offline-first, multi-moeda, ESC/POS.
- Maturidade: 651 commits, 4 stars, 2 forks — novo, pouca comunidade.
- Recursos: PDV completo (till, KDS, floor plan, inventario, delivery, canais
  plugaveis, sem taxa). Impressao rede ESC/POS real; USB stub.
- Ruy: INCOMPATIVEL direto (Go != Node; Windows nao buildado; Ruy e Windows).
- Reuso: ideias (canais plugaveis, idempotencia na API, estados KDS).
- Testes: go test + integracao/pentest + vitest/playwright web. Bom, fora do Node.
- Veredito: REFERENCIA, nao base.

## 2. roshanx0/restaurant-ordering-saas

- Licenca: MIT — comercial OK.
- Stack: React + TS + Supabase + Vite + Tailwind — o mais proximo do Ruy.
- Maturidade: 4 commits, 29 stars — template, nao produto.
- Recursos: multi-tenant, QR menu, realtime, dashboards, bills, reports.
- ALERTA: RLS `USING(true)` em tudo + senha default `admin123` sem salt. INSEGURO.
- Ruy: UI inspiravel; dados incompativeis (tabelas dedicadas != records generica).
- Reuso: padroes de tela (QR, funil, bills). Nada copiado (TS != JSX; RLS aberto
  nao atende LGPD/auditoria).
- Veredito: INSPIRACAO DE UX, nao base.

## 3. phojie/ordering-management-system

- Licenca: MIT — comercial OK.
- Stack: Laravel (PHP) + Vue 3 + Inertia + Pinia + PGSQL + GCash + realtime.
- Maturidade: 1038 commits, 126 stars — o mais maduro; demo ronaldscatering.com.
- Recursos: papeis (admin/kitchen/delivery-boy/customer), ciclo
  new -> process -> out-for-delivery -> delivered/cancelled, COD + online,
  enderecos, dashboard 30d + graficos.
- Ruy: INCOMPATIVEL direto (PHP/Vue != Node/JSX). Migrar = reescrever.
- Reuso: MAQUINA DE ESTADOS + papeis + dashboard 30d como especificacao.
- Testes: php artisan test incompleto (assumido).
- Veredito: ESPECIFICACAO DE FLUXO, nao base.

## 4. Alternativas extras (triagem)

- QloApps/Floreant/openPOS/Unicenta: GPL (copyleft) + desktop/Java/PHP. Fora.
- Clones Flutter MIT: mobile-first, sem gestao admin BR (taxas iFood/99Food,
  conciliacao, repasse). Fora.
- Conclusao: nenhum atende React + records generica/IndexedDB + Windows +
  conciliacao BR sem reescrever. DECISAO: implementar NATIVO no Ruy.

## 5. Matriz de riscos

| Risco | Mitigacao |
|---|---|
| Faturamento x caixa | centavos inteiros; gross/discount/fees/net/pending/received separados |
| Pedido duplicado | client_token unico + transact (igual estoque) |
| Float em moeda | inteiros em centavos; roundMoney so na borda |
| Concorrencia | transact atomico; transicao validada no registro |
| LGPD | telefone mascarado, papel, auditoria, sem export irrestrito |
| ToS iFood/99Food/WhatsApp | so APIs oficiais; sem credencial -> demo + CSV dedup |
| Planilha como banco | Postgres/IndexedDB e verdade; planilha e export |
| Quebrar modulos | nenhum arquivo existente tocado; so entidades Delivery* novas |
| Travar build/testes | so arquivos novos; lint/build/test isolado antes do commit |
