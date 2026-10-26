# Sistema Ruy — atualização PDF 0.7.1-rc.1

Atualização incremental da instalação identificada como **0.7.0-rc.1**, em `%LOCALAPPDATA%\Programs\Sistema Ruy`. Aplicada interativamente em 26/10 após autorização expressa do responsável. Homologação assistida dos PDFs ainda em andamento. Não autoriza ativação operacional nem lançamentos reais.

## Escopo implementado

- Financeiro → Visão geral: **Exportar PDF**, junto a Gastos por categoria. Usa o mesmo cálculo compartilhado, período e exclusão de cancelados. Não soma pagamentos novamente. Total geral soma os centavos das categorias exibidas.
- Colaboradores: **Exportar colaboradores em PDF**, com nome/nome social, função, setor, horário, entrada (tempo de casa, como na listagem), telefone e status. Ações e dados privados adicionais não são exportados. Pesquisa, setor, função e status preservam o escopo da listagem.
- No Windows, as coleções completas retornadas pela API são lidas sem os cortes antigos de 500 colaboradores e 1.000 despesas. Não há paginação oculta no endpoint D1; o servidor retorna todo o escopo autorizado.
- PDF A4, financeiro em retrato e colaboradores em paisagem; cabeçalho de tabela repetido, rodapé com páginas, acentos e quebra de nomes longos. Geração local com o motor PDF do Electron/Chromium já instalado, sem biblioteca nova em produção, impressão ou serviços externos.

## Segurança do fluxo

O preload expõe apenas `ruyReports.save`. IPC aceita somente a janela principal e a origem local. O renderer envia tipo, filtros e linhas esperadas, nunca HTML ou caminho de destino. O backend exige sessão ativa e administrador e utiliza as mesmas fontes autorizadas das telas. O botão fica oculto para outros perfis.

Antes de salvar, o processo principal consulta novamente o servidor e compara as linhas com a tela. Mudanças, revogação ou expiração de sessão recusam a exportação. Somente o diálogo nativo `showSaveDialog` escolhe o destino. Cancelar não cria janela de renderização nem arquivo. Diretórios internos, AppData, programa, perfis e backups são protegidos, inclusive através de diretórios redirecionados. Nomes inválidos são recusados. Arquivos existentes não são sobrescritos: escolher outro nome preserva o original. Falhas de escrita removem apenas o arquivo incompleto criado pela própria exportação.

O HTML é escapado e renderizado em sessão transitória, com JavaScript e rede desabilitados. Erros não expõem HTML, dados pessoais, caminhos internos ou credenciais. Não houve alterações de autenticação, SQL/migrations, valores financeiros ou operações de estoque.

## Evidências e limites

| Verificação | Resultado | Ambiente |
|---|---|---|
| Cálculo, período, centavos, data local de emissão, filtros, 1.300 colaboradores, campos permitidos, HTML, destino e cancelamento | 8 testes aprovados | Testes automatizados com dados sintéticos |
| Sessão, permissões, isolamento de proprietário, 640 colaboradores, totais, origem, método e revogação; botões React | 9 verificações aprovadas | PostgreSQL novo, HTTP e Electron de desenvolvimento |
| Clique nos dois botões, sessão real de teste, IPC, cancelamento e dois PDFs válidos | APROVADO | React/Electron de desenvolvimento; escolha de destino simulada |
| PDF de 180 colaboradores com nomes longos | APROVADO, 13 páginas A4 paisagem | Electron real; arquivos sintéticos |
| PDF de 90 categorias | APROVADO, 3 páginas A4 retrato | Electron real; arquivos sintéticos |
| Texto completo, cabeçalhos, rodapés, dimensões e limites de página | APROVADO | PyMuPDF; primeira e última página de cada relatório também inspecionadas visualmente |
| Autenticação individual | 23 aprovadas | PostgreSQL/HTTP, e-mail simulado; nenhum e-mail real enviado |
| Ponto, escalas e folha | 15 aprovadas | Backend PostgreSQL sintético; não equivale à interface instalada |
| Liquidações de folha/Delivery, concorrência, estorno, replay e reconciliação | 9 aprovadas | PostgreSQL sintético; sem pagamentos externos |
| Estoque / financeiro integrado | 121 / 9 aprovadas | Regressões sintéticas |
| Fonte, contagens, permissões, backup cifrado conjunto e restauração nova | 6 aprovadas | Cópia histórica própria; 1.186 registros, 63 colaboradores, 59 anexos, 54 vinculados e 5 em quarentena |
| Lint e builds principal/D1 | APROVADOS | Código da atualização |
| Dependências no executável empacotado e integridade do conteúdo | APROVADO | Preflight 0.7.1-rc.1; sem iniciar banco ou enviar e-mail |
| Instalação autorizada, conteúdo instalado e registro NSIS | APROVADO | Mesmo caminho e GUID; conteúdo instalado idêntico ao pacote verificado; registro por usuário 0.7.1-rc.1 |
| Inicialização e saúde após atualização | APROVADO tecnicamente | Logs `window-created`/`window-loaded`, API 18146 saudável e PostgreSQL próprio 55496; confirmação visual assistida ainda necessária |
| Janela nativa Salvar como e exportação no aplicativo atualizado instalado | PENDENTE | Atualização autorizada e aplicada; aguardando resultado do teste assistido |

Uma tentativa adicional do fluxo amplo de interface de jornada expirou em `warning-submit`, sem erro de API comprovado. Não foi tratada como aprovação da interface nem corrigida alterando módulos alheios ao PDF. O teste específico dos relatórios foi isolado e aprovado posteriormente. Homologação completa das operações na versão instalada continua dependendo de evidência assistida; testes de backend não substituem esses cliques.

Os dois processos sintéticos sem janela das primeiras tentativas de renderização foram identificados novamente por executável, argumentos e horário. Após autorização específica, `CloseMainWindow()` retornou false e foi usado exclusivamente `Stop-Process -Id 16540` e `Stop-Process -Id 1256`. A ausência posterior foi confirmada. Nenhum filho ou processo instalado foi alvo. O teste corrigido encerrou normalmente.

## Preservação e recuperação

Snapshot de código base `ef7394d` preservado localmente. Backup conjunto cifrado conferido e restaurado em bancos novos, sem redirecionar a aplicação. Nove arquivos de configuração/proteção foram copiados e comparados por SHA-256 em diretório protegido de snapshot, dentro do perfil atual; nenhuma credencial em texto foi exportada. Os arquivos originais, o banco e as instalações anteriores foram preservados. Os 136 arquivos do manifesto histórico e os dez WIP da Etapa A permanecem inalterados.

O perfil consultado ainda mantém `activationApproved:false`. Esta atualização não muda essa autorização. Conectores externos, sincronização entre computadores e qualquer ativação definitiva exigem seus próprios critérios e autorização. Não foram efetuados novos pagamentos, estornos ou baixas com dados reais.

## Atualização, após autorização expressa

Pacote preparado: `artifacts/sistema-ruy-0.7.1-rc.1-20261026/Sistema-Ruy-0.7.1-rc.1-Setup.exe` (**112.164.049 bytes**).

SHA-256: `5bb33754e8f4dc1cff3bfd67ac1b4739ac816969235ce6186de8939c008fdedf`.

O instalador NSIS e o arquivo compactado interno passaram na verificação de integridade. O `app.asar` extraído do instalador coincide com o pacote conferido e com o arquivo instalado: `de4cac368a3616c57d707f5b5a6874e37363b9350707b5a99eeb1729bbe52740`. O pacote não contém dados recuperados, chaves privadas, backups ou auxiliares de testes. **Sem assinatura digital; instalado interativamente somente após autorização expressa.**

Depois da atualização, consultas exclusivamente de leitura confirmaram 63 colaboradores, 1.186 registros históricos, 59 anexos e 54 vinculados; a fonte continua com `transaction_read_only=on`. As tabelas de liquidações e movimentos de estoque próprios continuam sem registros. Nenhum efeito histórico foi reaplicado. A API é o processo próprio da instalação e o log confirmou criação/carregamento da janela.

Manter a mesma identidade: produto/atalho **Sistema Ruy**, AppId `br.ruy.gestao.windows.operacional`, GUID NSIS `75c7b9b8-6d06-4bf1-89d1-4e566b45c050`, perfil `windows-operational`, API 18146 e PostgreSQL 55496. Dados, chaves, usuários e anexos ficam fora da pasta do programa. Não há migrations nesta atualização.

1. Fechar normalmente o Sistema Ruy e aguardar o backup. Confirmar ausência dos processos próprios e do lock de backup, sem encerrar outras instalações.
2. Conferir o SHA-256 do pacote e um backup cifrado recente. Preservar o snapshot e o instalador anterior; snapshot de código não substitui backup de dados.
3. Executar interativamente, apenas para Pichau, sem elevação e mantendo exatamente `%LOCALAPPDATA%\Programs\Sistema Ruy`. Não escolher novo diretório. Se houver bloqueio de segurança, interromper; o pacote não é assinado.
4. Abrir pelo mesmo atalho, entrar com a conta individual e conferir Dashboard, menu e contagens. Não enviar senha ou código pelo chat.
5. Financeiro: selecionar período conhecido, comparar categorias, exportar para uma pasta de documentos e abrir o PDF. Repetir cancelando o diálogo e confirmar ausência de arquivo.
6. Colaboradores: exportar o escopo atual e um filtro conhecido; conferir quantidade, nomes, colunas e páginas. Não editar cadastros para esse teste.
7. Fechar e reabrir, conferir persistência e repetir backup/restauração somente em destino novo independente.

Não executar rollback sobre banco existente. Em caso de falha, preservar a instalação/dados e usar o backup validado em destino separado, mediante autorização; não tentar reinstalações ou troca de perfil automaticamente.
