# Windows 0.2.0 — preparação de homologação

Não liberado para uso diário. Todos os testes de escrita usam dados sintéticos
em clusters marcados; não houve alteração da produção 8080, do Supabase original,
DNS, firewall público ou instalação de serviço permanente.

## O que mudou

- A fila append-only D1 agora se conecta ao C2 por protocolo `D1LAB/1`: entidades
  reais dos cadastros, cascatas atômicas, versões locais/remotas separadas, recibos,
  inbox/cursor, lease, deduplicação e shadow de conflitos. Sidecar registra estados
  sem reescrever/apagar a outbox ou auditoria original.
- O servidor central de testes autentica usuário/dispositivo/workspace e rejeita
  token/identidade inválidos. A ponte deste piloto é admin sintético, com DPAPI
  por usuário; provisionamento explícito e envio por ação do usuário/CLI.
- API autenticada D1 para estoque, produção e partidas financeiras: saldos/limites,
  movimentos, centavos, versões, evento, outbox e auditoria na mesma transação.
  Cadastro de item com entrada inicial também é transacional e idempotente.
- A tela oficial Estoque é reaproveitada no build D1 para criar, consultar e ajustar
  saldo local. Exclusão/reativação permanecem bloqueadas até homologar dependências.
- Eventos críticos são entregues ao C2 e recebidos por outro banco sem executar
  novamente pagamentos ou movimentos. Recibo de entrega não confirma negócio:
  `businessConfirmed=false` e `externalConfirmed=false`, com pendência de reconciliação
  visível. Não foi criada regra de conciliação global silenciosa.
- Backup criptografado agora compara também dez tabelas de sincronização e
  operações, incluindo recibos, cursores, lançamentos e saldos após restore.
- PostgreSQL de laboratório e criação explícita de administrador fictício possuem
  roteiro para máquina nova e bootstrap que recusa diretórios existentes.

## Testes com evidência real

- Suíte oficial: 773 testes aprovados. Lint, build oficial e build D1 aprovados.
- TypeScript: 1.442 diagnósticos existentes, exit 2; nenhum arquivo `src/` alterado.
- Ponte D1/C2: 14 verificações PostgreSQL/HTTP, dois bancos de dispositivos,
  sete cadastros, cascata, ACK perdido, recibo adulterado, conflito, isolamento,
  crash real do worker após recibo, reinício PostgreSQL/API e retomada por lease.
- Persistência operacional: oito verificações de criação/baixa/concorrência,
  produção, rollback completo, centavos/partidas, permissão e reinício. Dump/restore
  validou dez tabelas de recuperação em banco novo, sem habilitar sincronização.
- Bootstrap: ambiente existente recusado, marcador preservado, admin criado por
  stdin sem expor senha; tentativa duplicada não alterou a conta.
- Regressões D1/D1.1 e C2 anteriores foram reexecutadas; evidências finais no JSON
  de homologação. Ensaios do instalador e fechamento/reinstalação registrados ali.

Logs ficam em `logs/` ignorados pelo Git. Nenhuma afirmação aqui equivale a teste
em dois computadores físicos, Windows limpo, reboot do Windows ou aceite visual
completo. Isolamento validado: bancos/processos/pastas dedicados no Windows atual.

Electron 0.2.0 foi testado iniciando sua própria API empacotada e também após
instalação NSIS. Em ambas as execuções o formulário oficial de Estoque criou
duas unidades, verificadas no PostgreSQL após fechar a janela. Atualização 0.1→0.2,
desinstalação e reinstalação preservaram exatamente o digest de 14 tabelas D1.
O ASAR instalado correspondeu ao build. Evidência estruturada:
[`evidencias-homologacao-windows.json`](evidencias-homologacao-windows.json).

## Matriz exata dos módulos

| Módulo | Integrado e testado neste build isolado | Falta antes de uso diário |
|---|---|---|
| Setores/Funções | Telas oficiais, fila, CAS, cascata, envio/recebimento | Permissões empresariais e escopo compartilhado definitivos |
| Colaboradores | Cadastro/lista/edição, projeção sensível no servidor, setor/função e fila | Ficha completa, fotos/documentos, exclusão física, papéis/campos finais e dados reais homologados |
| Estoque | Tela oficial de cadastro/consulta/ajuste, entrada/saída via API, custos, limites locais e eventos duráveis | Reservas/cotas centrais aprovadas, compras/recebimento, perdas/estornos completos, exclusão e conciliação global |
| Produção | API transacional de insumos/produto/custo, rollback e fila | Portar e homologar toda a tela oficial, ordens/fichas técnicas/consumo diário/cancelamento e reconciliação |
| Financeiro | API de partidas em centavos, CAS, limite de caixa/banco, auditoria e fila | Portar todas as abas oficiais: gastos, contas, caixa, sangria, fechamentos, cartões, pagamentos/RH, anexos e conciliação |
| Configurações | Tela oficial, persistência e fila | Políticas por dispositivo/organização e administração operacional |
| Categorias/Fornecedores/Produtos | Adaptadores/contratos locais, produtos na tela Estoque | Demais telas e relações dos cadastros integradas e homologadas |
| Ponto/Escalas/Vales/Consumo/Advertências/Ocorrências | Fonte oficial preservada | Integração offline, permissões, conflitos e cálculos por domínio |
| Home/Direção/RH/Relatórios | Fonte oficial preservada | Cargas locais, cálculos e comparação de números/visual/exportação |
| Compras/Receitas/Delivery/Redes Sociais | Fonte oficial preservada | Integração por domínio e fornecedores externos; funcionalidades online não se tornam offline automaticamente |

## O que impede a liberação

1. Completar as telas/fluxos e relações da matriz, sem substituir o produto por
   uma interface simplificada. Estoque/produção/financeiro continuam sintéticos.
2. Definir autoridade global, reservas por dispositivo, conciliação/rejeição,
   cancelamentos e resolução de conflitos. Eventos críticos entregues continuam
   provisórios e não aplicam automaticamente saldo global nem pagamento externo.
3. Homologar autorização offline (concessão assinada/expiração/revogação), papéis
   empresariais e escopo multiusuário. A ponte admin de teste não é o modelo final.
4. Antes de conectar à nuvem original: corrigir e testar RLS/grants/Auth/Storage
   com autorização específica; integrar transporte seguro e anexos privados.
5. Definir cópia externa e custódia da chave, restauração em outro Windows,
   reconciliação de dispositivo após recuperação, retenção/RPO/RTO e volume real.
6. Provisionar PostgreSQL no instalador final, assinar distribuição e testar Windows
   limpo, duas máquinas físicas, reboot, atualização interrompida, impressão/exportação,
   antivírus e paridade visual completa. O instalador atual exige laboratório preparado.
7. Corrigir o typecheck e obter aceite documentado dos usuários por módulo antes
   de migrar qualquer dado real ou substituir o acesso 8080.

Continuidade: [outro computador](continuar-em-outro-computador.md).
Recuperação: [backup Windows](backup-windows-laboratorio.md).
