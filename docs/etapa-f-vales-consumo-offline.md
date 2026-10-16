# Etapa F — Vales e Consumo offline

16/10/2026. Branch `preparacao/windows-oficial-20261015`, HEAD preservado `8da0eb0`.
Somente PostgreSQL D1/C2 sintético. Nenhum commit/push, merge, deploy ou instalação.

## Implementação

As rotas `/vales` e `/consumo` reutilizam páginas e formulários oficiais, com
cópias adaptadas e aliases exclusivos de `lab/d1/`. Campos, filtros, tabelas,
resumos e classes de layout foram mantidos. Cancelados permanecem na tabela e
histórico, mas não nos totais ativos. O formulário acrescenta histórico e seleção
da folha quando solicitado desconto. Nenhum arquivo de `src/` foi alterado.

- Cadastro, consulta, edição autorizada e cancelamento lógico em PostgreSQL.
- UUID estável, versão CAS, UUID/hash de operação, replay e fila durável D1/C2.
- Nome/setor derivados do colaborador do mesmo usuário, sem aceitar referência
  cruzada. Datas reais, centavos, quantidade positiva e horário validados na API.
- Duplicidade semântica de lançamentos ativos equivalentes recusada sob lock do
  usuário, inclusive quando enviada com outro UUID de operação.
- Documento, vínculo de desconto, histórico, auditoria e outbox na mesma transação.
  Falhas revertem também a alteração do pagamento vinculado.
- `d1_rh_history` preserva snapshots, versão, usuário, dispositivo e operação;
  papel do aplicativo sem UPDATE/DELETE, com recusa verificada no PostgreSQL.
- API exige administrador sintético, sessão/CSRF e isolamento por usuário.
- Retry RH guarda somente metadados e fingerprint SHA-256 no navegador. Após
  falha desconhecida, reconstituir os mesmos campos preserva UUID e intenção.
  PostgreSQL e outbox são a persistência dos documentos.

## Estados e contabilização

| Conceito | Estado oficial | Regra |
|---|---|---|
| Vale concedido/pendente | `pendente` | Registro aguardando desconto; não comprova entrega de dinheiro |
| Vale descontado | `descontado` | Alocação em desconto já registrado na folha do colaborador |
| Vale cancelado | `cancelado` | Histórico preservado e exclusão dos totais ativos |
| Consumo lançado | `registrado` | Registro interno, sem baixa automática de estoque |
| Consumo descontado | `cobrado` | Status oficial mantido; vínculo de desconto de folha |
| Consumo liberado | `liberado` | Dispensa de cobrança, sem pagamento/desconto |
| Consumo cancelado | `cancelado` | Cancelamento lógico preservando histórico |

Primeiro cadastrar pendente/registrado. Para descontar, selecionar EmployeePayment
`pago`, do mesmo colaborador e dispositivo, com desconto suficiente e despesa
agregada consistente. A versão da folha é revalidada; a alocação fica em
`rh_deductions`, na mesma transação do estado RH. Limite: 20 vínculos por folha,
além do limite de tamanho do snapshot. Vale/adiantamento não serve como folha.

O vínculo não soma outro desconto nem cria pagamento/despesa: preserva bruto,
desconto, líquido e FinancialExpense. Exemplo testado: bruto 200, desconto 50,
líquido 150; vale 35,25 + consumo 10,50 mantêm uma despesa de 150. Outro desconto
de 10 é recusado. CAS/lock impedem alocar acima do desconto disponível.
A composição da folha vinculada também fica protegida contra edição por
EmployeePayment ou pela despesa. Pagamento direto tipo `vale` ou com `vale_id`,
inclusive em lote, é recusado para evitar outra despesa pelo caminho não agregado.

Não há transferência bancária, alteração de caixa ou estoque. “Quem autorizou”
é informação documental; a autoria autenticada fica separada na auditoria.
Cancelados/descontados são imutáveis. Estorno de desconto exige fluxo específico
homologado; não há cancelamento silencioso de desconto já vinculado.

## Sincronização e recuperação

Snapshots RH e alocações usam a ponte D1↔C2, com referências e consistência de
descontos verificadas no estado resultante do agregado. O ator do recibo central
é incluído nos eventos e preservado no histórico recebido. ACK perdido mantém
UUID/envelope sem repetir despesa. Dois bancos de dispositivos foram simulados,
sem duas máquinas físicas. Foram confirmados IDs, colaborador, estados, vínculos
e autoria, sem duplicar despesa ou aplicar estoque no destinatário.

Conflito de Vale preservou proposta local e snapshot remoto em `d1_sync_shadow`.
Não há resolução automática/interface de conciliação. Documentos RH recebidos de
outro dispositivo ficam somente para consulta e exigem reconciliação na origem.
Recibo C2 não comprova liquidação financeira. Supabase continua desativado;
nenhuma migration, grant, Auth ou Storage operacional foi alterado.

O teste de persistência compara documentos, histórico, fila e auditoria antes e
depois do reinício real de PostgreSQL/API, com hashes registrados. O backup agora
verifica `d1_rh_history` no manifesto de recuperação: 12 tabelas, restore em banco
novo isolado, sincronização desativada. Destino externo/chave independente ainda
pendentes; isso não protege dados reais operacionalmente.

## Testes e evidências

| Verificação | Resultado |
|---|---|
| Domínio/API RH, PostgreSQL real e guarda externa | 12 cenários aprovados |
| Retry RH sem payload pessoal no navegador | 1 teste aprovado |
| Ponte D1/C2 com RH, conflito e recuperação | 17 cenários aprovados |
| Domínio Produção/Financeiro, reinício e restore | 17 cenários aprovados |
| Pagamentos em lote | 7 cenários aprovados |
| Interface RH em Electron de desenvolvimento | `RH_DESKTOP_OK`: criação, edição, desconto, histórico, cancelamento, filtro, totais, erros, reload e persistência após fechar janela |
| Interface anterior de Produção/Financeiro | `DOMAIN_DESKTOP_OK` |
| Financeiro oficial: estabilidade/integração | 16 + 9 testes aprovados |
| Servidor de produção em fixtures isoladas | 5 testes aprovados; não publica/rollback da produção real |
| Aliases D1 | Aprovados |
| Indicador/criptografia/replay/dump+restore | 8 testes aprovados |
| Lint dos arquivos alterados e diff check | Aprovados |
| Build oficial e D1 | Aprovados, sem publicação |
| Typecheck | 485 diagnósticos existentes; zero novos; exit 2 preservado |

Lint geral tinha erro de parsing em `scripts/security/test-emergency-fix.mjs:41`,
arquivo herdado não rastreado preservado. O gate aprovado é o lint dos arquivos
desta etapa. Nenhuma verificação foi desabilitada. Evidências consolidadas em
`evidencias-etapa-f-windows.json`; logs completos em `logs/`, ignorados pelo Git.

## Arquivos desta etapa

- Backend: `server/d1-lab/{domain-contract.mjs,domain.sql,domain.mjs,rh-domain.mjs,sync.mjs,backup.mjs}` e `server/sync-lab/d1-central.mjs`.
- Integração D1: `lab/d1/{Vales.jsx,Consumo.jsx,ValeForm.jsx,ConsumptionForm.jsx,RhDetails.jsx,domain-client.mjs,main.jsx,vite.config.mjs}`.
- Electron: `desktop/{main.mjs,rh-smoke.mjs}`, acréscimos de ensaio sem instalação.
- Testes: `scripts/d1-lab/{test-rh-offline.mjs,test-rh-client.mjs,test-rh-desktop.mjs,test-sync-bridge.mjs,test-domain.mjs}`.
- Documentação: este relatório, evidências e referência no README.

Alterações anteriores do indicador, documentos/SQL de segurança e demais arquivos
não rastreados foram preservados; não representam trabalho novo desta etapa.

## Reprodução

Somente no laboratório D1/C2 já marcado e preparado:

```powershell
node scripts/d1-lab/prepare-domain.mjs
# Recarregar somente APIs de laboratório se estiverem com código antigo.
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_NETWORK_GUARD='1'
node --require ./scripts/d1-lab/network-guard.cjs scripts/d1-lab/test-rh-offline.mjs
node --require ./scripts/d1-lab/network-guard.cjs --test scripts/d1-lab/test-rh-client.mjs
node --require ./scripts/d1-lab/bridge-network-guard.cjs scripts/d1-lab/test-sync-bridge.mjs
node node_modules/vite/bin/vite.js build --config lab/d1/vite.config.mjs
node scripts/d1-lab/test-rh-desktop.mjs
```

Ensaios que reiniciam serviços devem rodar sequencialmente. Não executar init,
não usar banco operacional e não copiar dados reais.

## Situação Windows e pendências

Contas/papéis continuam sintéticos, sem autorização empresarial offline assinada
e revogação completa. Comprovantes privados, demais rotinas/dashboard completo
de RH, fechamento global, estornos e resolução assistida de conflitos permanecem
pendentes. O próximo ciclo deve priorizar esses agregados e anexos privados.

O app continua experimental. Interface validada em Electron de desenvolvimento
com API local, sem Node no renderer/rede externa; não houve instalação, rebuild
do instalador, Windows limpo, reboot ou aceite visual completo. O instalador
disponível permanece 0.3.0, sem esta etapa embutida.

Produção 8080 saudável antes/depois na release `20261015T155237724Z-d597121d`.
Nenhum dado real foi alterado e nenhum serviço definitivo foi instalado.
