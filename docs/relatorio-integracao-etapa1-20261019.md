# Entrega da Etapa 1 — contratos e compatibilidade

19/10/2026. Executada exclusivamente na branch `agente-5-auditoria-integracao-20261019`, worktree de mesmo propósito, base `db99024`. Etapas 2, 3 e 4 **não iniciadas**. O [contrato único](contratos-integracao-etapa1-20261019.md) distingue o mecanismo D1 ativo do Delivery reservado para implementação posterior.

## Arquivos e finalidade

- `docs/agente5-auditoria-quatro-branches-20261019.md` e seu JSON de evidências: versionamento da auditoria inicial já entregue, como fotografia daquela fase.
- `docs/contratos-integracao-etapa1-20261019.md`: autenticação/sessão, transporte, anexos e modelo/atomicidade futura de Delivery; critérios únicos para os lotes seguintes.
- `lab/d1/http-transport.mjs`: helper same-origin com prazo que abrange fetch e corpo JSON, classificação de resultado e sem retry/fallback. Adaptação das verificações A2, sem importar sua fachada, seletor de backend ou persistência em memória.
- `lab/d1/client.mjs`: mantém as funções/fachadas e intenções existentes; request delega ao helper. Resposta de outra geração continua recusada; 401 invalida apenas a sessão D1 atual.
- `lab/d1/main.jsx`: escuta a expiração e reapresenta o login D1 existente; não adiciona mecanismo de autenticação.
- `scripts/d1-lab/test-integration-stage1.mjs`: 15 verificações de transporte, sessão, MIME/hash/tamanho/base64/caminho, bloqueio de URL/token paralelo e Delivery ainda desativado. As verificações úteis A4 são exercitadas contra o contrato D1 existente, sem importar anexosAuth ou armazenamento em disco.
- `scripts/d1-lab/test-integration-stage1-api.mjs`: oito cenários com API D1 real e PostgreSQL sintético; nunca aceita o banco compartilhado 55436.
- `scripts/d1-lab/run-integration-stage1-isolated.mjs`: recusa portas ocupadas, confere marcador/PGDATA da cópia descartável 55437, inicia e para normalmente apenas essa cópia. Não reinicia cluster, não apaga banco e não encerra processo à força.
- Este relatório e [evidência resumida](evidencias/agente5-integracao-etapa1-20261019.json).

Dependências de build foram reutilizadas por junction ignorada para node_modules já disponível; não houve instalação/upgrade de dependências nem alteração de package.json/lockfile. Logs e builds permanecem ignorados, fora do Git.

## Resultados

| Verificação | Resultado | Limite |
| --- | --- | --- |
| Contratos de autenticação/sessão/transporte/anexos | APROVADO na Etapa 1 | D1 permanece a implementação canônica; nada foi habilitado para operação |
| Testes novos de contrato | 15/15 | Inclui HTTP real temporário para perda de resposta; demais fronteiras usam fixtures/mocks |
| Regressões agrupadas RC3 + novos checks | 85/85 | Inclui 70 testes anteriores; estoque tem 121/121 asserts internos, não somar como outra suíte independente |
| API real + PostgreSQL | 8/8 | Banco novo ruy_d1_rc_* somente na cópia isolada 55437, sem consulta a dados pessoais |
| mTLS loopback | 7/7 | Certificado/token, CA, falta de certificado, rotas internas, indisponibilidade e vínculos ambíguos; não equivale a LAN física |
| Lint | APROVADO | Uma regra de regex de controle foi corrigida durante desenvolvimento; execução final sem erros |
| Builds web e D1 | APROVADO | Avisos existentes de bundle grande; nenhum publish ou deploy |
| Delivery | BLOQUEADO conforme esperado | API/envelope reais recusam DeliveryOrder sem criar registro/outbox |
| TTL de anexos | APROVADO no contrato atual | Cookie/sessão SQL de 8 h, expiração e logout negam acesso. Não se introduziu URL assinada A4 |
| Etapa A | PRESERVADA | Dez hashes SHA-256 idênticos ao inventário; HEAD original db99024, sem commit/stash/reset/alteração no diretório original |

A suíte API usa o papel de aplicação de laboratório, distinto do owner usado para provisionar o banco novo. Grants dessa fixture são limitados ao banco novo e refletem a base RC3; não constituem aceite final de RLS, separação de funções ou permissões SQL para operação. Nenhuma migration ocorreu no 55436, nenhuma conexão SQL foi aberta ao 55435 pelos testes novos e nenhum schema operacional foi modificado.

## Aproveitado, adiado e conflitos

**Aproveitado:** A2 — prazo do corpo da resposta, erro de resultado desconhecido, preservação de status/UUID, não repetição e expiração mesmo com JSON inválido; A4 — casos de validação/integridade/autorização/TTL contra o mecanismo D1 já existente.

**Preservado:** protocolo D1LAB/1/D1BUS/1, fila/recibos duráveis, CAS, auditoria, adaptadores, C2, operações financeiras/estoque/produção, validação de anexos e política Electron.

**Adiado/excluído:** fachadas e login A2, mapa de intenções só em memória, login/token/URLs assinadas/armazenamento A4, financeiro genérico A4, infraestrutura PG A3, wiring de production/server, providers/Edge Functions/Supabase e UI/persistência Delivery. Não foi aplicado merge ou cherry-pick.

**Conflitos resolvidos por decisão de contrato:** sessão D1 em vez de login paralelo; fila/recibo existente em vez de memória como idempotência; anexos vinculados a registro salvo em vez de arquivo sem registro; sessão SQL em vez de novo TTL de URL assinada; dinheiro separado do estado do pedido e sem taxas DEMO oficiais. Patches A2 não foram aplicados aos caminhos incompatíveis.

## Repetição segura

Testes de contrato: `node --test scripts/d1-lab/test-integration-stage1.mjs`. Para a API real, definir RUY_D1_ALLOW_TESTS=1 e RUY_D1_RESTART_FIXTURE=e5aaec701010f607 e executar `node scripts/d1-lab/run-integration-stage1-isolated.mjs`. Recusa 55437/18091 ocupadas; preserva banco/arquivos privados ao terminar e fecha apenas serviços próprios. Não usar o teste diretamente contra outro cluster.

Lint: npm run lint. Build web: npm run build. Build D1: npx --no-install vite build --config lab/d1/vite.config.mjs. A suíte mTLS original RC3 requer opt-in sintético e usa apenas servidor HTTP temporário e HTTPS loopback. Não executar suítes simultaneamente nas mesmas portas.

## Git e bloqueios

Auditoria/contratos e transporte/testes são commits separados por finalidade. Antes de cada commit: diff/check e verificação de padrões de segredos/artefatos privados. A consulta git ls-remote anterior aos commits não encontrou a branch remota; uma nova consulta é necessária imediatamente antes de eventual push. Havendo trabalho remoto novo, não sobrescrever, não forçar e não fazer merge automático.

Ainda faltam: autorização para começar a Etapa 2; integração/testes dos lotes de estoque/produção, anexos e Delivery; homologação visual do ajuste de transporte no Windows; novo empacotamento futuro (o instalador RC3 anterior permanece histórico); dois Windows/VM autorizada, reconexão real e critérios operacionais completos. A Etapa 1 não conclui o WIP de estorno RH e não libera funcionalidades empresariais.

Produção 8080, API antiga 18080/PID 22292, Supabase e sincronização operacional preservados. Sem dados reais, migrations operacionais, merge, deploy ou execução das etapas seguintes. **Aguardar autorização antes da Etapa 2.**
