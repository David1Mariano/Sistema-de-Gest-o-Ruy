# Etapa 5 — consolidação final para homologação Windows

19/10/2026. Candidata **A5-I5-20261019 / 0.5.2-rc.1**. Sistema restrito à homologação. **Não liberado para uso operacional.**

## Escopo e auditoria

Worktree `gestao-ruy-integracao-auditoria-20261019`, branch `agente-5-auditoria-integracao-20261019`, base inicial local/remota `a462b2293c80f5129dfd6e6485937e332a357fac`, checkout inicialmente limpo, divergência 0/0 após fetch. `git fsck --no-reflogs --connectivity-only` concluiu sem objetos ausentes/corrompidos; objetos dangling antigos foram preservados. Nenhum merge, reset, limpeza, deploy ou migração operacional.

Revisados os contratos e evidências das Etapas 1–4 e reexecutadas suas suítes. Mantidos sessão SQL/cookie/CSRF, transporte D1, mTLS, fachada, outbox, recibos, CAS, reconciliação e auditoria únicos. Nenhuma nova dependência, autenticação ou persistência paralela. Infraestrutura experimental do Agente 3, login/protocolo/armazenamento paralelo de anexos e serviços cloud continuam excluídos.

O nome `DeliverySettlement`, já existente no financeiro RC3, não representa integração financeira dos novos `DeliveryOrder`. Pedidos continuam `unpaid`, sem baixa financeira/estoque implícita. Valores do painel são estimativas. Não unificar esses fluxos sem contrato transacional e homologação próprios.

Pares RC3 antigos não reconhecem os novos tipos Delivery: mistura de versões permanece proibida para uso operacional. A candidata é identificada separadamente; não existe migração automática de instalações RC3 existentes.

## Matriz consolidada

| Etapa / fluxo | Resultado | Tipo e limites da evidência nova |
| --- | --- | --- |
| 1 — autenticação/sessão/CSRF/permissões | APROVADO em laboratório | 8 cenários HTTP/SQL; login real com usuário sintético, expiração, revogação, replay e viewer recusado. |
| 1 — HTTP/mTLS | APROVADO em loopback | 7 cenários TLS 1.3 adicionais, certificados sintéticos, identidade/token, CA inválida e serviço indisponível. Provisão entre máquinas pendente. |
| Colaboradores | APROVADO em laboratório | API e executável empacotado: criar, consultar, editar, CAS, exclusão autorizada por tombstone e auditoria. Não usa colaboradores reais. |
| RH: vales, consumo, pagamento e desconto | APROVADO no escopo testado | 10 cenários adicionais incluem vínculo ao pagamento, duplicidade, histórico, rollback, API fechar/reabrir e restauração cifrada. |
| Estorno de pagamento com desconto RH vinculado | PENDENTE / BLOQUEADO | Recusa 409 sem efeitos comprovada. Isso não aprova o estorno: implementação da Etapa A permanece exclusivamente no WIP protegido. |
| 2 — estoque/produção | APROVADO em laboratório | 16 cenários SQL com entrada/saída, saldo insuficiente, confirmação/consumo, perdas, cancelamento/estorno, concorrência, rollback, reinício e backup. |
| Financeiro RC3 | APROVADO no escopo existente | Suíte ampliada de 33 cenários inclui contas próprias, pagamentos concorrentes, obrigação única, estornos, reconciliação e restore. Não transfere dinheiro externo. |
| 3 — anexos/comprovantes | APROVADO em laboratório | 14 cenários HTTP/SQL/mTLS: permissões, SHA-256, adulteração, TTL, revogação, retry, recuperação, persistência e restore. UI/transferência também testadas no pacote. TTL não equivale a exclusão física automática por retenção. |
| 4 — Delivery | APROVADO em laboratório | 17 cenários, incluindo 36 passos no Electron em desenvolvimento, catálogo/pedido/edição/cancelamento e CSV 6/6. Não inclui pagamentos, providers ou mensagens. |
| D1/C2/reconciliação | APROVADO com clientes simulados | Dois D1 lógicos, HTTP/TLS e PostgreSQL reais; propostas preservadas, versões CAS, ACK perdido e operação idempotente. Não equivale a dois Windows. |
| Rollback e integridade | APROVADO em laboratório | Falhas injetadas após gravação comprovam transação indivisível; não são falhas físicas de disco ou energia. |
| Persistência PostgreSQL | APROVADO em clone descartável | Reinício normal, PID alterado e digest idêntico de 9 bancos novos locais/centrais, filas e caches; porta 55437 e PGDATA conferidos. |
| Backup/restauração | APROVADO em laboratório | Dumps cifrados, chave portátil sintética, adulteração/chave incorreta recusadas, restauração em bancos novos e comparação de documentos/ledgers/histórico/bytes/fila. Recuperação independente em outro Windows pendente. |
| 5 — aplicativo empacotado | APROVADO no pacote extraído | `packaged=true`, versão/revisão próprias; API utility process, login, colaborador, estoque/produção, financeiro, anexos e reconciliação. Saída normal, sem kill. |
| 5 — inicialização fechada por padrão | APROVADO no pacote | Sem fixture autorizada, recusa antes do acesso ao ambiente. Perfil e appId exclusivos. |
| 5 — fechar/reabrir pacote e persistir | APROVADO em laboratório | Duas novas execuções do pacote saíram normalmente; preservados dados anteriores, tombstone, estoque e fila de anexos, além dos dados das novas execuções. Cinco verificações; não inclui reinstalação ou reboot Windows. |
| NSIS / instalação limpa / reinstalação | PENDENTE de execução real | NSIS gerado e inspecionado; não instalado em Windows limpo nem no Pichau. Não confundir `win-unpacked` com aplicativo instalado. |
| Dois Windows/reconexão física | PENDENTE | Segunda máquina/VM autorizada ainda indisponível; nenhuma alteração da rede da empresa. |
| Uso operacional | BLOQUEADO | Aceite físico, segurança final e autorização operacional ausentes. |

## Testes e falhas encontradas

Regressões completas descobertas nos arquivos com `node:test` em `scripts/` e `scripts/d1-lab/`: **833 aprovadas, zero reprovadas**. Verificações adicionais do package.json: estoque **121/121**, integridade estoque, estabilidade/integração financeira, freelancer, resumo de categorias e integridade da exclusão RH aprovadas. Lint e builds web/D1 aprovados; avisos de chunks grandes permanecem sem alteração de dependências.

As suítes não são apresentadas como cenários únicos somáveis: há cobertura sobreposta. Scripts históricos que apontam a 18087/55435/55436, artefatos antigos, produção ou testes físicos não foram executados indiscriminadamente. A regressão RC3 foi explicitamente redirecionada para bancos novos no clone 55437, sem alterar o transporte de aplicação.

Falhas iniciais, não contadas como aprovação:

- Primeiro build do pacote: `EBUSY` ao gravar fuses no executável. Repetição concluiu com as proteções preservadas; não foi necessário encerrar processos ou desabilitar segurança. A causa do lock transitório não foi atribuída a um software específico.
- Primeiro verificador de persistência: `42P01 relation d1_attachment_queue does not exist`. O teste assumia que todo banco na porta local tinha schema D1; o isolamento colocou a central C2 nessa mesma porta. Corrigido o verificador para exigir tabelas reais de cada schema e repetido com sucesso. Nenhum código transacional foi alterado.
- Primeiro ensaio adicional de reabertura: leitura protegida DPAPI recusada com erro sanitizado, antes da abertura do aplicativo. Não foram impressas credenciais, alterados arquivos DPAPI ou ampliados timeouts; repetição do mesmo teste passou. A causa específica dessa falha transitória não foi comprovada.

O teste empacotado terminou normalmente. Uma tentativa de diagnóstico do seu PID sintético não encontrou mapeamento do inspector; a checagem posterior encontrou o processo já encerrado e nenhuma mensagem de fechamento foi enviada. Nenhum processo foi encerrado à força nesta etapa.

## Candidata e empacotamento

NSIS Windows x64 **111.997.128 bytes**, SHA-256 `70ac60a6676b2ad084523fd6822b1dde33f6a13579395f0f7456c4d8ef898cc1`.

Local: `artifacts/agente5-integracao5-20261019/Sistema-Ruy-A5-I5-20261019-Setup.exe` no worktree de integração. ASAR SHA-256 `a6413ac2f5ded1efb13eeb0523ef68c2be8cc8eb14f58326eafd62e7bb39ac24`.

Conferidos: 13 dependências de produção, todos os fontes D1/SQL e bundle iguais ao worktree, ausência de bancos/segredos/certificados privados no pacote, RunAsNode/NODE_OPTIONS/inspector CLI desativados e criptografia de cookies ativa. Não há assinatura Authenticode. Não foi feita alegação de validação de integridade ASAR imposta pelo sistema operacional ou de assinatura de distribuição.

O gate I5 exige opt-in, fixture e 18091 antes de acessar o ambiente. A configuração do NSIS conserva AppData na desinstalação; isso é inspeção de configuração, ainda não teste de reinstalação. O diretório do cluster tem herança ACL desativada; o perfil Electron herda ACL do Windows. Não se declara aprovação das permissões finais do serviço/usuário.

## Alterações e preservação

Alterações de finalidade restrita: configuração I5 do electron-builder; perfil/gate I5 em `desktop/main.mjs`; seletor de destino central de fixtures e teste de recusa de portas compartilhadas; correção do snapshot RC3 para schemas locais/centrais; testes RH, pacote, gate e reabertura; relatório, roteiro e evidências. Nenhuma regra de negócio/financeiro/estoque/sincronização foi substituída.

Os dez arquivos Etapa A são comparados por SHA-256 contra a auditoria inicial. Worktree original e HEAD `db99024` preservados. Não houve conexão com bancos operacionais, migração em 55436, alterações no Supabase, produção 8080, API antiga 18080 ou branches originais. Artefatos, backups, perfis, chaves e credenciais permanecem fora do Git. Hashes finais e sincronização constam da entrega Git, sem hash autorreferente neste documento.

Commits de código: `e87b1c7` (candidata, perfil e gate) e `5f663e2` (testes e isolamento). O commit documental subsequente contém esta matriz e as evidências. Conferência visual do screenshot do pacote foi limitada à estrutura/layout; o frame durante troca de tema não comprova aceite visual final, feito pelos testes DOM/SQL no escopo descrito.

## Reproduzir a validação isolada

No laboratório Pichau autorizado, com portas livres, configurar `RUY_D1_ALLOW_TESTS=1`, `RUY_D1_RESTART_FIXTURE=e5aaec701010f607` e `RUY_D1_TEST_API_PORT=18091`. Executar sequencialmente os runners `run-integration-stage1-isolated.mjs`, `run-integration-stage2-isolated.mjs`, `run-integration-stage3-isolated.mjs` e `run-integration-stage5-isolated.mjs` em `scripts/d1-lab/`. Eles verificam marcador/PGDATA e param normalmente somente o clone iniciado por eles.

Para a regressão RC3 ampliada, acrescentar **`RUY_D1_ISOLATE_CENTRAL=1`** antes de `test-agente5-rc3-postgres.mjs`. Essa flag é obrigatória neste procedimento para manter a central em bancos novos na porta 55437. Não executar o teste histórico com seu destino central padrão.

O runner da Etapa 4 exige adicionalmente `RUY_D1_DELIVERY_LAB=1` e, para o Electron em desenvolvimento, `RUY_D1_DELIVERY_UI=1`. Remover essas flags antes das demais suítes para verificar o padrão fechado. O teste empacotado `test-agente5-rc3-windows.mjs` usa `RUY_A5_RC3_EXECUTABLE` apontando ao executável I5 em `win-unpacked`, com a central isolada. Não executar ensaios de falha/autonomia antigos que forcem processos.

O verificador `test-integration-stage5-artifact.mjs` exige `RUY_ELECTRON_TOOL_HOME` com o diretório desktop das ferramentas Electron já instaladas; compara conteúdo, dependências, fuses e SHA-256. O coletor `collect-integration-stage5-evidence.mjs` só lê resultados/arquivos/Git, não conecta a bancos nem descriptografa configurações. Os logs locais incluem tentativas iniciais falhas; hashes públicos permitem distinguir os resultados finais.

## Bloqueios por prioridade

1. **Crítico:** máquina B/VM autorizada, instalação limpa, reinstalação, restauração independente com chaves próprias e reboot real.
2. **Crítico:** dois Windows e reconexão real em janela autorizada; provisionamento/expiração/revogação/rotação de certificados próprios. Loopback permanece padrão.
3. **Alto:** permissões locais finais, separação provisionamento/backup/execução, proteção por ator sob papel definitivo e política de diretórios/perfis.
4. **Alto:** estornos financeiros com descontos RH vinculados. WIP Etapa A não consolidado; operação permanece recusada.
5. **Alto:** pagamentos/liquidações/reembolsos Delivery, providers/atendimento e regras operacionais por papel/loja. Mantidos bloqueados.
6. **Alto:** troca supervisionada da API antiga somente após encerramento normal autorizado; 18080 preservada integralmente.
7. **Crítico para liberação:** política de assinatura/distribuição, revisão final e critérios de aceite operacional com autorização explícita.

Pode iniciar homologação supervisionada sintética no Pichau para os escopos aprovados. **Não há liberação para trabalho real**, nem aceite automático dos módulos em produção. [Roteiro de instalação/homologação](etapa5-instalacao-homologacao-20261019.md) · [evidências sanitizadas](evidencias/agente5-integracao-etapa5-20261019.json).
