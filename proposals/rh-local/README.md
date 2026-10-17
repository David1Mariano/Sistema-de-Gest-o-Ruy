# Proposta isolada — contratos RH para B/C1/C2

Branch agente-2, HEAD fdcad742ad0b2345ed3ecd9aac5b9a5bce9c8318. Nenhum arquivo ativo da aplicação alterado. Referência principal somente lida. Patch de transporte aprovado preservado, SHA256 097A1B0C7599C1674F620AB19E53C9C7E57C2C1154265D4D18DF7EACA9DF1783.

## Implementação

Contratos de list/filter/get/create/update/delete para EmployeeDocument, EmployeePayment, Evaluation, Warning, Vale, Absence, TimeRecord, Schedule, StandardSchedule. Usa as rotas existentes GET/POST /api/local/records/:entity/:id, UUID de operação, baseVersion externo, offset de 200, confirmação EXCLUIR. Não cria schema ou nova API genérica. Cada escrita herda a transação B com dado, fila, autoria, auditoria, CAS e idempotência persistente.

`rh-contract.mjs` propõe um guard adicional, executado antes da mutação e dentro da mesma transação/lock B. Campos foram mapeados dos formulários RH e pontoActions/escalaData; unknown fields são negados. Valida datas, horários, tipos, valores, relação employee_id, substitute_id e schedule_id. Reatribuição silenciosa de employee_id é negada. Duplicate TimeRecord por funcionário/data e StandardSchedule por funcionário/dia são bloqueados mesmo com UUID/ID diferentes. Escalas conflitantes são verificadas no backend.

Permissões conservadoras: administrador ativo pode ler/criar/editar/excluir; operator/viewer não acessam nenhuma das nove entidades, incluindo campos financeiros/pessoais. B já aplica essa regra na API; não cria novos papéis nem concede privilégios a contas remotas presumidas. authorizeRh é um contrato explícito testado e coincide com a autorização B atual. Não há permissão por funcionário individual nesta entrega.

Exclusões somente tombstones com EXCLUIR e versão atual; preservam IDs, dados, fila e auditoria. Schedule com referências em Absence/TimeRecord, inclusive tombstones, não pode ser excluído. Vínculos RH continuam bloqueando exclusão de Employee pelo C2. Não há cascade/delete físico. Não há envio Supabase ou fallback.

## Arquivos novos

- rh-contract.mjs: proposta para server/local/rh-contract.mjs.
- integration.mjs: alterações pontuais de core/allowlist em memória, não aplicadas.
- build-patch.mjs, rh.patch, baseline.json: diff e hashes para revisão.
- test-rh.mjs: testes sintéticos executando o mutate B real com SQL em memória e guard proposto.
- test-postgres.mjs: harness opt-in para instância exclusiva, bloqueado sem configuração explícita.
- README.md: esta entrega.

Nenhuma mudança em proposals/c1-c2-transport, nos arquivos anteriores do Agente 2, em main ou outros worktrees.

## Testes

`node --test proposals/rh-local/test-rh.mjs`: 16 aprovados, zero falhas, exit 0. Nove ciclos de cadastro/consulta/filtro/alteração/conflito/exclusão; permissões diretas; idempotência; vínculos; valores inválidos; documentos; duplicação de período; rollback de dado/fila/auditoria; histórico de escala; conflito de horários. SQL boundary é sintética: esses resultados não comprovam persistência PostgreSQL, concorrência real, sessões HTTP ou navegador.

`node proposals/rh-local/test-postgres.mjs`: BLOCKED, exit 2. Não há configuração RUY_RH_ISOLATED_CONFIG nem instância exclusiva disponibilizada ao agente. Nenhuma conexão, migration ou reinício do cluster compartilhado ocorreu. O harness não instala banco nem aplica schema.

Para Agente 1/5: fornecer instância exclusiva de desenvolvimento em 127.0.0.1, porta >=20000 diferente de 55432, banco vazio pré-provisionado `ruy_local_test_agent2_rh_<sufixo>`, schema B já aplicado sob autorização própria. Configuração protegida deve conter environment=agent-2-rh-isolated e os parâmetros pg. Executar com RUY_RH_ISOLATED_CONFIG apontando ao arquivo; não imprimir credenciais. O teste recusa tabelas não vazias antes de criar administrador/funcionário exclusivamente sintéticos. Não precisa de service Windows ou servidor HTTP. Preserva banco sintético ao finalizar. Testa CRUD das nove entidades, replay, conflito, tombstones, fila, rollback e reconexão; não reinicia servidor/cluster. A execução real ainda não foi homologada.

Lint direcionado e git apply --check contra baseline principal aprovados, exit 0. Patch somente validado, não aplicado. Build não executado porque estes arquivos não participam do runtime.

## Integração proposta ao Agente 5

1. Preservar B/C1/C2 e conferir baseline.json. Revisar rh.patch; contém apenas novo guard, import/chamada em core e extensão da allowlist localEntities. base44Client principal já consulta essa allowlist e não precisa ser substituído.
2. Coordenar com o patch aprovado de transporte: rh.patch altera somente allowlist, não substitui os métodos. Testes sintéticos desta entrega também exercitam as melhorias aprovadas em memória. Não copiar fachadas do Agente 2 sobre o principal.
3. Validar RH em PostgreSQL exclusivo e API HTTP C1 real antes de habilitar telas. Toda escrita passa pelo guard dentro da transação; não usar guard separado do mutate nem depender apenas de frontend.
4. Integrar abas de LocalEmployeeDetail por entidade. A ficha antiga também acessa Consumption e outros contratos fora desta lista: não montá-la indiscriminadamente. Remover auditoria duplicada de frontend apenas no ramo local, preservar cloud.
5. Formulários locais precisam enviar _localVersion na edição e baseVersion/EXCLUIR na exclusão. Não executar uploads cloud; preservar referências remotas sem abrir arquivos não baixados. Nenhuma tela foi habilitada nesta proposta.

## Pendências e riscos

Documentos implementados somente como metadados. Anexos e comprovantes novos bloqueados (501) até serviço central validado; referências antigas inalteradas são preservadas, não baixadas nem declaradas disponíveis. Pagamentos são registros RH: não há baixa bancária, caixa, desconto automático de vales ou transação financeira integrada. Qualquer fluxo composto continua bloqueado para operação real até comando atômico específico.

Substituição de escala existente usa duas escritas e troca employee_id; esta proposta bloqueia a reatribuição silenciosa. Marcar falta + alterar escala, gerar/duplicar semanas e salvar vários dias também exigem comandos atômicos próprios. Não permitir sequências parciais na futura integração.

Regra proposta de pagamento exige bruto − desconto = líquido em centavos; a tela antiga permite edição manual dos campos. Agente 5 deve validar esta restrição antes de habilitar o formulário, sem transformar registros históricos. Números monetários grandes/mais de duas casas são rejeitados, sem arredondamento silencioso. Valores/metadados legados não presentes não são inventados. IDs/datas/relações persistem; registros ausentes não viram dados remotos recuperados.

Sem homologação visual, recuperação de histórico, importação de dados reais, backup completo ou sincronização. Contratos implementados em proposta isolada não significam que a aplicação principal já possui ficha RH completa.
