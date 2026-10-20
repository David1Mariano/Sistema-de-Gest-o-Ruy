# I5 — diagnóstico da janela — 20/10/2026

Diagnóstico somente leitura da instalação, com correção preparada no worktree de integração. Não aplicada à instalação. Nenhum processo encerrado, perfil removido, reinstalação ou alteração de atalho.

- PID 32000 confirmado como I5 no diretório exclusivo autorizado. Processo responde; MainWindowHandle=0 e nenhuma janela acessível retornada por Computer Use. Isso não prova ausência de janela nativa oculta nem permite classificar minimização/posição com certeza.
- Atalho aponta para o executável e diretório corretos, WindowStyle=1 (normal), sem argumentos. O executável tem ASAR SHA-256 a6413ac2f5ded1efb13eeb0523ef68c2be8cc8eb14f58326eafd62e7bb39ac24, igual à candidata validada.
- A primeira abertura feita pelo agente usou WindowStyle Hidden, possível contribuição para o estado atual. O handler second-instance só faz restore se minimizado e focus; não chama show. Falha confirmada no mecanismo de recuperação de janela oculta.
- Há outra incompatibilidade confirmada de contrato: a I5 exige variáveis de laboratório, mas o atalho normal não as fornece. O PID existente mantém o ambiente da primeira execução. Uma inicialização nova pelo atalho comum não tem o mesmo ambiente. É necessário um lançamento de homologação específico, com configuração somente no processo e validação do marcador/máquina/porta, preservando o bloqueio operacional. Não definir variáveis globais nem relaxar o gate.
- Não há log persistente dedicado de inicialização da I5; console.error não foi capturado na abertura normal. Nenhum evento de crash correspondente foi encontrado na consulta ao log Application das últimas 24 horas. Não se conclui corrupção de perfil ou dependência ausente.
- A API I5 responde em 18091 (PID 13848); clone descartável 55437 (PID 34328). API antiga 18080/PID 22292 preservada. O laboratório antigo tem caminho windows-installation-lab, distinto da I5, e não será usado para homologá-la.

## Correção preparada, ainda não instalada

`desktop/window-visibility.mjs`: show explícito antes do foco, restore quando minimizada e reposicionamento se a barra de título não estiver acessível em nenhum monitor conectado. `desktop/main.mjs`: reapresentação após carregamento normal, segundo clique e ativação. Sem fechar processos, alterar dados ou limpar perfil.

Seis testes unitários aprovados: janela oculta, minimizada, monitor desconectado, segundo monitor ativo, janela maior que a área útil e janela inexistente/destruída. São testes com objetos simulados, não homologação do executável instalado. Lint registrado localmente em logs/i5-supervision/window-fix-lint.log.

## Próximos passos dependentes de autorização

1. Preparar o contrato de lançamento da próxima candidata para o atalho funcionar sem variáveis globais e sem atingir bancos compartilhados. Acrescentar logs sanitizados de fases para diagnosticar criação/show/erro de inicialização.
2. Solicitar autorização específica antes de qualquer tentativa de encerramento/reinício do PID 32000. Não há autorização para força, processos relacionados ou API antiga. Se não houver mecanismo normal disponível, preservar o processo e informar.
3. Gerar e validar candidata de correção com nova identificação/hash. Não substituir arquivos instalados nem reinstalar sem autorização própria.
4. Só então validar visualmente o atalho, inclusive segunda abertura, minimização, monitores, perfil existente, gate de laboratório e preservação de dados. O problema de abertura continua pendente no executável instalado.