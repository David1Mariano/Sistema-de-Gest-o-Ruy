# Integração Etapa 2 — Estoque e Produção

19/10/2026. Branch `agente-5-auditoria-integracao-20261019`, base inicial confirmada `abc3385`, RC3 `db99024`. Somente Etapa 2 executada. O remoto estava em abc3385 antes dos commits deste lote.

## Resultado da comparação

O delta commitado do Agente 3 (`c45bfc6..dc7e6b5`) contém quatro arquivos: contrato documental, configuração ESLint e dois arquivos de empacotamento do servidor de produção. Não contém uma nova implementação transacional de estoque/produção aproveitável integralmente. A infraestrutura experimental descrita no handoff não foi importada nem executada.

A matriz detalhada, com dependências e testes definidos antes das alterações, está em [plano de auditoria](etapa2-plano-auditoria-agente3-20261019.md).

| Item | Decisão e resultado |
| --- | --- |
| Checklist de cálculo, saldo, confirmação, cancelamento e concorrência | APROVEITAR a verificação; ADAPTAR os ensaios aos comandos RC3, sem copiar endpoints ou DDL experimental. |
| Lint Node dos laboratórios mjs | JÁ EXISTENTE NA RC3. |
| Lint do guard C2 CommonJS existente | ADAPTAR: acrescentadas regras recomendadas Node/CommonJS; teste comprova detecção de símbolo inexistente e aprovação do arquivo real. |
| Cálculo proporcional, milésimos e custo médio | JÁ EXISTENTE NA RC3; Fase2A e PostgreSQL aprovados. |
| Saldo, CAS, serialização, consumo atômico, perdas, confirmação, estorno, UUID/hash e auditoria | JÁ EXISTENTE NA RC3; testes ampliados confirmaram os mecanismos existentes. |
| Ordenação adicional de locks por item | PENDENTE DE INVESTIGAÇÃO em eventual mudança do modelo de concorrência. Advisory lock por ator e relógio central já serializam os caminhos oficiais. Ensaio com insumos em ordem oposta passou; não há justificativa para substituir o núcleo. |
| Override browser em caminho ausente e remoção de _headers/_redirects do runtime de produção | DESCARTAR neste lote: não comprovam benefício para estoque/produção D1. |
| Infra PostgreSQL experimental, rotas paralelas e baixa duplicada | DESCARTAR: incompatíveis com a autoridade RC3 e fora do delta útil. |

Não houve cherry-pick, nova dependência, alteração de contrato, fachada, autenticação, ledger, fila ou regra de negócio. `src/`, `server/`, `lab/`, `desktop/` e `scripts/production/` permanecem iguais à base desta etapa. O benefício é cobertura verificável e uma lacuna de lint corrigida, preservando o comportamento validado.

## Matriz de testes finais

| Fluxo | Resultado | Evidência |
| --- | --- | --- |
| Entrada e custo médio inteiro | APROVADO | Cenário 01: 10.000 + 10.000 milésimos, custo 250/350 resulta em média 300 centavos. |
| Saída e saldo insuficiente | APROVADO | 02: UUID/hash exato, colisão rejeitada, saldo e snapshot íntegros após recusa. |
| Rollback multi-insumo | APROVADO | 03 e 10: segundo insumo insuficiente reverte primeiro débito local/central, evento, auditoria, cursor e recibo. |
| Falha após escritas | APROVADO | 04 e 06: hook anterior ao commit aborta ledger/auditoria/outbox e agregado de produção integralmente. |
| Rascunho, preview proporcional e perdas | APROVADO | 05: preview não escreve, ordem não está concluída no rascunho, perdas inválidas recusadas. |
| Confirmação e baixa de insumos | APROVADO | 06: ordem/diário/consumo no mesmo commit, replay não debita novamente. |
| Cancelamento e estorno | APROVADO | 07: saldo restaurado uma vez, perdas mantidas, novo UUID de cancelamento repetido recusado. |
| Concorrência local e entre dispositivos simulados | APROVADO | 08/12: versões concorrentes geram um vencedor; ordem oposta de insumos não causa perda de atualização. Saldos convergem nos dois D1. |
| Falha de conexão e ACK perdido | APROVADO em simulação | 09: fila retoma UUID; central HTTP e recibos reais em PostgreSQL. Nenhuma desconexão da rede da empresa. |
| Permissão e credencial revogada | APROVADO | 11: servidor recusa viewer e dispositivo revogado. |
| Integridade e auditoria | APROVADO | 12: soma dos movimentos equivale ao saldo central; confirmação/estorno possuem recibo único e auditoria local. |
| Backup/restauração | APROVADO | 13/15: dump real, arquivo cifrado, chave recuperada; senha incorreta e corrupção recusadas; snapshots restaurados idênticos. |
| Persistência e retomada após reinício | APROVADO | 14/16: PGDATA validado, PID muda com pg_ctl restart normal, digests de A/B/C idênticos; replay HTTP e pull D1 funcionam depois. |
| Contratos Etapa 1 | APROVADO | 15 testes unitários na regressão e oito cenários API reais: login/sessão, CSRF/origem, replay, viewer, expiração e logout; Delivery permanece bloqueado. |
| Dois Windows físicos / reconexão física | PENDENTE | Não executado. Segunda máquina autorizada e janela de rede continuam necessárias. |

Suíte nova: **16/16**. Regressões Node: **86/86**, incluindo **121/121** verificações internas de estoque e o novo teste de lint. Fase2A: **7/7**; verificações estáticas Fase2A e integridade de estoque aprovadas. `npm run lint`, build web e build D1 aprovados. Avisos de build: chunks acima de 500 kB e base Browserslist desatualizada; não houve atualização de dependências.

As primeiras execuções do harness detectaram duas suposições incorretas do teste: campos derivados do diário estão em `payload_json`, e o ledger central usa `quantity/item`, diferentemente do local. Corrigidos os testes; nenhuma alteração no produto foi necessária. Nenhum cenário final ficou reprovado.

## Isolamento e reprodução

O harness recusa 55437 ocupada, verifica marcador e PGDATA, inicia somente o clone descartável já existente `e5aaec701010f607` e encerra-o normalmente ao terminar. Todos os bancos A, B, C e restaurações são novos bancos sintéticos em **55437**, inclusive a central. Não há DROP, initdb, resetwal, kill ou recriação do cluster. O helper lê a identificação protegida dos laboratórios existentes, mas não abre conexão em 55435/55436. Dumps e chaves temporários permanecem em diretório privado; não são versionados.

No Windows autorizado que possui o clone marcado:

```powershell
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_RESTART_FIXTURE='e5aaec701010f607'
node scripts/d1-lab/run-integration-stage2-isolated.mjs
node scripts/d1-lab/run-integration-stage1-isolated.mjs
node scripts/test-fase2a.mjs
node scripts/check-fase2a.mjs
node scripts/check-stock-integrity.mjs
node --test scripts/d1-lab/test-integration-stage1.mjs scripts/d1-lab/test-h-units.mjs scripts/d1-lab/test-client-recovery.mjs scripts/d1-lab/test-build-aliases.mjs lab/c2-runtime/scripts/test-local-health.mjs scripts/test-employee-delete.mjs scripts/test-stock.mjs scripts/test-payment-proof.mjs scripts/test-payable-attachment.mjs scripts/d1-lab/test-agente5-rc2-policy.mjs scripts/d1-lab/test-stage2-lint.mjs
npm run lint
npm run build
npx --no-install vite build --config lab/d1/vite.config.mjs
```

Os dois harnesses devem ser executados sequencialmente. Resultados sanitizados, digests e hashes dos logs desta execução estão em [evidências JSON](evidencias/agente5-integracao-etapa2-20261019.json). Logs completos e artefatos privados ficam fora do Git.

## Arquivos e commits

- `eslint.config.js`: cobertura CJS do guard existente.
- `scripts/d1-lab/test-stage2-lint.mjs`: teste da cobertura.
- `docs/etapa2-plano-auditoria-agente3-20261019.md`: matriz prévia e critérios de seleção.
- `scripts/d1-lab/test-integration-stage2.mjs`: ensaios sintéticos SQL/HTTP, concorrência, falhas, backup e persistência.
- `scripts/d1-lab/run-integration-stage2-isolated.mjs`: controle exclusivo do clone marcado.
- Este relatório e `docs/evidencias/agente5-integracao-etapa2-20261019.json`: resultados verificáveis.

Commit de auditoria/lint: `2d80896`. O commit seguinte contém exclusivamente o harness, os testes transacionais e as evidências desta etapa; consultar `git log` para seu hash. Verificação de arquivos sensíveis precede cada commit. O estado remoto será novamente verificado antes do push exclusivo desta branch.

## Limites e preservação

Teste SQL/HTTP real em um Windows; dois clientes e falhas de rede simulados. Não comprova instalação limpa, rede física, escala operacional nem homologação por usuários. A nova cobertura não autoriza ativar sincronização operacional ou liberar a RC3. Refatorar locks sem mudança de modelo não é bloqueio demonstrado deste lote.

Os dez hashes WIP da Etapa A foram comparados com o inventário da auditoria e permaneceram idênticos; HEAD original `db99024` preservado. Não foram tocados produção 8080, API antiga 18080, Supabase ou branches dos demais agentes. Nenhuma migration em banco operacional/compartilhado. Etapa 3 (Anexos) não iniciada; aguarda autorização específica.
