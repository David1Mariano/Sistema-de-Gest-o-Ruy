# Complementação dos módulos Windows — 23/10/2026

Esta entrega de código não altera a rc.3 instalada nem autoriza operação definitiva.

## Compras

O contrato `Purchase` usa o mesmo comando de domínio D1 e a mesma transação PostgreSQL. O servidor calcula valores em centavos a partir das quantidades em milésimos. O cadastro cria uma conta a pagar vinculada, sem efetuar pagamento ou entrada de estoque.

Receber exige token de conferência dos documentos e versões dos saldos. Compra, conta, estoque, recibos e auditoria são tratados em uma transação. Os identificadores de entrada por item são determinísticos. Repetição do mesmo comando recupera o recibo; recebimentos concorrentes não duplicam estoque. Cancelamento exige motivo e conta pendente; se o estoque já foi consumido, a transação inteira é recusada. Não existe uma segunda rota de baixa de estoque.

Frete e desconto compõem o total da conta. O custo unitário do estoque é o preço informado para cada insumo; não há rateio automático de frete ou desconto. A interface inicial registra um insumo por compra; o contrato aceita até dez, respeitado o limite total do documento. Edição visual de compras ainda precisa ser concluída e homologada.

`purchasing.sql` recusa bancos instalados e compartilhados. Seu uso nesta rodada se limita a bancos novos de teste identificados, na porta 55483. Não foi aplicada migração a instalações existentes.

## Folha

A interface permite selecionar explicitamente vales e consumos operacionais. Registros históricos não são oferecidos como novos descontos. O servidor revalida vínculo, situação, versões e limites. Fechar cálculo continua sem efetuar pagamento.

A reabertura exige administrador, versão atual, fingerprint do fechamento e motivo de 8 a 300 caracteres. O fechamento anterior permanece na auditoria imutável. Pagamento não cancelado no período bloqueia a reabertura; pagamento sem período identificado também bloqueia por segurança. A mudança não libera pagamentos de folha.

## Evidências e limitações

- `test-purchasing.mjs`: dez verificações PostgreSQL, somente dados sintéticos, incluindo concorrência, replay, rollback, snapshot D1/C2 adulterado, cancelamento e persistência após reconectar. Reconectar não equivale a reiniciar o PostgreSQL.
- `test-attendance.mjs`: quinze verificações de servidor de jornada, escalas, advertências, folha, reabertura, permissões, CSRF e reinício da API. A décima sexta etapa passou no Electron de desenvolvimento: navegação de ponto/escalas, advertência, cálculo e fechamento de folha, persistência após recarregar, criação de compra e recebimento conferido. Não é teste da instalação NSIS. Houve timeouts intermediários de interface; a execução final passou após aprimorar a espera pelas opções do formulário e recompilar o frontend atualizado.
- Regressões de estoque: 121 verificações. Financeiro integrado: nove. Brevo, rede e cálculo: vinte, sem envio real. Contratos, interface renderizada e conectores Delivery: oito, sem provedor externo.
- Originais recuperados: manifesto de 136 arquivos, 1.186 registros e 59 anexos verificado sem alteração. Dez arquivos WIP da Etapa A preservados.

## Critérios ainda necessários para a primeira versão operacional

1. Perfil operacional independente do perfil histórico somente leitura, com cópia controlada dos cadastros e sem repetir efeitos financeiros ou de estoque antigos.
2. Inicialização independente da fonte histórica após reiniciar o Windows, sem depender de ligar manualmente o cluster de recuperação.
3. Provisionamento próprio de Delivery e validação transacional dos seus efeitos no caixa; conectores externos continuam desativados.
4. Completar pagamentos e reconciliação da folha antes de oferecer pagamento por esta tela.
5. Homologar os novos formulários no executável empacotado e na instalação candidata, incluindo persistência, backup completo e restauração independente.
6. Aprovação expressa antes de substituir qualquer instalação ou ativar dados para operação definitiva.

Não é seguro remover os bloqueios de menu do perfil histórico para permitir escrita. Isso não configura um perfil operacional e comprometeria a separação dos dados preservados.
