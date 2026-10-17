# Entrega do Agente 4: proposta PostgreSQL local

Preparada no worktree `gestao-ruy-agente-4`, branch `agente-4-anexos-unificados`.
Sem alterações na main, publicação, push, merge, leitura de dados reais,
acesso ao Supabase ou migrations em banco compartilhado. Alterações anteriores
da API de anexos foram preservadas. Nenhum anexo existente foi apagado.

## Entidades e contratos

Implementação genérica para CashMovement, DailyFinancialClose, FinancialExpense,
FinancialAccount, AccountsPayable, AccountsReceivable, CardReceivable, Revenue,
ExpenseCategory, FechamentoCaixa, Sangria, CostCenter, DeliverySettlement,
ManualReconciliation e RecurringExpense. Não substitui validações específicas
dos formulários nem implementa automaticamente regras de liquidação/cartão.

Contratos identificados em `src/api/base44Client.js`, `src/lib/localDb.js`,
`src/lib/dailyExpenses.js` e `src/lib/financeiroLoad.js`:
list(sort,limit), filter(query,sort,limit), get(id), create(data), update(id,patch),
transact(id,callback), delete, bulkCreate, deleteMany e subscribe.
O novo cliente cobre list/filter/get/create/update e execute(operationId,changes).
Update exige expectedVersion; não simula callbacks transact no servidor.
Delete não é oferecido: cancelar/estornar via atualização auditada.
Bulk e subscribe precisam de adaptação explícita na integração.

JSONB preserva campos e identificadores legados. Datas de criação/atualização
e versão são controladas no servidor. Relações conhecidas account_id,
financial_account_id, category_id, cost_center_id, payable_id, receivable_id e
recurring_expense_id usam FKs compostas. Demais referências precisam ser
mapeadas antes de importar histórico. Nenhuma importação foi executada.

## Garantias e limites

Execute grava lote, relacionamentos, resultado idempotente e snapshots de
auditoria na mesma transação. OperationId é único globalmente, associado ao
ator e hash canônico da requisição. Repetição devolve o resultado original;
payload diferente falha. O cliente chamador deve guardar e reutilizar o mesmo
identificador e payload ao repetir uma tentativa de resultado desconhecido.
Atualizações usam bloqueio de linha e versão esperada. Dinheiro aceita números
finitos com até duas casas; totais devem ser calculados com centavos/decimal
pelas regras financeiras, sem somas monetárias ingênuas em ponto flutuante.

Papéis admin/finance podem escrever; finance_read pode consultar. Ator vem
exclusivamente de sessão autenticada injetada pelo servidor. É acesso global
ao módulo, sem segregação por filial. Serviço deve usar role SQL restrita,
nunca proprietário do schema; grants específicos estão descritos no SQL.
Auditoria é append-only na camada de aplicação; grants são necessários para
protegê-la contra alterações diretas pelo usuário SQL do serviço.

## Anexos

A API local existente armazena arquivos fora da área pública, com limite de
15 MiB, tipos JPEG/PNG/WebP/PDF, extensão e magic bytes, autorização dono/admin,
URLs assinadas temporárias e SHA-256 na leitura. O novo authorizer exige anexo
do mesmo registro/entidade/campo e verifica acesso e integridade antes de
persistir a referência ruy-anexo://. Metadados/arquivos continuam em disco;
apenas referência e histórico financeiro ficam no PostgreSQL nesta proposta.
Backup deve abranger banco, arquivos e metadados juntos.

Upload deve usar ID estável reservado pelo frontend antes da criação do
registro. Arquivo sem referência após falha permanece preservado e deve ser
reconciliado; não há transação distribuída entre disco e PostgreSQL.
Referências legadas são preservadas como texto, sem baixar ou validar arquivos
remotos. Compatibilidade de preview e migração explícita de IndexedDB/legado
ficam para integração; não ativar fallback silencioso para o navegador.

## Integração para Agente 5

1. Revisar `scripts/local-finance/schema.sql` e provisionar banco exclusivamente
   local/isolado com driver pg, credenciais somente no backend e role restrita.
2. Criar repository com pool pg e createFinanceAttachmentAuthorizer(store).
3. Montar createFinanceApi em /api/financeiro e injetar authenticate(req) da
   autenticação local unificada. API não possui login próprio. Limitar request
   timeouts no servidor hospedeiro; não habilitar CORS amplo.
4. Usar createLocalFinanceClient com token da sessão local e selecionar somente
   essas 15 entidades no agregador. Substituir autenticação/imports de nuvem no
   agregador pelo trabalho do agente responsável; o agregador atual ainda os usa.
5. Adaptar transact e controle updated_date para expectedVersion. Pagamento e
   caixa devem enviar todas as escritas relacionadas em um único execute.
   EmployeePayment/Supplier são contratos externos e precisam de integração
   com os demais agentes para atomicidade e referências completas.
6. Adaptar comprovantes/preview para createAnexosClient. Não remover referências
   antigas. Não migrar ou apagar anexos automaticamente.

Arquivos novos: schema.sql, repository.mjs, api.mjs e attachments.mjs em
scripts/local-finance; src/lib/localFinanceApi.js; scripts/test-local-finance.mjs;
este documento. Dependência PGlite de teste instalada somente em diretório
temporário externo; package.json e lockfile não foram alterados.

## Validação

Teste sintético usa PGlite (motor PostgreSQL em memória, não serviço PostgreSQL).
Executar com RUY_FINANCE_TEST_RUNTIME apontando para diretório temporário onde
@electric-sql/pglite está instalado e `node scripts/test-local-finance.mjs`.
Não lê DATABASE_URL nem arquivos financeiros. Cobre as 15 entidades, despesas,
pagamento em lote, contas, fechamentos, FKs, idempotência, CAS, rollback,
auditoria, papéis, vínculo/acesso/integridade de comprovante e API/cliente HTTP.

API de anexos: seis testes aprovados. Lint e build aprovados (avisos existentes
de tamanho de bundle/Browserslist). Suítes legadas de gastos/comprovantes foram
executadas; emitiram erros do scanner Vite no encerramento, requerendo revisão
antes de usar seus resultados como evidência de integração.

Pendentes: PostgreSQL como serviço com múltiplas conexões e role SQL restrita,
corridas/deadlocks/retry, autenticação local unificada, telas reais, regras
específicas por entidade, importação de histórico e relacionamentos externos,
backup/restore conjunto e teste end-to-end após integração. A proposta não está
ativada no aplicativo atual e não declara removida sua dependência de nuvem.
