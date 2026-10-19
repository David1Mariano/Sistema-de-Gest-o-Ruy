# Etapa 4 — Delivery integrado em laboratório

19/10/2026. Branch `agente-5-auditoria-integracao-20261019`, worktree exclusivo `gestao-ruy-integracao-auditoria-20261019`, base local/remota confirmada `69c6981`, checkout inicialmente limpo. Fontes A1 `b29d543` e A2 `c53b7a1`. Somente Etapa 4; não houve consolidação final/Etapa 5, instalador novo, deploy ou ativação operacional.

## Comparação e aproveitamento

| Recurso | Decisão | Entrega |
| --- | --- | --- |
| Painel de pedidos A1/A2 | ADAPTAR | Consulta SQL pela fachada D1; busca, estados, edição dos pedidos novos e cancelamento com motivo. Sem seed React autoritativo. |
| Atendimento/conversas A2 | PENDENTE | Não importados cloud, IA, mensagens ou escopos externos. A tela informa bloqueio. |
| Clientes A1/A2 | ADAPTAR | Cadastro sintético mínimo com status; sem contatos/documentos/endereço. |
| Cardápio e entregadores A1 | ADAPTAR | Cadastros D1 versionados, inativação e referências verificadas pelo servidor. Preço vem do cardápio; entrega exige entregador previamente escolhido neste laboratório. |
| Estados A2 | APROVEITAR | placed → confirmed → preparing → ready → dispatched → concluded; pickup/local concluem sem dispatched. Cancelamento permitido antes de conclusão. |
| Estado recebido A1 como sinal financeiro | REJEITAR | Pedido concluído continua unpaid. Estado desconhecido do provider não avança pedido. |
| Cancelamento | ADAPTAR | Transacional, motivado, auditável e idempotente, sem movimentar dinheiro ou estoque. |
| Pagamentos/reembolsos e financeiro Delivery | PENDENTE | Integração específica interrompida por depender de mudanças no financeiro central. Nenhum pagamento/reembolso implementado. |
| Indicadores/relatórios/CSV A1/A2 | ADAPTAR | Valores estimados de pedidos concluídos, sem recebimento presumido; deduplicação por UUID e CSV autenticado de campos tipados. |
| Criação separada pedido/itens/auditoria A1 | REJEITAR | Um único agregado JSON na transação domainCommand já existente, junto com outbox e auditoria SQL. |
| Idempotência e concorrência RC3 | JÁ EXISTENTE | Reutilizados UUID/hash/CAS, advisory lock, recibos centrais e reconciliação com arquivo da proposta. Sem segundo ledger/fila. |
| Conectores demonstrativos A1 | ADAPTAR contrato, execução REJEITADA | Manifesto bloqueado, conversão food99 → 99food e modalidades próprias explícitas. Zero chamadas externas. |
| Edge Functions, migrations Supabase, login/seleção paralela A2 | REJEITAR | Sessão SQL, CSRF, transporte D1 e mTLS preservados. |

Auditoria e plano prévios: [matriz A1/A2](etapa4-auditoria-plano-delivery-20261019.md). Histórico de validação incremental: [resultados por lote](etapa4-resultados-lotes-20261019.md).

## Contrato efetivamente implementado

`DeliveryOrder`, `DeliveryCustomer`, `DeliveryMenuItem` e `DeliveryDriver` são documentos da mesma fachada `/api/d1/domain/*`. Pedido e seus até dez itens compõem um snapshot, não gravações independentes. O UUID do pedido identifica a criação; operationId + hash identificam cada intenção. Reenvio conhecido devolve o resultado original e versão antiga não sobrescreve atualização concorrente. O formulário preserva a tentativa desconhecida no mecanismo D1 existente; falha apenas de consulta após gravação confirmada não instrui repetir a gravação.

Centavos e milésimos inteiros, cálculo BigInt e half-up por linha. O servidor resolve nome/preço do cardápio, recalcula bruto/total/líquido e valida desconto/taxas não negativos. Transição não permite alterar itens ou valores. Após avançar, o pedido não admite edição livre; cancelamento após conclusão é recusado. Apenas canal próprio é criável; ifood/99food/WhatsApp permanecem sem importação ou envio.

Autorização conservadora: admin ativo no servidor, owner local e workspace central. Nenhuma nova função de atendimento/cozinha foi concedida. Na central, um envelope Delivery contém um único agregado, sem misturar uma movimentação financeira/estoque. Comandos usam outbox, audit e recibos RC3. Reconciliação arquiva a proposta e requer decisão explícita; não há mescla automática que descarte alterações.

Gate fechado por padrão: `RUY_D1_ALLOW_TESTS=1`, `RUY_D1_DELIVERY_LAB=1`, fixture `e5aaec701010f607`, porta SQL **55437** e banco `ruy_d1_rc_<16hex>`. Local e central conferem o destino SQL; flags sozinhas não autorizam portas 55435/55436 ou banco existente. O status também exige schema do fixture. `operationalSyncEnabled=false` em todos os resultados. `delivery.sql` só é aplicado pelo teste em bancos novos, recusa outros nomes e não é migration automática.

Clientes, menu e entregadores usam save/CAS e inativação, sem exclusão física. Atualizar preço não reescreve pedidos avançados. Referência inativa impede novos pedidos ou expedição. Atualizações de peers antigos precisam revisão/homologação: uma RC3 sem os novos tipos não reconhece esses documentos; não misturar versões em uso operacional.

CSV: GET `/api/d1/delivery/report.csv`, sessão/admin/gate revalidados, no-store/nosniff e download forçado. Exporta somente UUID do pedido, data, canal, status e centavos; não exporta cliente/entregador, itens, observações, mensagens ou contatos. Sem URL pública, bearer em query ou blob liberado no Electron. A allowlist de download ganhou somente esse caminho exato no mesmo loopback, sem parâmetros/fragmento. Os indicadores da tela aplicam filtros; o CSV identifica explicitamente a exportação de todos os pedidos visíveis ao usuário.

## Matriz de homologação desta etapa

| Fluxo | Resultado | Evidência |
| --- | --- | --- |
| Criar pedido e alterar itens | APROVADO | API real e Electron real; snapshot agregado, preços autoritativos, itens estáveis e versão CAS. |
| Estados pickup e entrega | APROVADO | API percorre modalidades; Electron conclui pickup. Dispatch exige entregador ativo. |
| Cancelamento | APROVADO | API, replay e tela Electron, motivo preservado; sem reembolso implícito. |
| Idempotência/concorrência | APROVADO | UUID repetido/collision, edições simultâneas e dois D1 simulados com conflito preservado. |
| Falha intermediária/rollback | APROVADO | Falha após gravação do agregado, outbox e auditoria reverte snapshot completo. |
| Offline/ACK perdido/reconciliação | APROVADO em simulação | Falha injetada; HTTP e PostgreSQL reais. Aceite central explícito arquiva proposta e invalida replay retirado. |
| Permissões/gate | APROVADO | Viewer, versão antiga e gate desativado recusados; teste unitário de destino recusa portas compartilhadas/banco fora do fixture sem conectar a eles. |
| Valores e isolamento financeiro | APROVADO no escopo unpaid | Dinheiro inteiro, pedido editado Windows R$39,38, totais adulterados recusados, zero efeitos nos ledgers existentes. Isso não comprova pagamentos/liquidações. |
| Persistência/backup | APROVADO | API reinicia normalmente com novo PID e sessão/pedido/itens/fila preservados; dump cifrado/restauração em banco novo compara snapshots. |
| CSV sem dados pessoais | APROVADO na API | Seis verificações HTTP reais: sessão, admin, expiração, headers, centavos e whitelist. Clique/download no instalador ainda depende de homologação empacotada. |
| Etapa 1 | APROVADO | Oito cenários SQL/API de sessão/CSRF/permissão/replay e regressões de transporte reexecutados. |
| Etapa 2 | APROVADO | 16 cenários SQL reexecutados, incluindo estorno, concorrência, backup e restart normal do clone. |
| Etapa 3 | APROVADO | 14 cenários SQL/HTTP/mTLS de anexos reexecutados, com TTL, corrupção, revogação, reinício e restauração. |
| Instalador/segundo Windows/rede física | PENDENTE | Electron usado é real, mas `packaged=false`, em um único Pichau; não valida instalação limpa, segundo computador ou desconexão física. |
| Providers, mensagens, pagamentos e reembolsos | PENDENTE/BLOQUEADOS | Não ativados nem declarados integrados. |

Resultado final: **17 cenários Delivery aprovados** (incluem Electron e seis verificações CSV), **108/108 testes Node**, com **121/121** verificações internas de estoque. Lint e builds web/D1 aprovados. Avisos de build de chunks grandes/Browserslist não exigiram dependências novas. Evidências sanitizadas e hashes de logs/imagem: [JSON](evidencias/agente5-integracao-etapa4-20261019.json).

## Evidência Windows e falhas corrigidas

O teste automatizado usa Electron já instalado, janela oculta 1280×900, segurança da web/sandbox/context isolation mantidas e perfil privado temporário. Opera os formulários reais, verifica estados no DOM e registros SQL; imagem foi inspecionada como evidência de layout. Os estados e totais finais são comprovados pelo DOM e SQL, não pelo frame da janela oculta. A renderização SSR e teste do adaptador são verificações adicionais, não substitutos desse ensaio. Não foi gerado instalador nem usado perfil pessoal de navegador.

Foram detectadas falhas do harness (entrada stdin vazia, inicialização assíncrona e necessidade de controle de timeout). O primeiro Electron de teste, **PID 28952**, foi encerrado apenas após autorização específica do usuário e nova conferência de identidade; não foram alvo API18080 ou PostgreSQL. Um teste posterior foi encerrado normalmente via app.quit após verificar o PID. O harness final possui watchdog e sinal privado de parada normal, sem kill.

O ensaio visual também encontrou defeito do produto: callbacks de save retornavam undefined e o formulário permanecia em edição após confirmação, impedindo criar o segundo pedido. Corrigido retorno de sucesso; o ensaio passou por criação, edição, conclusão e cancelamento de um segundo pedido. Os testes iniciais falhos não contam como aprovação; nenhum cenário final ficou reprovado.

## Financeiro: impacto antes de prosseguir

Não se alterou `business.mjs`, ledger, pagamentos ou DeliverySettlement. A futura vinculação pedido → recebível → liquidação exige contrato de obrigação única por pedido/provider, permissões, CAS e rollback composto; cancelamento/reembolso exigirá estorno idempotente e trilha de auditoria. Essa integração específica foi interrompida conforme a autorização recebida. Os valores de relatório são estimativas de venda, não caixa ou confirmação distribuída de pagamento. É necessária revisão e autorização próprias antes de implementar esses efeitos centrais.

## Git, arquivos e preservação

Commits por finalidade: `2d1ecf0` contrato/auditoria; `a0fda50` agregado/outbox/C2; `81b82d7` cadastros; `a3841f6` tela D1; `6caf2d1` relatórios/CSV; `8ec3e47` conectores bloqueados; `98d01ad` retorno do formulário, isolamento SQL e ensaio Electron. O último commit documental registra esta entrega; seu hash final consta da resposta e do Git.

Arquivos modificados completos constam do JSON e de `git diff --name-only 69c6981..HEAD`. Principais grupos: contratos/domínio/relatório/conectores Delivery em `server/d1-lab/`; adaptação restrita de `domain.mjs`, `domain-contract.mjs`, `api.mjs`, `server/sync-lab/d1-central.mjs`; tela/rota/topbar em `lab/d1/`; política exata e smoke em `desktop/`; testes isolados e documentação. Nenhuma alteração em `src/`, fachada operacional, schemas operacionais, mTLS/autenticação existentes, código de produção ou worktree original.

Dez hashes WIP Etapa A comparados com a auditoria e idênticos; HEAD original db99024 preservado. Produção8080, API antiga18080, Supabase e branches originais não foram alterados. Dumps, perfis, chaves sintéticas, credenciais, bancos e instaladores não foram versionados. Verificação de segredos/artefatos precede cada commit; remoto conferido antes do push exclusivo, sem força.

## Reprodução restrita

No Pichau autorizado com clone já existente, sem iniciar outra instância nas portas ocupadas:

```powershell
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_RESTART_FIXTURE='e5aaec701010f607'
$env:RUY_D1_DELIVERY_LAB='1'
$env:RUY_D1_DELIVERY_UI='1'
npx --no-install vite build --config lab/d1/vite.config.mjs
node scripts/d1-lab/run-integration-stage4-isolated.mjs
```

O smoke opcional requer o Electron existente no caminho explícito do harness; não instala dependências. O runner verifica PGDATA, portas, cria bancos novos e encerra normalmente apenas seus processos/clone. `stop-electron` dentro do perfil privado do fixture solicita app.quit; watchdog final encerra o próprio ensaio normalmente. Os harnesses das Etapas 1–3 devem ser executados sequencialmente, com DELIVERY_LAB removida para testar o padrão fechado. Não executar estes comandos em instalação operacional.

Delivery funcional em laboratório, com uso operacional bloqueado. Pendentes: financeiro externo/central, providers e atendimento, políticas por papel/loja, homologação empacotada em dois Windows, rede real, proteção/retenção/auditoria e aprovação operacional. **Etapa 5 não iniciada.**
