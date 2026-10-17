# RC3 — pendências da RC2

Base c8beb17, branch agente-5-consolidacao-windows-d1-c2-20261016. Candidata 0.5.1-rc.3 / A5-RC3-20261017, restrita à homologação assistida. **Não é liberação operacional.** As evidências desta rodada estão no [manifesto](evidencias/agente5-rc3-20261017.json); este documento substitui o estado dos contratos de reconciliação, contas próprias, estornos e produção da RC2.

## Matriz

| Ensaio | Resultado | Alcance comprovado |
| --- | --- | --- |
| Edições concorrentes D1/C2 | APROVADO no laboratório | Propostas preservadas; plano desatualizado recusado; nova edição sobre CAS atual converge. |
| Retirada explícita de propostas | APROVADO no laboratório | Estado local, propostas e razão arquivados antes da substituição das projeções; outbox e auditoria originais preservadas. Inclui edições dependentes nunca enviadas. |
| Proteção contra atualização perdida | APROVADO no laboratório | Versão local aumenta após revisão; formulário antigo e replay de UUID retirado são recusados. Recibo incerto não é descartado: deve ser reenviado antes da revisão. |
| Conflito de estoque | APROVADO com clientes SQL simulados | Projeção provisória arquivada e saldo central restaurado após decisão explícita; sem segundo consumo. |
| Contas financeiras próprias | APROVADO no laboratório | FinancialAccount mapeia account:UUID; journal balanceado/versionado, conta ativa e saldo projetado nos peers. Saldos informativos enviados pelo formulário não movimentam dinheiro. |
| Confirmação concorrente e duplicidades | APROVADO no laboratório | Sem saldo negativo na corrida de duas despesas; replay, folha, título e nota do fornecedor protegidos pelas chaves de obrigação. |
| Estorno financeiro | APROVADO no escopo testado | Documento cancelado e compensação exata do lançamento original no mesmo envelope; motivo e vínculo únicos; replay não compensa duas vezes e liquidação estornada não pode reabrir. Teste distribuído cobre despesa em conta própria. |
| Produção, perdas e consumo | APROVADO no laboratório | Perdas detalhadas obrigatórias; consumo calculado sobre quantidade bruta produzida e ficha congelada. Quantidade adulterada reverte documento, saldo, cursor e recibo. |
| Ordem e confirmação de produção | APROVADO no laboratório | Rascunho deixa ordem em_producao com produzido zero; confirmação conclui ordem e consome estoque no mesmo envelope. Cancelamento cancela ordem e estorna consumo uma vez. |
| Interface Windows | APROVADO em Pichau conforme JSON final | Estorno pela tela Contas e estornos; comparação e aceite em Conflitos, arquivo preservado e versão antiga invalidada. Inclui regressão de login, colaboradores, estoque, produção, financeiro e anexos. Execução empacotada identificada por packaged=true no manifesto. |
| Serviço central sem owner | APROVADO no banco sintético novo | Login real NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS; processa novos contratos, mas não altera principals, histórico/recibos nem schema. |
| Autenticação e transporte | APROVADO em loopback | Sessão/CSRF, admin ativo, token/workspace, mTLS 1.3; certificado ausente, CA incorreta e token divergente recusados. Vínculos duplicados de certificado/token recusados antes de escutar. |
| Persistência e backup | APROVADO exclusivamente no fixture 55437 | Sete bancos locais novos; digest antes/depois do reinício controlado idêntico. Dumps cifrados restaurados em destinos novos preservam contas, lançamentos, estornos e arquivos de reconciliação, além de anexos/filas. |
| Regressões | APROVADO | 70 testes automatizados, estoque 121/121 dentro da suíte; 68 regressões financeiras; 33 cenários integrados; sete de transporte; 11 de compatibilidade e cinco de supervisão. Não somar essas contagens como casos independentes. |
| API antiga 18080 | PENDENTE de parada autorizada | PID 22292 preservado; origem identificada, procedimento preparado. Nenhum sinal enviado nem substituição realizada. |
| VM Windows limpa | PENDENTE | HypervisorPresent=false; ferramentas Hyper-V/VirtualBox/VMware não localizadas nas verificações realizadas. Nenhuma VM isolada autorizada identificada; não se declara teste de instalação/reinstalação/restore em VM. |
| Dois Windows físicos e rede | PENDENTE | Segunda máquina não identificada/autorizada; somente Pichau. Rede da empresa intacta; queda/reconexão foi simulada pelo serviço TLS pertencente ao teste. |

Nenhum cenário permaneceu REPROVADO ao final das suítes citadas. Recusas de versão, permissão, adulteração, duplicidade e falta de saldo são resultados esperados dos testes negativos. Itens sem ambiente/autorização são PENDENTES, não aprovados por simulação.

## Contratos e limites

Reconciliação exige admin ativo, opt-in de laboratório, snapshot central completo e hash do plano atual. A decisão disponível é **aceitar a central e arquivar todas as propostas indicadas**; não existe merge automático por horário nem opção de forçar pagamento/estoque rejeitado. Campos que o operador quiser manter devem ser reaplicados sobre as versões atuais. Operações pending/sending com envelope já enviado não são retiradas sem esclarecer o recibo. Uma tentativa retirada permanece na outbox, mas não volta a ser aceita por replay.

O arquivo d1_reconciliation contém o estado anterior e as propostas. d1_sync_queue marca resolved com decisão auditada; não forja ACK ou confirmação de negócio. Somente projeções locais são substituídas depois de gravar o arquivo na mesma transação. Uma falha de integridade ou permissão reverte toda a decisão. Em ambientes com filas grandes, limitar e revisar o plano antes de aceitar; o endpoint mantém os limites de resposta do transporte de laboratório.

Contas próprias usam identificador imutável no ledger. Saldo vem dos lançamentos, não de FinancialAccount.current_balance. Abertura/movimentação por journal exige contrapartida, versões e autorização admin no laboratório. Isso não executa pagamento bancário externo. Estorno usa exclusivamente movimentos/partidas originais; não aceita valores fornecidos pelo formulário como fonte. Precisa de saldo/estoque e versões suficientes; não há saldo negativo ou exclusão do lançamento original. Estornar um estorno e reabrir documento liquidado estornado são recusados.

O comando também prepara cancelamentos vinculados de pagamento/título/recebível simples, mas a nova prova distribuída de estorno desta rodada cobre **despesa independente em conta própria**. Estornos com descontos de vales/consumo RH permanecem recusados até existir a liberação atômica desses vínculos. Não se homologa todo o financeiro por extensão do teste da despesa independente. Deduplicação sem uma chave comum não reconhece semanticamente toda despesa manual parecida; intervalos salariais sobrepostos também exigem política adicional.

Na produção, perdas fazem parte da quantidade bruta e não provocam uma segunda baixa dos mesmos insumos. A ficha e o rendimento são congelados no rascunho; a central verifica o consumo, a precisão e os vínculos. Uma ordem não pode ser vinculada a dois diários ativos no workspace. Mudança de unidade após movimentos continua recusada. O cancelamento restaura o consumo original; entrada de produto acabado em estoque não é inferida automaticamente do diário. Conversões de unidade, aproveitamento de sobras e custeio contábil completo continuam fora deste aceite.

A API de laboratório continua manual e loopback; operationalSyncEnabled=false. Não há migração automática de banco RC2 existente para os schemas RC3. Os SQL e fixtures só foram aplicados em bancos novos marcados como sintéticos e, de forma aditiva, na cópia descartável 55437 conferida por marcador/PGDATA. Não executar esses scripts em banco operacional nem tentar ativar a função alterando flags em uma instalação em uso.

O serviço central restrito foi validado por conexão independente, não por SET ROLE mantendo owner. O papel local usado no aplicativo ainda requer aceite de isolamento por usuário no banco e da separação entre provisionamento, backup e execução; a preparação de reconciliação concede DELETE apenas nas projeções da cópia descartável, nunca na outbox/auditoria. A aplicação restringe ator/workspace em cada comando; não se declara homologação final de defesa por RLS, rotação de certificados ou distribuição de chaves em máquinas reais. Não disponibilizar o banco diretamente aos usuários.

## Pendências para liberação

1. **Crítico:** identificar Windows B ou VM isolada autorizada; validar instalação limpa, reboot, reinstalação, restauração com chaves/identidade próprias e persistência. Não copiar DPAPI de Pichau.
2. **Crítico:** homologar transporte autorizado entre dois Windows, certificados próprios/expiração/revogação/rotação e reconexão real na janela aprovada. Loopback permanece padrão; PostgreSQL e portas internas não são publicados.
3. **Alto:** completar os aceites financeiros vinculados, especialmente reversão de descontos RH, contas/abertura sob o papel final local e regras de obrigações sem chave única. Validar operador, permissões e proteção por ator no ambiente final.
4. **Alto:** executar a parada normal autorizada da API antiga e a troca supervisionada. [Procedimento seguro](agente-5-api-antiga-encerramento-normal.md); nenhum encerramento foi tentado.
5. **Crítico:** aceite operacional explícito, política de assinatura/distribuição e matriz física completa. O instalador não assinado continua restrito à homologação.

## Repetição e entrega

Executar as suítes de servidor sequencialmente; compartilham 18091/18092/18094/18443. Usar RUY_D1_ALLOW_TESTS=1. Para test-agente5-rc3-postgres.mjs e test-agente5-rc3-windows.mjs, também RUY_D1_RESTART_FIXTURE=e5aaec701010f607; ambos recusam a porta 55437 ocupada, conferem PGDATA e param normalmente somente a cópia. O teste PostgreSQL inclui integração e restauração. Para o teste Windows empacotado, RUY_A5_RC3_EXECUTABLE aponta ao executável RC3 desempacotado. test-agente5-rc3-artifact.mjs confere ASAR, dependências, ausência de arquivos privados e hash do instalador.

Build padrão: npm run build; cliente D1: npx vite build --config lab/d1/vite.config.mjs; lint: npm run lint. Instalador: electron-builder com desktop/electron-builder-agente5-rc3.cjs, somente depois das correções aprovadas. Artefatos, logs privados, backups, certificados e credenciais ficam fora do Git.

[Instalação RC3](agente-5-rc3-instalacao.md) · [Dois Windows físicos](agente-5-roteiro-dois-windows.md). Produção 8080, API antiga, Supabase e dados reais preservados. Sem merge, deploy ou sincronização operacional.
