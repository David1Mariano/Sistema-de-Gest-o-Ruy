# Proposta isolada de transporte B/C1/C2

Nenhum arquivo desta pasta é importado pela aplicação. Nenhum arquivo do projeto principal foi alterado ou copiado como baseline persistente. Os arquivos de referência são lidos para construir diff e testar a transformação de entidades em memória.

## Entrega

- `transport.patch`: diff revisável destinado somente a `src/lib/localSession.mjs` e `src/lib/localEntities.mjs` do principal. Não aplicado.
- `localSession.proposed.mjs`: implementação isolada de sessão com a mesma interface C1.
- `entity-changes.mjs`: transformações pontuais do adaptador C2, aplicadas em memória.
- `test-proposal.mjs`: testes sintéticos, sem banco, servidor ou fetch de rede real.
- `build-patch.mjs`: geração do diff por leitura do principal; grava exclusivamente nesta pasta.
- `baseline.json`: SHA256 das referências e propostas, sem segredos/dados empresariais. Diff preserva o padrão de finais de linha dos arquivos alvo; hashes correspondem aos textos antes/depois.

## Contratos preservados

Cookie HttpOnly gerenciado pelo servidor; fetch same-origin; CSRF recebido via JSON de login/me e mantido em memória; logout exige sucesso. Login não exige CSRF anterior. Nenhum token Supabase ou cookie legível usado como sessão.

Employee/Sector/JobRole/SystemSettings continuam sendo as únicas entidades locais habilitadas. UUID, offset de 200, metadados externos ao data, _localVersion, baseVersion, mesclagem de edição, confirmação EXCLUIR e tombstone permanecem. Bloqueios de lote/transact e módulos ainda não integrados permanecem. Nenhuma mudança na seleção LOCAL/NUVEM, no frontend ativo ou na API.

## Erros e resultado

- `not_sent`: validação/prazo falhou antes de invocar o transporte da operação, ou obtenção de CSRF falhou antes da escrita pretendida.
- `unknown`: escrita foi entregue ao fetch e não recebeu confirmação válida; inclui falha de rede, timeout, corpo interrompido, resposta de sucesso inválida e HTTP 500.
- `rejected`: resposta HTTP 4xx recebida. HTTP 401 também invalida CSRF e chama o callback C1, mesmo com JSON inválido.
- `not_applicable`: falha de leitura sem operação de escrita.

Preserva status, code, operationId e detalhes de dependências. Não oculta JSON inválido como objeto vazio. Timer cobre resposta e leitura; corrida com abort evita espera infinita de um mock que ignora signal. Não há retry automático. Uma nova chamada explícita pode reutilizar intenção idêntica e UUID; destino/conteúdo diferentes são recusados antes do envio. A verificação conservadora compara bytes JSON, incluindo ordem de propriedades.

O prazo zero simula timeout antes do envio. Depois que fetch é invocado, não se afirma conhecer se bytes foram enviados ou se houve commit. Uma falha no GET de CSRF retorna not_sent para a escrita pretendida. HTTP 500 é unknown de forma conservadora.

## Testes executados

`node --test proposals/c1-c2-transport/test-proposal.mjs`: 22 aprovados, zero falhas, exit 0. Inclui 401/403/409/500, login/logout/CSRF, JSON inválido, timeout pré-envio e pós-envio, interrupção/leitura travada, UUID/intenção, sem retry/fallback, paginação, mesclagem/versão, tombstone, repetição explícita e replay. Sessão expirada é simulada por HTTP 401, permissões por 403, não por banco real.

`node --test scripts/test-local-api.mjs`: 46 aprovados, zero falhas, exit 0. Suíte anterior inclui HTTP sintético temporário em loopback; não é PostgreSQL nem serviço aberto para a rede empresarial. Nenhum cluster reiniciado, banco criado ou dado real acessado.

Lint direcionado (`npx.cmd --no-install eslint proposals/c1-c2-transport/*.mjs --no-config-lookup --rule 'no-unused-vars:error'`): exit 0. `git apply --check` contra os alvos atuais do principal: exit 0, somente leitura; nenhum patch aplicado. A primeira verificação encontrou incompatibilidade de finais de linha; o gerador foi corrigido para preservar CRLF. Não foi executado build da aplicação, pois a proposta não é importada pelo runtime.

## Integração futura

1. Conferir baseline.json contra os dois arquivos atuais; se divergirem, revisar os hunks, sem sobrescrever mudanças mais recentes.
2. Em área isolada autorizada com B/C1/C2 preservados, revisar transport.patch e executar primeiro git apply --check. Não aplicar este patch no worktree agente-2 atual, que não tem os arquivos alvo.
3. Aplicar somente após autorização de integração. Não copiar localApiAuth/localApiClient/backendSelection/base44Client do Agente 2 sobre C1/C2.
4. Reexecutar testes sintéticos, acrescentar testes API/PostgreSQL em banco descartável e homologar cookies/CSRF/modos em navegador. Lint/build devem ser executados no ambiente integrado. Nenhum teste PostgreSQL foi executado nesta entrega.

## Limites

Proposta não aplicada nem homologada em navegador/servidor real. Intenções e UUIDs de recuperação ficam em memória; não sobrevivem à recarga. Mapas de intenções crescem durante a vida da sessão; política de retenção requer decisão futura. Não existe endpoint específico de reconciliação por operationId. Fila persistente, autorização, auditoria, atomicidade e idempotência continuam sendo responsabilidades do servidor. Nenhum envio ao Supabase foi implementado.

Os 22 testes usam uma transformação da referência C2 atual em memória; não constituem distribuição de código não rastreado de outro worktree. Os demais arquivos anteriores do Agente 2 foram preservados. Não houve commit, push, merge, rebase, reset, deploy ou migration.
