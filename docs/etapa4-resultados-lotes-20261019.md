# Etapa 4 — resultados por lote

- A: contrato e auditoria em 2d1ecf0. Quatro testes de domínio + 25 regressões de transporte/anexos: 29/29; lint aprovado. Sem mudança de runtime nesse lote.
- B: 12/12 cenários SQL/API reais em 55437, dois D1 simulados e central HTTP loopback. CAS, rollback após escritas, replay, estados, cancelamento, offline/ACK perdido, arquivo de reconciliação e restart de processo aprovados. 29/29 regressões e lint aprovados. Clientes/menu/entregadores são fixtures de referência neste lote; cadastros serão validados no lote C. Nenhum efeito de caixa/estoque ou pagamento. Não houve alteração no financeiro central.
