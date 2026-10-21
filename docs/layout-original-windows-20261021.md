# Restauração do layout Windows — 21/10/2026

## Alteração e preservação

A entrada empacotada continua em `lab/d1/main.jsx`, usando a API local e os
adaptadores D1/C2 existentes. Não foi substituída pelo `src/App.jsx`, que contém
outro fluxo de autenticação. A apresentação reutiliza Layout, Sidebar, Topbar,
Home, StatCard e os cadastros originais de `src/`.

Antes das alterações, 44 arquivos locais foram copiados, com SHA-256, para um
snapshot privado fora do Git. Os dez arquivos da Etapa A e os 136 arquivos do
conjunto histórico foram novamente conferidos: nenhum foi alterado.

## Visual e navegação

- Dashboard é a rota `/` e `/Dashboard` após o login individual.
- Sidebar original, cores e grupos preservados, permanente a partir de 768 px;
  em telas menores, abertura pelo botão Menu. Teste real do renderer em 900 px.
- Topbar original, sem a faixa de atalhos de laboratório. Ferramentas Windows
  ficam no menu esquerdo, incluindo acessos, anexos, caixa e Delivery.
- Menus adicionais usam o mesmo contexto de autenticação. Ponto, escalas e folha
  permanecem bloqueados quando o banco não contém os contratos homologados.
- Rotas RH, vales, consumos, auditoria, relatórios e receitas reutilizam telas
  existentes. O servidor permanece responsável pela autorização.
- Home original recebe cartões e gráfico de CONTAGENS efetivamente consultadas
  pela fachada local. Não são saldos financeiros. Falhas aparecem como
  indisponíveis; não se preenche o painel com dados demonstrativos.
- Jornada não recuperada é explicitamente indisponível, sem indicadores fictícios.
- Tailwind passa a varrer também `lab/d1`, evitando classes ausentes no pacote.
- Corrigida a transição da janela administrativa: fechar o diálogo temporário
  não solicita o encerramento antes da criação da janela principal.

## Evidências executadas

- Lint; build principal; build D1: aprovados. Aviso não bloqueante de chunk grande.
- Teste PostgreSQL/HTTP/Electron: 9 verificações aprovadas, incluindo menu completo,
  ausência dos atalhos antigos na Topbar, Sidebar em 900 px, Dashboard, ficha,
  comprovante autenticado, financeiro, recarga e sessão após reinício da API.
- 1.186 registros, 63 colaboradores, 382 referências resolvidas; valores originais
  conferidos; 54 anexos com SHA-256; cinco em quarentena recusados. Zero efeitos
  financeiros/estoque executados no histórico. Fingerprint de origem inalterado.
- Autenticação: 23 verificações aprovadas nesta execução; transporte de e-mail
  simulado. Nenhum novo envio real foi autorizado ou executado.
- Brevo, proteção de rede e cálculo de folha: 20 testes automatizados aprovados.
- Estoque: 121/121. Regressão financeira: 9/9.

Esses testes de interface usam Electron de desenvolvimento com API e PostgreSQL
reais isolados. NÃO equivalem à aprovação da instalação NSIS autenticada.

## Candidata separada

`0.6.0-rc.2`, produto `Sistema Ruy - Layout Original 20261021`.
Namespace: `windows-layout-20261021`, API 18144, PostgreSQL de autenticação 55494,
perfil próprio; leitor histórico dedicado, sem escrita, na cópia de ensaio 55463.
Nenhuma instalação anterior foi substituída. Nenhum administrador automático.

A primeira montagem foi instalada interativamente, sem elevação, em
`%LOCALAPPDATA%/Programs/Sistema Ruy - Layout Original 20261021` e abriu pelo
atalho próprio a autorização administrativa. A senha e o consentimento são
inseridos somente pelo responsável. Login e aceite visual instalado pendentes.
A revisão detectou dois ajustes de navegação ainda ausentes nessa montagem;
o pacote `Final` é distinto e preserva a montagem anterior. Não atualizar a
instalação existente automaticamente.

Pacote final em `artifacts/ruy-windows-layout-0.6.0-rc.2-final-20261021/`.
SHA-256 e conferência de conteúdo ficam no relatório de integridade local.
Não versionar instaladores, dados, credenciais, anexos ou backups.

## Aceite ainda necessário

- Atualização controlada apenas da candidata separada para o pacote final;
  autenticação manual e conferência visual no executável instalado final.
- Fechamento/reabertura e backup/restauração independente pela interface instalada.
- Registro NSIS: não confundir existência do executável e do desinstalador com
  comprovação da chave de registro. Não foi feito reparo manual do registro.
- Operações históricas continuam somente leitura até autorização de ativação;
  ponto/folha sem fonte homologada não são habilitados por uma mudança visual.

R4, versão em uso, produção 8080, Supabase e dados históricos foram preservados.
