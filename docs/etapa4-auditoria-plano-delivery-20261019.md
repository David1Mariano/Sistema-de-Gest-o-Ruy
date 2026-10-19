# Etapa 4 — auditoria e plano de Delivery

Base local/remota `69c6981`, checkout limpo e WIP Etapa A 10/10 hashes conferidos. Branch exclusiva de integração. Fontes lidas via Git: A1 `b29d543` (entrega, wiring, regras/service/painel) e A2 `c53b7a1` (handoff, CentralDelivery, domínio, atendimento e testes). O A1 não possui docs/handoff-agente-1.md; seu handoff é docs/agente-1-delivery-entrega.md. Sem executar cloud, servidor de produção ou branches originais.

| Recurso | Decisão | Motivo e adaptação |
| --- | --- | --- |
| Painel, filtros e indicadores A1/A2 | ADAPTAR | UI de laboratório consulta SQL D1; React não é autoridade. Preservar distinção venda estimada/caixa. |
| Atendimento/conversas A2 | PENDENTE | Exige provider/escopos e serviços externos. Não fingir entrega de mensagens; painel informa bloqueio. |
| Clientes A1/A2 | ADAPTAR | Cadastros sintéticos mínimos, sem telefone/endereço/documentos; owner local e workspace central. |
| Cardápio e entregadores A1 | ADAPTAR | Catálogos versionados D1, preços em centavos, vínculos e snapshots no servidor. Sem comissões/pagamentos externos. |
| Estados canônicos A2 | APROVEITAR | placed/confirmed/preparing/ready/dispatched/concluded/cancelled; modalidade pickup/local não exige dispatched. Não converter recebido em pagamento. |
| Pedido e itens separados A1 | REJEITAR | Criava pedido, itens e auditoria em requisições diferentes. Usar um snapshot agregado dentro da transação domainCommand existente. |
| Idempotência em memória/consulta prévia | REJEITAR | Reusar outbox/operationId/hash/CAS/recibo SQL RC3, sem cache autoritativo ou novo ledger. UUID do pedido é identidade de criação estável. |
| Relatórios e CSV A1 | ADAPTAR | Exportar somente UUID, data, canal, status e totais numéricos; excluir cliente, mensagens e observações. Sem fórmulas/PII. |
| Dinheiro A1 | ADAPTAR | BigInt no cálculo, centavos e milésimos inteiros, half-up por linha. Não importar percentuais demonstrativos fixos 27%/18%. |
| Financeiro e reembolsos | PENDENTE — integração específica interrompida | RC3 já tem DeliverySettlement/recebíveis; ligar pedidos a liquidação/pagamento exige alterar o financeiro central e a deduplicação por obrigação. Impacto: nova vinculação pedido↔recebível↔liquidação, CAS, estorno e migração/homologação próprias. Não prosseguir sem revisão/autorização. Pedidos desta etapa permanecem unpaid; pagamento/reembolso recusados. Cancelamento sem efeito financeiro é permitido antes de conclusão. |
| Conectores DEMO A1 e cloud/Edge A2 | REJEITAR execução / ADAPTAR contrato | Manifesto canônico own/ifood/99food/whatsapp; food99 mapeado explicitamente, estados desconhecidos retidos/recusados. Nenhuma chamada externa/importação habilitada. |
| Login/seleção de backend A2 | JÁ EXISTENTE / REJEITAR substituição | Manter sessão/CSRF/transporte único D1, sem DeliveryAccess cloud, Supabase ou PGlite paralelos. |
| Estoque/produção automático pelo pedido | REJEITAR nesta etapa | Pedido não baixa estoque nem executa produção implicitamente. Testar que comandos Delivery não alteram os ledgers existentes. |

## Lotes e gates antes de alterar código

A: contrato puro, cálculos, transições, entidades e testes. B: encaixe no domainCommand e acceptD1 existentes; snapshot único pedido+itens, lab_outbox e lab_audit na mesma transação; schema adicional apenas em bancos novos sintéticos; ensaios CAS/rollback/replay/offline/reconciliação. C: cadastros mínimos, vínculo e preço autoritativo do menu. D: interface Windows via cliente D1 existente. E: indicadores e CSV sem PII. F: manifesto e recusa explícita de integrações externas. Commits separados por finalidade, testes específicos e regressões por lote.

Gate obrigatório: Delivery só aceita comandos se ALLOW_TESTS=1, DELIVERY_LAB=1 e clone descartável marcado e5aaec701010f607. Sem flags, continua recusado. Sincronização operacional permanece false. Novos tipos em D1LAB/1/D1BUS/1 não substituem a fachada nem mudam financeiro, estoque ou anexos. Novos schemas não são aplicados automaticamente em instalação existente. Compatibilidade entre versões exige atualizar os dois peers de laboratório antes do ensaio; RC3 antiga não reconhece os novos tipos.

Riscos: validação duplicada apenas nos limites de confiança (local e central), limite 4000 bytes por snapshot, preço/estado divergente em conflito exige reconciliação explícita, relatórios não representam recebimentos. Segunda máquina, Electron instalado, rede física, permissões operacionais e aceites financeiros permanecem pendentes. Nenhuma liberação operacional, deploy ou Etapa 5 autorizada.

Isolamento: todos os bancos e restores em 55437, novos e sintéticos; verificar PGDATA/portas, não conectar 55435/55436, produção8080, API18080 ou Supabase. Nenhuma alteração no worktree original, WIP Etapa A ou branches dos demais agentes.
