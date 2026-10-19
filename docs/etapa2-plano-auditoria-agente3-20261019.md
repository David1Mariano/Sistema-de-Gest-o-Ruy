# Etapa 2 — auditoria e plano antes das alterações

Base confirmada: abc3385, branch agente-5-auditoria-integracao-20261019, limpa e igual ao remoto no início. Revisão do diff dc7e6b5 contra seu merge-base c45bfc6 e comparação com o núcleo RC3. Somente Etapa 2 autorizada.

| Alteração/recomendação A3 | Classificação | Motivo, dependência e teste definido |
| --- | --- | --- |
| Cálculo proporcional da ficha | JÁ EXISTENTE NA RC3 | domainPreview calcula em milésimos, rejeita fração não representável e congela ficha; central revalida quantidade. Reexecutar Fase2A e confirmar preview sem escrita em PG. |
| Validação de saldo com lock | JÁ EXISTENTE NA RC3 | changeStock usa versão, quota e saldo não negativo; central usa versão/lock/transação. Testar saída insuficiente e concorrência. |
| Consumo multi-insumo e rollback | JÁ EXISTENTE NA RC3 | Uma transação local/envelope central; falha deve reverter movimentos/outbox/auditoria/recibo. Testar falha no segundo insumo e falha depois das escritas. |
| UUID exato, replay e resposta perdida | JÁ EXISTENTE NA RC3 | lab_outbox/recibos usam UUID e hash exatos; não usar LIKE nem token por prefixo. Testar mesmo UUID, colisão e ACK perdido. |
| Confirmar explicitamente, cancelar e estornar | JÁ EXISTENTE NA RC3 | domainCommand confirma ordem/diário/consumo juntos e estorna uma vez. Testar ordem ainda não concluída no rascunho, perda detalhada e segunda tentativa de cancelamento. |
| Ordenar locks dos itens | PENDENTE DE INVESTIGAÇÃO para futura mudança do modelo de locks | Hoje há advisory lock por ator no D1 e lock do relógio central antes dos itens, serializando o caminho oficial. Não alterar ordem/resultado sem evidência de deadlock; testar operações concorrentes com insumos em ordens opostas. |
| Checklist Fase2A, concorrência, auditoria, recuperação | APROVEITAR / ADAPTAR | Reusar testes puros já existentes e adaptar cenários ao D1/C2 real, sem importar endpoints/DDL experimentais. Nova suíte em bancos novos apenas no clone 55437; comparar digest após restart normal. |
| Lint dos módulos mjs de laboratório | JÁ EXISTENTE NA RC3 | eslint.config.js já cobre server/local-lab e sync-lab mjs. Não duplicar override completo. |
| Cobertura CJS do guard C2 | ADAPTAR | calculateConfigForFile mostrou configuração padrão, sem no-undef. Adicionar override Node/CommonJS somente ao caminho existente scripts/sync-lab/**/*.cjs; comprovar detecção em lintText sem escrever fixture no código. |
| Override browser para server/local-lab/web | DESCARTAR nesta etapa | Caminho não existe nesta base; não criar código/infra para justificar uma configuração. |
| Remover _headers/_redirects do build do servidor de produção | DESCARTAR nesta etapa | Refere-se ao manifesto de hospedagem, não à produção de estoque. Não há benefício comprovado para D1; toca empacotamento de runtime protegido. Preservar scripts/production/* e testar build atual sem importá-lo. |
| Novas rotas /stock e /production/daily para a mesma baixa | DESCARTAR | Duplicaria comandos D1 validados. Sem segunda rota de confirmação. |
| Infra PG experimental/checkpoints A3 e client stockServicePostgres | DESCARTAR desta integração | Não faz parte do delta commitado; documento relata LIKE/token incompatível/import quebrado. Não copiar, executar ou migrar. |

## Plano e risco

Apenas lint e cobertura de testes/documentação precisam mudar se os ensaios confirmarem o comportamento existente. Nenhuma alteração de regra de negócio é justificada antecipadamente. Caso haja falha real, registrar a reprodução e revisar o menor diff antes de corrigir, preservando contratos da Etapa 1.

Testes obrigatórios planejados: entrada/custo médio, saída, insuficiência; preview sem persistência; confirmação/consumo e perdas; cancelamento/estorno e replay; CAS concorrente local e entre peers; erro intermediário local/central e hook após auditoria; recibo perdido; digest/persistência após reinício normal do clone; auditoria/recibos; transporte da Etapa 1; lint/build/regressões.

Isolamento: recusar 55437 ocupada; verificar marcador e PGDATA; provisionar A, B e central C como bancos novos no próprio clone 55437. Não aplicar SQL no 55436 ou usar o 55435. Não acessar produção 8080, API18080 ou Supabase. Parar somente o clone iniciado pelo harness, sem kill/resetwal/apagar arquivos. Preservar bancos e evidências privadas. Etapa A permanece fora do worktree; verificar dez hashes ao início/fim.
