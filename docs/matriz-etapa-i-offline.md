# Matriz de telas e funcionalidades — Etapa I

Auditoria estática de 29 telas oficiais e 172 arquivos locais relacionados. Inventário completo de botões, formulários, campos, chamadas e linhas em [JSON](matriz-etapa-i-offline.json). Não equivale a clique/teste de todos os controles. Nenhum módulo inteiro é declarado totalmente homologado: os fluxos concluídos são discriminados abaixo.

| Tela oficial | Situação como módulo completo | Fluxos locais e lacunas |
|---|---|---|
| Advertencias | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Auditoria | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Compras | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Configuracoes | Parcial | Contrato SystemSettings parcial; usuários/credenciais empresariais não administráveis offline. |
| Consumo | Parcial | Contrato F local, estados e desconto de folha; não representa baixa de insumos. |
| Direcao | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Escalas | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Estoque | Parcial | Cadastro e movimentos locais portados; uploads/exportações e todas as rotinas não homologados. |
| FichaColaborador | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Financeiro | Parcial | Pagamento individual e múltiplo atômico; despesas/contas portadas. Lote específico de vales, comprovantes, estornos e fechamento global limitados. |
| ForgotPassword | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Funcionarios | Parcial | Cadastro/consulta/edição locais; anexos privados, exclusão e autorização empresarial incompletos. |
| Funcoes | Parcial | Cadastro/consulta/edição e vínculo ao setor locais. |
| GastosDiarios | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Home | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Login | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| OAuthConsent | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| OcorrenciasFrequencia | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Ponto | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Producao | Parcial | Ficha, rascunho, conferência/consumo/cancelamento agregados locais; escopo parcial. |
| RH | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| ReceitasFinanceiras | Parcial | Receita manual, contas/recebíveis e repasses delivery locais; não constitui venda, comanda ou pedido delivery. |
| RedesSociais | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Register | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| RelatorioFinanceiro | Parcial | Fontes locais parciais; relatório integral/exportação no Electron não homologados. |
| Relatorios | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| ResetPassword | Indisponível | Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais. |
| Setores | Parcial | CRUD e renomeação com impacto/versionamento locais; escopo sintético por usuário. |
| Vales | Parcial | Contrato F: criar/editar/cancelar, desconto vinculado e histórico locais; lote financeiro de vales bloqueado. |

Vendas, comandas e pedidos delivery não possuem telas dedicadas encontradas em src/pages. Repasse financeiro delivery não é operação de pedido. Auth/Storage/Supabase operacionais continuam desconectados. Menus sem rota exibem bloqueio, não um módulo vazio aprovado.

Fluxos locais concluídos dentro do laboratório: CRUD de setores/funções; contratos de colaborador; vales/consumo individuais com histórico e vínculo ao desconto; pagamentos múltiplos pelo formulário oficial (Etapa I); movimentos de estoque e agregados de produção/financeiro já portados. Autorização efetiva atual: admin ativo para domínio/RH, escopo por proprietário; writer/reader restritos nos demais contratos. Não há delegação empresarial granular homologada.

Campos/ações de arquivos privados, documentos, integrações, exportação/download, fechamento global, lote específico de vales, estornos e administração empresarial permanecem pendentes ou bloqueados mesmo quando a tela usa uma entidade conhecida. Filtros são locais somente sobre os registros efetivamente retornados pelo contrato; não indicam cobertura de fontes não portadas.
