# Etapa E — Produção e Financeiro locais

Base: `0e91dc253b9db0d01b8ccdf1f5c7b91d5a2e5ebb`, branch
`preparacao/windows-oficial-20261015`. Apenas laboratório sintético D1/C2.
Produção 8080 e nuvem original não são destinos de escrita.

## Auditoria e matriz de implementação

| Área | Problema encontrado na base | Implementação e prova necessárias |
|---|---|---|
| Ficha técnica | Produto, exclusão e recriação de ingredientes em chamadas independentes | Snapshot atômico versionado com ingredientes; rollback e replay |
| Ordem e diário | Sem adaptador D1; atualização de ordem separada do diário | Referências verificadas, diário com receita congelada e ordem na mesma transação |
| Perdas | Lista detalhada apenas no frontend | Validar quantidades, motivos, responsável e unidade no servidor |
| Consumo | Conferência somente leitura | Prévia calculada pelo servidor, CAS de receita/registro/saldos, confirmação explícita e baixa única |
| Cancelamento | Exclusão física solicitada pela tela | Cancelamento auditado; devolução atômica dos insumos locais; histórico preservado |
| Gastos | Compensação entre gasto e pagamento, sem transação comum | Agregado D1 com vínculo e idempotência; não executar pagamento externo |
| Pagamentos | Várias chamadas por pessoa/lote | Comando agregado; bloquear caminhos não portados antes da primeira escrita |
| Receitas/contas | Sem adaptador local | Persistência em centavos e permissões; relações agregadas antes de liberar quitação |
| Caixa/sangria/fechamento | Dados calculados no cliente | Persistência versionada, recomputação e unicidade; distinguir documento de saldo contábil |
| Relatórios | Fontes sem implementação offline | Leitura local real e falha explícita para fonte ainda não portada |
| C2 | Conhece cadastros e eventos, sem documentos de domínio | Snapshots versionados, conflitos/reenvio; não reaplicar movimento ao receber |
| TypeScript | 1.442 diagnósticos na base | Corrigir grupos com tipagem real; manter checkJs e registrar saldo restante |

## Implementação entregue

O contrato `domain` mantém snapshots versionados em `d2_catalog`, sem importar
dados da aplicação operacional. A extensão do CHECK é aplicada exclusivamente
por `prepare-domain.mjs`, que usa a configuração D1 marcada. Nenhuma tabela ou
linha existente é apagada. Todo comando usa UUID/hash, CAS, autorização no
servidor e transação incluindo documento, vínculos, outbox e auditoria.

| Módulo | Integrado nesta etapa | Evidência e limite |
|---|---|---|
| Produção | Tela original, ficha e ingredientes atômicos, ordens, diário editável antes da confirmação, perdas detalhadas, consulta, prévia do servidor, confirmação e cancelamento com devolução | API/PostgreSQL e formulários Electron. Receita fica congelada no diário. Consumo usa quantidade produzida total, incluindo perdas dentro desse total; não soma as perdas novamente. Conversões de unidade ou frações menores que 0,001 exigem revisão explícita |
| Gastos | Formulário original, centavos, consulta/edição e pagamento vinculado ao colaborador no mesmo commit | API com rollback real e formulário Electron. Não executa saída bancária, caixa ou estoque. Exclusão pela tela continua bloqueada até homologar cancelamento financeiro completo |
| Pagamentos | Cadastro/edição individual e despesa vinculada atômicos | API; lote é recusado antes da primeira escrita. Valores líquidos/brutos/descontos validados. Comprovantes privados e pagamento externo não integrados |
| Contas a pagar | Cadastro/edição pendente, quitação documental e despesa vinculada atômicas | API com replay e prevenção de quitação dupla. Estorno de conta quitada bloqueado |
| Receitas e recebíveis | Tela original, receita manual, conta a receber, cartão/delivery com título vinculado, recebimento e cancelamento de título pendente com origem no mesmo commit | API e formulários de receita/cartão/recebimento Electron. Registrar recebido não comprova liquidação externa. Estorno de título já recebido bloqueado |
| Caixa/sangria/fechamento de caixa | Persistência versionada, cálculo no servidor e unicidade de data/caixa/turno | API. Documentos de conferência separados do razão contábil; exclusão física recusada |
| Recorrência/conferência manual/rodízio | Cadastro local, geração atômica de conta e avanço do vencimento, diferença recalculada | API. Não gera títulos automaticamente por agendamento |
| Relatório Financeiro | Tela original lendo fontes locais, resumo de receita manual e despesas verificado no Electron | Não é aceite de todos os indicadores, impressões, exportações ou conciliação global. Fontes RH não portadas retornam erro explícito |
| Estoque/Colaboradores/Setores/Funções | Contratos anteriores preservados; subscriptions locais acrescentadas | Regressões D1/D1.1, cadastros, Estoque e 773 testes oficiais |
| D1↔C2 | Snapshots de domínio e cascatas, conflitos e reenvios | Dois bancos de dispositivos, central HTTP, recibos e crash/reinício reais. Receber snapshot nunca reaplica baixa nem pagamento. Baixa originada em outro dispositivo não pode ser cancelada localmente |

O indicador de sincronização soma documentos financeiros pagos/recebidos às
pendências de negócio. ACK de transporte não representa confirmação financeira.
Não existe rotina de conciliação global que promova essas pendências silenciosamente.

## Persistência e qualidade

Evidências estruturadas: [`evidencias-etapa-e-windows.json`](evidencias-etapa-e-windows.json).
Os testes usam somente contas e dados fictícios. O ensaio reinicia de fato
PostgreSQL/API D1, compara documentos, perdas, fila, movimentos e saldos e
restaura backup AES-GCM em banco novo. Agora o manifesto verifica também
`d2_catalog` (11 tabelas); arquivos antigos continuam verificando as tabelas
declaradas no próprio manifesto. O restore não ativa banco nem sincronização.

Correções TypeScript por grupos: propriedades nativas e refs em Button/Input/
Textarea/Card; contratos Radix de Dialog/Label/Select/Tabs; opções e estados de
rascunhos; campos do formulário de Receitas. `checkJs`, escopo do projeto e
verificações permanecem habilitados. De 1.442 diagnósticos na base para **485**
nesta etapa (957 a menos); typecheck ainda termina com exit 2.

O pacote 0.3.0 é experimental, sem assinatura e exige laboratório previamente
preparado. O teste de atualização/desinstalação/reinstalação registrado na etapa
0.2 não é reapresentado como teste da 0.3. Não houve reboot do Windows, instalação
em Windows limpo, teste em duas máquinas físicas ou homologação visual completa.

## Pendências para operação real

1. Integrar vales e consumo de colaboradores/RH, pagamento em lote, fechamento
   financeiro global e trilha visual completa de auditoria. Essas escritas ficam
   bloqueadas: dependem de agregados próprios, não de chamadas parciais.
2. Homologar estornos de contas quitadas e títulos recebidos, exclusão/cancelamento
   financeiro completo, conciliação contábil, DRE/fluxo/relatórios com dados reais
   de referência e todos os caminhos das telas. API testada não equivale a cada
   variante da interface aprovada.
3. Definir autoridade global, reservas/cotas e resolução assistida de conflitos;
   reconciliação entre dispositivos permanece pendente. Não foi conectado Supabase.
4. Homologar papéis empresariais e autorização offline assinada com expiração e
   revogação. Este piloto aceita apenas administrador sintético para operações.
5. Implementar anexos privados e validar RLS/grants/Auth/Storage antes de autorizar
   conexão à nuvem original. Nenhuma migration de nuvem foi executada.
6. Finalizar cópia externa e custódia da chave; ensaiar restauração em outro Windows,
   volume real, retenção, RPO/RTO e reconciliação após recuperação.
7. Resolver os 485 diagnósticos TypeScript restantes; testar PostgreSQL no instalador,
   assinatura, Windows limpo, reboot, atualização interrompida, reinstalação 0.3,
   duas máquinas físicas, impressão/exportação e obter aceite por módulo.

O aplicativo **não está liberado para uso diário**. Produção 8080 preservada.

## Reproduzir os testes novos

Com D1/C2 sintéticos preparados, na raiz do checkout:

```powershell
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_NETWORK_GUARD='1'
node --require ./scripts/d1-lab/network-guard.cjs scripts/d1-lab/test-domain.mjs
node --require ./scripts/d1-lab/bridge-network-guard.cjs scripts/d1-lab/test-sync-bridge.mjs
node scripts/d1-lab/test-domain-desktop.mjs
```

Os dois primeiros reiniciam exclusivamente serviços de laboratório; não executar
simultaneamente com outro ensaio que dependa da mesma API. O último abre um
renderer Electron oculto, usa conta sintética própria e confere os registros após
fechar a janela. `--packaged` exige pacote previamente construído e API D1 parada
para comprovar que a API empacotada é iniciada e encerrada pelo aplicativo.

Cada escrita mantém evento e outbox. Os testes preservam os bancos sintéticos
para inspeção e não servem como ferramenta de limpeza ou migração operacional.
