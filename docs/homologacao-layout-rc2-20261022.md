# Homologação supervisionada 0.6.0-rc.2 — 22/10/2026

Status: ATUALIZAÇÃO INSTALADA CONFIRMADA. Aceite visual PENDENTE; não aprovada para operação.

Pacote autorizado: `artifacts/ruy-windows-layout-0.6.0-rc.2-final-20261021/Sistema-Ruy-Windows-Layout-0.6.0-rc.2-Final-20261021-Setup.exe`.
SHA-256: `0a05e32f2396d0e8342af4c2085a934493a5a6f2d2846eb6bd9d1240240ec59a`.
Produto e appId próprios, iguais aos da candidata de teste, diferentes da R4.
Destino exclusivo: `%LOCALAPPDATA%/Programs/Sistema Ruy - Layout Original 20261021`.
Atalho: `Sistema Ruy - Layout Original 20261021`.

## Concluído antes de atualizar

- Snapshot privado da instalação, perfil e banco frio: 1.549 arquivos, 481.106.959
  bytes, cópias com SHA-256 conferido e ACL restrita ao usuário.
- Novo backup cifrado do banco da candidata, sem retenção destrutiva.
- Restauração em banco novo: identidade administrativa e hash de senha iguais
  aos da origem; nenhuma senha foi solicitada, exibida ou redefinida.
- Backup histórico cifrado restaurado em banco novo, sem ativação: 1.186 registros,
  63 colaboradores, 59 anexos com SHA-256 correto, 54 vinculados e cinco em quarentena.
- Fonte histórica verificada com transaction_read_only=on.
- Backend temporário da candidata: healthcheck 200, consulta sem login 401;
  encerramento normal da API e do PostgreSQL da candidata iniciados pelo teste.
- 20 testes automatizados de transporte, Brevo simulada e cálculo: aprovados.
- Backup adulterado em memória: recusado. Original não modificado.
- Manifesto original: 136 arquivos inalterados. Etapa A: dez WIP inalterados.

## Falha de infraestrutura encontrada

A fonte histórica 55463 estava indisponível; a candidata registra falha na etapa
API. O cluster identificado do ensaio foi iniciado sem alteração de configuração,
com recuperação automática concluída e sem reset de WAL ou encerramento forçado.
Após isso, o leitor e o backend puderam iniciar. O arranque autônomo dessa fonte
após reinicialização do Windows permanece um bloqueio para aprovação operacional.
Nenhum serviço global ou instalação anterior foi modificado.

## Etapa interativa pendente

Nesta sessão não há node_repl/sky disponível para operar o Windows. O instalador
foi aberto normalmente, sem elevação nem parâmetros silenciosos. O responsável
foi orientado a selecionar apenas Pichau e confirmar o destino antes de Instalar.
Não se declarou que a atualização terminou nem que o login gráfico foi testado.

Após concluir: conferir hash do app.asar instalado contra o pacote final; abrir
pelo atalho; efetuar login manual sem compartilhar senha; conferir Dashboard,
Sidebar, Topbar, módulos, ficha e comprovantes; fechar/reabrir e conferir sessão
conforme a política. A restauração técnica não substitui a homologação da UI.

## Procedimento operacional proposto, ainda não autorizado

1. Concluir aceite da candidata instalada e resolver dependência de partida da
   fonte histórica e pendências de registro NSIS.
2. Definir escopo de módulos e quais dados poderão receber novas operações.
   O histórico recuperado permanece sem reexecução de pagamentos ou estoque.
3. Produzir novo backup cifrado de banco, anexos, configurações e chaves de
   recuperação; validar restauração independente e preservar pacote anterior.
4. Somente após autorização final: fechar normalmente a instalação escolhida,
   atualizar exclusivamente seu caminho/identidade, validar compatibilidade de
   schema sem migração destrutiva e fazer conferência antes de liberar escrita.
5. Se houver divergência, manter operação bloqueada e executar rollback
   supervisionado; não restaurar sobre dados novos sem análise e autorização.

Não executar essa atualização operacional, deploy, merge, migração definitiva,
lançamentos reais ou mudanças na R4 com base neste documento.

## Atualização confirmada e verificações posteriores

O responsável informou que concluiu a instalação e abriu o aplicativo. A
verificação técnica confirmou o app.asar instalado idêntico ao pacote final:
`347378762000a1d6543b75fca65be411b5995664f66b7b9a85a688f601bd1e07`.
O bundle servido pela API também corresponde ao bundle instalado.

Registro NSIS encontrado em HKCU, chave de desinstalação
`626e4a81-2c25-5a85-90f9-3425fa3a3072`, produto 0.6.0-rc.2, desinstalador com
`/currentuser` e caminho exclusivo da candidata. Não houve reparo manual.
A pendência anterior de localizar essa entrada está resolvida nesta instalação.

Logs confirmam janela criada/carregada, fechamento normal completo e nova
abertura pelo atalho, sem nova autorização administrativa. A API é filha do
processo instalado da candidata. API 18144 e PostgreSQL 55494 usam loopback;
a fonte histórica separada usa loopback 55463. Não houve encerramento forçado.

Após a atualização: uma conta administrativa verificada/aprovada e uma sessão
válida. Os fingerprints de registros e anexos e os agregados financeiros e de
estoque são iguais aos da restauração isolada validada. Nenhum dado foi corrigido,
recalculado ou relançado.

Segurança da API instalada: healthcheck e frontend 200; sessão, colaboradores,
financeiro e anexo sem autenticação 401; comando com origem indevida 403; CSP
presente. Nenhum novo e-mail enviado. Backup automático cifrado concluído com
zero operações pendentes e sem rotação destrutiva. Esse backup local não
substitui o arquivo histórico cifrado separado nem uma cópia externa.

Continuam pendentes de confirmação manual: Dashboard e Sidebar efetivamente
visíveis após login, navegação de todas as telas, ficha e comprovante na UI.
A ferramenta de controle gráfico continua indisponível. O responsável recebeu
uma instrução curta para confirmar a primeira etapa. Não substituir esses
resultados por testes de harness nem declarar homologação completa.

Critério de operação ainda bloqueado: inicialização autônoma da fonte histórica
após reinício do Windows; aprovação de escrita sobre dados recuperados; aceite
manual das telas e procedimento completo de recuperação do conjunto. Não houve
ativação operacional.
