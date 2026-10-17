# Handoff Agente 4

## Escopo original
Anexos unificados: todo anexo passa pelo AttachmentPreview. API local de anexos autenticada com POST/DELETE e corpo proprio. Infra de financeiro local (PostgreSQL) experimental.

## Escopo entregue
- API local de anexos (scripts/production/anexos*.mjs) integrada ao server.mjs e manage.mjs.
- Cliente frontend src/lib/localAttachmentApi.js.
- Modulo financeiro local experimental (scripts/local-finance, src/lib/localFinanceApi.js) e documentacao.
- Testes: scripts/test-anexos-api.mjs (6/6 aprovados).

## Funcionalidades prontas para integracao
- Upload/download/autorizacao de anexos via API local.
- Integridade por hash, CORS por allowlist, URL assinada TTL.
- Timeout de request 120s.

## Funcionalidades que nao devem ser integradas ainda
- Modulo financeiro local (PostgreSQL) experimental, nao validado em producao.
- scripts/local-finance/schema.sql requer banco real; nao aplicar sem validacao.

## Arquivos e servicos envolvidos
- scripts/production/anexos.mjs, anexosApi.mjs, anexosAuth.mjs
- scripts/production/server.mjs, manage.mjs
- src/lib/localAttachmentApi.js, src/lib/localFinanceApi.js
- scripts/local-finance/*

## Contratos e dependencias
- Rotas /api/anexos no server de producao.
- Autenticacao local propria (anexosAuth).
- Sem Supabase para anexos.

## Testes aprovados e reprovados
- Aprovados: test-anexos-api (6/6).
- Nao executados: test-local-finance (nao disponivel como script npm; verificar manualmente).

## Riscos de seguranca e compatibilidade
- API local exposta apenas em peer local (enforceLocal).
- Nao alterar producao 8080 sem validacao.
- Modulo financeiro experimental pode conflitar com API operacional existente.

## Hashes dos commits
- 9c27680 feat(anexos)
- 089fbe5 feat(financeiro)
- (handoff commit a seguir)

## Recomendacoes para merge
- Integrar anexos primeiro; validar em staging.
- Manter financeiro local fora do merge ate validacao.
- Revisar manage.mjs copia de runtime.
