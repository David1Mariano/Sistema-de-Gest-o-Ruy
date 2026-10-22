# Homologação das áreas solicitadas — 22/10/2026

Pedido: remover o gráfico de contagens de documentos financeiros e homologar
Direção, Redes Sociais, Ponto, Escalas, Ocorrências, Advertências, Folha e Compras.

Estado da instalação 0.6.0-rc.2: o responsável confirmou login e Dashboard na
entrada. A instalação atual foi preservada; as correções abaixo estão no código
validado e na candidata 0.6.0-rc.3, não instalada automaticamente.

## Matriz com escopo de aprovação

| Área | Resultado comprovado | Limitação para uso operacional |
| --- | --- | --- |
| Dashboard | Gráfico “Documentos financeiros preservados” removido; ausência validada no Electron e no bundle | Aplicar candidata somente com autorização |
| Direção | Consulta das fontes autorizadas testada no Electron com os registros recuperados | Receita, saldos, DRE, projeção e canais sem fonte ficam indisponíveis; não se estimam zeros |
| Redes Sociais | Painel original com dados obtidos da API local, autenticação administrativa e estado desconectado testados | Sem conta/provedor conectado; publicação, respostas, IA e ManyChat não homologados nem ativados |
| Ponto | PostgreSQL + HTTP + Electron em base sintética: marcações, cálculos no servidor, conflitos, duplicidade e correção com motivo | Perfil histórico não contém ponto. Jornada noturna ainda sem suporte; não aplicar schema na candidata histórica |
| Escalas | Cadastro e concorrência, intervalos inválidos, escala padrão e permissões testados; navegação no Electron | Não existem escalas na recuperação. Requer perfil operacional separado para novos registros |
| Ocorrências | Oito registros recuperados consultados no Electron; nenhum botão de escrita no histórico. Registro/cancelamento e rollback com escala testados na API sintética | Cadastro pela interface instalada ainda depende do perfil operacional e aceite manual |
| Advertências | Seis registros recuperados consultados sem escrita; cadastro pela UI do Electron com dados sintéticos; validação, auditoria, versão, replay e cancelamento testados no servidor | Dados históricos permanecem somente leitura; edição completa na instalação não declarada homologada |
| Folha | Política individual explícita, cálculo no servidor, fechamento, auditoria, fingerprint, duplicidade e recarga testados em base sintética e Electron | Pagamento, reabertura, jornada noturna e operação sobre a fonte histórica não habilitados |
| Compras | BLOQUEADO / NÃO HOMOLOGADO | A tela antiga grava compra, itens, conta a pagar e entradas em sequência. Falha pode deixar recebimento parcial; ausência do contrato local confirmada. Exige comando transacional único e testes de rollback e duplicidade |

## Alterações realizadas

- Dashboard reutiliza o Home e os cartões existentes; removidos gráfico e importação
  de Recharts deste componente. Não se altera o Dashboard da instalação em uso.
- Rotas locais para Direção, Redes Sociais, Ocorrências e Advertências. Apresentação
  original mantida; nenhum novo login, serviço cloud ou armazenamento paralelo.
- Ocorrências e Advertências usam o filtro Todo o histórico por padrão na consulta
  recuperada. Botões e formulários de escrita são ocultados no modo somente leitura.
- Direção consulta somente entidades disponíveis; cartões e gráficos sem fontes
  completas informam indisponibilidade. Administração e fontes são validadas no servidor.
- Endpoints locais de capacidades e snapshot social autenticados, restritos a admin
  e, no histórico, a usuários explicitamente autorizados para a recuperação.
- Snapshot social explicitamente desconectado, sem comentários ou métricas fictícias,
  sem envio externo e sem configuração de credenciais.
- Menu explica a ausência da fonte de jornada e do perfil de folha; não remove
  bloqueios por simples mudança de rótulo. Compras continua bloqueada.

## Testes desta alteração

- 10 verificações PostgreSQL/HTTP/Electron da consulta recuperada: aprovadas.
  Incluem remoção do gráfico, Direção parcial, painel social desconectado,
  seis advertências e oito ocorrências, ausência de escrita, 63 colaboradores,
  ficha, comprovante, financeiro e recarga.
- 14 verificações de jornada/folha/advertências em bancos sintéticos novos:
  aprovadas, incluindo cadastro de advertência pela UI do Electron e fechamento
  do cálculo de folha. Zero pagamento ou movimento de estoque real executado.
- 20 verificações automatizadas de transporte, Brevo simulada e cálculo: aprovadas.
- Lint, build principal e build D1: aprovados; aviso não bloqueante de chunk grande.
- Um teste de UI novo precisou normalizar o espaço no texto do botão. Essa falha
  era do seletor do teste, não evidência de falha do aplicativo. A execução final passou.
- Manifesto original: 136 arquivos, 1.186 registros e 59 anexos inalterados;
  cinco anexos seguem em quarentena. Dez arquivos WIP da Etapa A preservados.

Electron de desenvolvimento com API/PG reais não equivale à homologação NSIS.
O pacote novo usa a mesma identidade da candidata de teste para preservar perfil,
conta e dados numa atualização autorizada. Não instalar sobre R4 nem outro produto.

## Próximos critérios

1. Aplicar somente na candidata de teste, com backup e autorização de atualização.
2. Aceite manual das quatro consultas novas no executável instalado.
3. Perfil operacional separado para jornada/folha, sem misturar dados sintéticos
   nem habilitar escrita no histórico recuperado por efeito de um menu.
4. Implementar e homologar o contrato transacional de Compras antes de liberar recebimento.
5. Homologação externa de Redes Sociais somente após autorização e conexão oficial.
6. Pagamento e reabertura da folha exigem integração e testes próprios; cálculo fechado
   não executa pagamento nem desconto operacional automaticamente.

Não houve migração operacional, alteração da R4, deploy, merge ou publicação de
credenciais, anexos, bancos ou dados pessoais.

## Atualização instalada autorizada — 22/10/2026

Após autorização específica do responsável, somente a candidata de teste foi
atualizada para 0.6.0-rc.3. A R4 e demais instalações não foram substituídas.

- Instalador: `artifacts/ruy-windows-modulos-0.6.0-rc.3-20261022/Sistema-Ruy-Windows-Modulos-0.6.0-rc.3-20261022-Setup.exe`.
- SHA-256: `e4b3361f8dc67fbeae4966c022bd103e1fec06596c09bd251f82f53eb00893a4`.
- Backup cifrado novo concluído antes da troca, com zero operações pendentes;
  backups anteriores preservados.
- Fechamento normal da candidata confirmado: API e PostgreSQL próprios encerrados;
  nenhum processo foi forçado. Cópia fria de instalação, dados e perfil concluída:
  2.447 arquivos, 659.432.919 bytes, hashes conferidos em diretório privado.
- Instalação interativa feita pelo responsável, pois a ferramenta gráfica não está
  disponível nesta sessão. O pacote instalado foi conferido contra o artefato rc.3.
- Registro NSIS HKCU `626e4a81-2c25-5a85-90f9-3425fa3a3072` atualizado para rc.3,
  desinstalador por usuário, mesmo destino exclusivo da candidata.
- Nova janela criada/carregada pelo executável instalado; API 18144, PostgreSQL
  próprio 55494 e fonte histórica loopback 55463. Nenhuma porta exposta à internet.
- Bundle servido pela API idêntico ao instalado e sem o gráfico indesejado.
- Healthcheck e frontend 200; consultas sem sessão (inclusive capacidades e painel
  social) 401; comando com origem indevida 403; CSP presente.
- Identidade administrativa aprovada e sessão válida preservadas. Nenhuma senha
  redefinida e nenhum novo e-mail enviado.
- Fingerprints dos registros/anexos e agregados financeiros/estoque idênticos à
  restauração isolada: 1.186 registros, 63 colaboradores, 59 anexos, 54 vinculados
  e cinco em quarentena. Nenhum lançamento reexecutado.

Pendente: confirmação visual do responsável no Dashboard e nas consultas novas.
Não considerar a consulta homologada em laboratório equivalente à homologação
operacional dos módulos ainda bloqueados. Compras, integrações externas sociais,
pagamento/reabertura de folha e ativação de jornada no perfil histórico mantêm as
restrições documentadas acima. Não houve migração definitiva nem ativação operacional.
