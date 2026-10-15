# Sistema Ruy — inventário e plano do aplicativo Windows único

15/10/2026. Documento de planejamento; não autoriza implantação, importação ou sincronização operacional.

## Objetivo e referência de preservação

Entregar um único produto Windows, mantendo o React, a aparência, os menus, os cadastros e os fluxos do Sistema Ruy. C1 e C2 são componentes de laboratório a incorporar por trás das telas originais; suas telas, usuários e dados fictícios não serão o produto final.

Produção consultada somente por health e arquivos locais: release `20261015T155237724Z-d597121d`, HTTP 200 em `http://localhost:8080/__health`. Branch de trabalho `agente-3`, HEAD `f3be62be13094e4e78436d954b3094d04f96633b`. Não houve troca de release, reinício ou modificação de banco nesta atividade.

**A branch atual não é a referência completa de interface.** Seu App/navigation não contém Redes Sociais; o commit `9d7e59ea59239f1ab25c0abbc346420d83e3783d`, usado como referência da recuperação anterior, contém essa rota, componentes sociais, ThemeProvider e melhorias dos dashboards. O manifesto da release ativa confirma chunks RedesSociais, financialDashboard e rhDashboardMetrics. Manifesto de build não comprova sozinho o comportamento de cada tela: preservar fonte, verificar diferenças e homologar visualmente antes de integrar. Não reconstruir o produto somente a partir desta branch antiga.

Fontes inspecionadas: README, App, navigation, Sidebar, base44Client, cloudDb, useUserRole, serviços de estoque, anexos, árvore do commit de referência, manifesto/active.json e relatórios B/C1/C2. Inventário estático inicial; nenhuma funcionalidade abaixo é declarada homologada apenas por existir no código. Funções em desenvolvimento permanecem identificadas como tal.

## Inventário obrigatório de preservação

| Área / rotas | Telas e comportamento a preservar | Dependência e atenção na integração |
| --- | --- | --- |
| Entrada: `/login`, `/register`, `/forgot-password`, `/reset-password` | Login, saída, recuperação, mensagens, retorno à tela solicitada e restrições de cadastro | Cadastro/recuperação em nuvem precisam conexão; login offline será provisionado e separado do token Supabase |
| Estrutura comum | Sidebar agrupada, Topbar, menus por perfil, navegação direta, layout responsivo, diálogos, alertas, carregamento e erros | Preservar claro/escuro, preferência, logotipo e atalhos; esconder menu não substitui autorização |
| `/` | Dashboard e seus resumos, gráficos, filtros e navegação | Reproduzir cálculos e melhorias da release ativa com fixtures conhecidas |
| `/direcao` | Indicadores e resumos de direção | Escopo administrativo e restrição de informações sensíveis |
| `/rh` | Painel de RH e indicadores | Agregações locais autorizadas, sem vazamento de salários/documentos |
| `/funcionarios`, `/funcionarios/:id` | Lista, pesquisa, filtros, cadastro, edição, ficha, histórico, documentos, avaliações, pagamentos, ausências e anexos | Relações e identificadores preservados; dados pessoais entram só em fase futura autorizada |
| `/setores`, `/funcoes` | Cadastros de setores e funções | Primeiros candidatos para adaptação, usando apenas conteúdo fictício |
| `/ponto` | Registro rápido, entradas/saídas, ajustes, incompletos e painel | Fuso, virada de dia, autoria e concorrência |
| `/escalas` | Diária/semanal/mensal/padrão, criação, duplicação, substituição e cobertura | Conflitos de período e referências a colaboradores/setores |
| `/ocorrencias`, `/advertencias` | Ocorrências de frequência e advertências, formulários/histórico | Sigilo, atribuições de gerente e auditoria |
| `/vales`, `/consumo` | Registros, situação, filtros e vínculos com colaboradores | Não disparar efeitos financeiros duplicados |
| `/financeiro`, `/gastos-diarios` | Contas a pagar/receber, despesas/categorias, recorrências, comprovantes, caixa, sangria, fechamento, movimentos e totais | Valores decimais, idempotência, proteção de anexos e conciliação; nenhuma soma de saldos por sobrescrita |
| `/receitas` | Receitas, cartões, liquidações de delivery e conciliação | Distinguir registro local de confirmação de pagamento externo |
| `/compras` | Compras, fornecedores, itens e recebimento | Recebimento com efeito em estoque é comando transacional |
| `/estoque` | Cadastro de itens/produtos, unidades, categorias, localização, saldos, entrada/saída/perda/ajuste e histórico | Integrar cadastro antes de liberar movimentações offline; saldo não será último valor recebido |
| `/producao` | Produtos de produção, fichas técnicas/ingredientes, ordens, consumo e controle diário | Ordem, baixa e cancelamento precisam regras de conflito e atomicidade aprovadas |
| `/relatorios`, `/relatorios/financeiro` | Relatórios, filtros, resumos financeiros, contas, conciliação, rotação de máquinas e exportação/impressão onde existente | Conferir números e paginação contra fixtures, PDF e impressora real |
| `/auditoria` | Consulta e rastreabilidade de ações | Auditoria local e central com origem/autor, sem edição pelo usuário comum |
| `/configuracoes` | Configurações e preferências existentes, inclusive tema | Separar preferência por computador de configuração compartilhada |
| `/redes-sociais` na referência da release | Dashboard, relatórios, integrações, mensagens, comentários, acessos de contas, ManyChat e recursos de IA encontrados nos componentes | API/fornecedores externos exigem internet; não prometer publicação/mensagem online offline; preservar a tela e mostrar indisponibilidade real |
| Delivery | Preservar liquidações já encontradas no financeiro e requisitos/documentos da Central de Delivery | Não foi comprovada uma rota própria de Central de Delivery em App da referência; confirmar estágio antes de afirmar módulo completo |
| Arquivos em todos os módulos | Upload, visualização autorizada, PDFs/imagens, limites, tipos e impressão | Arquivo local privado, hash e fila própria; URL assinada expirada não é cópia offline |

OAuthConsent existe como arquivo na árvore, mas não foi encontrado como rota em App inspecionado. Registrar como dependência a esclarecer, sem inventar fluxo ativo. Produtos não devem ganhar uma tela substituta: preservar seus cadastros dentro de Estoque/Produção e confirmar qualquer tela adicional no aceite.

O adaptador atual declara 39 entidades: Absence, AccountsPayable, AccountsReceivable, AuditLog, CardReceivable, CashMovement, Consumption, CostCenter, DailyFinancialClose, DailyProduction, DeliverySettlement, Employee, EmployeeDocument, EmployeePayment, Evaluation, ExpenseCategory, FechamentoCaixa, FinancialAccount, FinancialExpense, InventoryItem, JobRole, MachineRotation, ManualReconciliation, ProductionOrder, ProductionProduct, Purchase, PurchaseItem, RecipeIngredient, RecurringExpense, Revenue, Sangria, Schedule, Sector, StandardSchedule, StockMovement, Supplier, SystemSettings, TimeRecord, Vale e Warning. Conferir essa lista contra a fonte consolidada da release e componentes sociais antes do fechamento do contrato de dados.

Para cada rota, a próxima fase deverá registrar: perfil permitido, ações e campos, entidade/relacionamentos, validações, filtros/ordenação/paginação, exportações, efeitos colaterais, screenshots claro/escuro e evidência do teste. O proprietário valida essa matriz; nenhuma rota desaparece silenciosamente por ainda não ter backend offline.

## Arquitetura proposta

Fluxo: janela Windows com frontend original → API local autenticada → PostgreSQL local + repositório privado de arquivos. Worker local lê outbox e conversa por HTTPS com endpoint central autorizado do projeto Supabase original `wvcvveqdkecsoygtilop`; inbox aplica respostas/transações no banco local. A interface sempre lê/grava localmente nos módulos já integrados, online ou offline, sem dois bancos concorrentes para o mesmo módulo.

Proposta de empacotamento: Electron pela compatibilidade com React/Vite e runtime Node já utilizado, a validar em uma prova descartável antes de adicionar dependências ao produto. Renderer com sandbox, contextIsolation, nodeIntegration desabilitado, CSP e ponte IPC mínima com validação de remetente/argumentos. Nenhuma credencial PostgreSQL ou chave privilegiada na página. Sites externos abrem no navegador autorizado, sem carregar conteúdo remoto privilegiado na janela. Referência: [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security/).

Aplicação acompanha runtime e PostgreSQL com versões fixadas, checksums e licenças; o usuário não instala Node/npm manualmente. Instalador assinado, ícone, atalho, diagnóstico, verificação de espaço/portas e instalação sem internet com pré-requisitos incluídos. Não reutilizar cluster operacional nem porta 8080. API e banco apenas loopback, roles mínimos, ACLs e segredos DPAPI. Definir suporte por usuário Windows ou instalação por máquina antes de criar serviços; um único cluster/identidade por dispositivo, sem duplicar sincronizadores quando há duas janelas.

O cliente preserva o contrato `entities.X.list/filter/get/create/update/delete/bulkCreate/deleteMany/subscribe` conforme uso real, além de erros, concorrência, ordenação e notificações. Adaptar por trás de base44Client; não trocar globalmente o backend antes de cobrir as operações utilizadas. Auditar também acessos diretos a Supabase, stockService, uploads, auth e APIs sociais, que não passam por esse contrato.

O atual seletor cloud/local escolhe um backend na inicialização; polling de 20 segundos não é protocolo offline. Não reaproveitar upsert genérico como sincronização sem versão, autorização e recibo. Não importar automaticamente IndexedDB/localStorage nem criar migração no login.

## Integração progressiva e critérios de passagem

| Etapa | Entrega isolada | Critério para avançar |
| --- | --- | --- |
| D0 — referência | Preservar manifesto/release e consolidar cópia de fonte completa fora da produção; matriz de todas as rotas e operações | Tema, dashboards e Redes Sociais presentes; divergências registradas; referência reproduzível sem ativação |
| D1 — primeira tela original | `/setores` original com adaptador local, entidade Sector e fixtures; depois `/funcoes` | Criar/listar/filtrar/editar, autenticação e autorização no servidor, outbox durável, navegador real, reinícios e isolamento sem rede |
| D2 — permissões e sincronização de cadastros | Sector/JobRole no central descartável, dois bancos locais e tela de conflitos | Idempotência, autorização individual, remoção lógica/versionada, dependências e regra de resolução aprovadas; sem acesso operacional |
| D3 — aplicativo Windows piloto | Mesma interface no instalável; inicialmente apenas domínios integrados habilitados para gravação local | Instalar/reparar/reiniciar/desinstalar em Windows limpo; outras telas preservadas com estado explícito, sem fingir autonomia completa |
| D4 — cadastros relacionados e arquivos | Fornecedores, cadastros de produtos sem saldo, posteriormente colaboradores sintéticos e anexos | IDs/relações, privacidade, arquivo ausente/corrompido, transporte/repetição e cache autorizado aprovados |
| D5 — rotinas operacionais | RH/ponto/escalas; depois estoque/produção e financeiro por contratos específicos | Regras de conflito por domínio aprovadas; simulações de negócios e invariantes; não habilitar gravações parciais que quebram outros módulos |
| D6 — piloto com nuvem | Integração controlada com Supabase original e conjunto autorizado de dados, somente após aprovação específica | Correção RLS/Storage aplicada com aprovação, testes de isolamento, backup restaurado e plano de reversão aprovados |
| D7 — adoção | Instalação gradual em computadores autorizados com todas as telas homologadas | Aceite de paridade, suporte, restauração e período de observação; só então decidir transição da operação 8080 |

D1 é o próximo desenvolvimento recomendado, não execução autorizada por este documento. Setores são simples em comparação ao financeiro, mas possuem referências em colaboradores/escalas; testar renomeação/inativação e não propagar automaticamente alterações para esses módulos. Exclusão física de entidade referenciada deve ser impedida.

## Login e permissões offline

Provisionar cada dispositivo e usuário autorizado inicialmente online, com identidade canônica vinculada ao Supabase, sem duplicar automaticamente contas. Verificador de senha forte local, tentativas limitadas, sessão local própria e política de expiração/revalidação; não armazenar senha Supabase nem usar token expirado como login offline. Não reutilizar senha fixa, autenticação local legada do navegador ou tokens estáticos C2 na produção.

API verifica permissão em toda leitura/escrita e por registro/campo; UI apenas reflete a decisão. Identidade do autor vem da sessão, não do formulário. Perfil/escopo offline é concessão assinada com prazo a aprovar. Revogação instantânea sem rede não é possível: aprovar janela máxima, operações permitidas e comportamento após vencimento. Alteração de perfis, inclusão de usuários e recuperação de acesso ficam restritas ao fluxo autorizado, sem autoelevação offline.

Separar autorização de leitura local, gravação local e aceitação central; alteração feita offline pode ser rejeitada posteriormente e deve ficar preservada para análise. Isolamento de perfis não equivale a proteção contra administrador do Windows com controle físico da máquina; documentar ameaça e prever criptografia do disco/arquivos e bloqueio de sessão.

## Protocolo de sincronização e indicador

Reaproveitar outbox/inbox, UUID, identificação do dispositivo, CAS de versão, recibos e recuperação C2; substituir credenciais estáticas por sessões/dispositivos autorizados. Preservar IDs reais existentes, inclusive formatos legados; UUIDs para registros novos somente após confirmar compatibilidade. Schema versionado, tombstones para exclusão, dependências e transações por agregado. Hora local é metadado, não árbitro de conflito.

O contrato central operacional ainda precisa ser implementado e validado. Não usar service_role no instalável nem permitir que o cliente escolha autor/tenant. RLS, funções transacionais ou endpoint servidor confiável devem impor escopo; correção mínima baseada no esquema real, nunca acesso geral a authenticated. Reconciliar totais/IDs/versões sem expor dados pessoais em logs.

Nuvem: desconectado/desconhecido, pendente, enviando, conflito, recusado, falha e confirmado. Check apenas quando envio foi confirmado e recebimento concluído até cursor conhecido, sem pendências/conflitos. Exibir última confirmação e se a conexão atual está desconhecida; backup tem status separado. Anexo pendente impede declarar sincronização completa do registro dependente.

Estoque terá movimentos e regras de disponibilidade; quantidade global disponível não pode ser garantida durante partição sem reserva/cotas ou bloqueios aprovados. Financeiro terá lançamentos, conciliação e cancelamentos explícitos; não mesclar saldos. Edição simultânea em cadastros não pode descartar versão silenciosamente. Não habilitar automaticamente esses domínios com o protocolo demonstrativo C2.

## Backup e recuperação

Propor snapshots lógicos consistentes com pg_dump/pg_restore da versão compatível, anexos imutáveis com manifesto/hash, schema, identidade, outbox/inbox e cursores. Não copiar diretório de PostgreSQL ativo como backup comum. [Documentação PostgreSQL](https://www.postgresql.org/docs/current/app-pgdump.html).

Agendar backups locais criptografados e cópia independente fora do disco, retenção e alertas; destino externo ainda não definido. Proposta inicial a aprovar: cópia local horária durante uso, cópia externa diária, objetivo de perda máxima de uma hora local/24h em perda total do computador, recuperação em até quatro horas, sujeito a teste com volume real autorizado. Backup no mesmo disco não cobre perda do computador.

Chave de recuperação externa ao computador é necessária: DPAPI por si só não permite restaurar segredos em outro Windows. Não gravar chave junto do backup. Ensaiar restauração em instalação limpa, conferir contagens, hashes, vínculos e filas antes de liberar sincronização.

Restauração de imagem antiga pode reenviar operações já aceitas: central precisa manter deduplicação, detectar cursor/versões e impedir regressão. Clone recebe novo ID de dispositivo; recuperação do mesmo dispositivo requer reconciliação antes de reativação. Desinstalação conserva dados por padrão; exclusão exige ação explícita posterior.

## Testes obrigatórios e evidências de aceite

1. Paridade: cada rota/menu/aba/diálogo, perfil e ação da matriz; screenshots em claro/escuro, resoluções e escala Windows, teclado, acentos, datas, filtros, totais, PDF, download e impressão. Testar no navegador real e no aplicativo empacotado; DOM emulado é complementar.
2. Contrato: adaptadores com fixtures iguais, mesmas consultas/erros e ordenação; validação de campos, duplicidade e relacionamentos; proibir fallback silencioso ao Supabase ou ao IndexedDB.
3. Offline real: bloquear saída à internet somente da VM de teste, iniciar aplicativo e login autorizado sem rede, criar/consultar/editar, fechar janela, reiniciar API, PostgreSQL e Windows; manter dados/fila. Conta não provisionada não entra.
4. Sincronização: A → central → B e inverso, lotes, desconexão antes/depois do COMMIT, timeout, ACK perdido, crash, lease, repetição, ordem invertida, conflitos, rejeições e dependências/anexos. Comparar IDs, versões e efeitos; nenhum confirmado sem recibo.
5. Segurança: anônimo negado, usuário de outra conta/escopo negado, alteração de papel/autor recusada, acesso direto a API negado, expiração/revogação, CSRF/Origin, IPC e navegação externa, segredos ausentes dos bundles/logs, Storage privado e cache por usuário.
6. Integridade: valores monetários precisos, unidades, baixa de estoque uma vez, cancelamento e conciliação, ponto/escala em virada de dia, auditoria. Só executar quando contratos desses módulos forem aprovados.
7. Instalador: Windows limpo sem Node/PostgreSQL/internet, usuário comum e administrador, porta ocupada, falta de espaço, antivírus, segundo usuário Windows, reparo, atualização interrompida e versões incompatíveis. Não remover cluster existente nem ocupar 8080.
8. Recuperação: dump íntegro e corrompido, anexo ausente, chave indisponível, disco cheio, restauração em outro computador, replay após snapshot antigo e perda de relógio correto; medir objetivos de recuperação.
9. Não interferência: health, release e hash do manifesto 8080 antes/depois de cada teste, nenhum restart/publicação operacional, nenhum destino Supabase operacional nos testes. Validação funcional operacional somente de leitura e com sessão autorizada.

Evidências atuais: B teve 28 testes; C1 teve 44 somando infraestrutura e cadastro; C2 teve 21 verificações reais de PostgreSQL/APIs. Esses resultados não comprovam instalador, backup externo, segurança operacional ou paridade de todas as telas. O proprietário confirmou abertura e sessão autorizada no C1; criação/consulta/edição no navegador ainda não foram confirmadas explicitamente.

## Proteção da operação e reversão

Manter release e diretório 8080, cluster operacional e Supabase intocados. Desenvolver cópia isolada com pacote, portas, banco e configuração próprios; allowlist de destinos de laboratório e testes que falham se identificarem projeto operacional. Não executar publicação para testar instalador.

Na fase futura de transição, backup restaurado e aprovação antecedem qualquer dado real. Definir um escritor por domínio/dispositivo; evitar coexistência de versões antiga/nova gravando modelos incompatíveis. Se houver falha, pausar worker e preservar filas, arquivos e trilha; não apagar migrações ou voltar schema destrutivamente. Retorno à interface anterior depende da compatibilidade dos dados e da reconciliação das operações já confirmadas; não basta trocar executável.

## Bloqueios e decisões pendentes

- Corrigir e testar exposição anônima/RLS, grants, associação usuário/perfil/permissões e Storage no projeto original, com aprovação antes da aplicação.
- Consolidar referência de fonte e aceitar inventário visual completo, incluindo tema, dashboards, social e estágio do Delivery.
- Definir prazo de autorização offline, regras de conflito por domínio, acesso por campo e provisionamento de dispositivos.
- Definir destino independente/chave de backup e comprovar restauração; instalador/assinatura ainda não implementados.
- Validar duas máquinas Windows reais, desempenho e licenças/distribuição dos runtimes.

Nesta entrega foi criado somente este plano. Nenhuma instalação, atualização da interface, importação, migration operacional ou sincronização com Supabase foi realizada.
