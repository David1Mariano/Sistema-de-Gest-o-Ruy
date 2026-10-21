# Finalização Windows — execução de 21/10/2026

Não é liberação operacional. Nenhuma instalação existente foi substituída.

## Identidade

Brevo: um envio real aceito com HTTP 201, recebimento confirmado pelo responsável
e código consumido no servidor. Reutilização recusada com HTTP 400. Uma tentativa
de envio no ensaio aprovado; sem reenvio automático. Credencial e comprovação
armazenadas por DPAPI, fora do repositório. Verificar e-mail não aprova conta.

Gestão de acessos: adicionada rejeição explícita de cadastro pendente, inclusive
antes de confirmar e-mail. Exige administrador e CSRF; invalida códigos/sessões e
audita sem aprovar a conta. Revogação de contas já aprovadas conserva a rota
existente. Os 23 testes anteriores foram preservados; a suíte agora passou em
24 verificações, incluindo Electron de desenvolvimento, com transporte simulado.
O teste simulado não substitui a evidência Brevo real descrita acima.

## Dados recuperados nas telas normais

Uma NOVA cópia de importação foi criada no cluster isolado de recuperação 55463,
com backup cifrado e restauração em outro banco novo aprovados pelo procedimento
existente. Nenhuma conexão ao Supabase ou banco da R4 foi alterada.

O adaptador `operational-history.mjs` atende os contratos normais de entidades,
catálogos e documentos. Não transfere os registros para a conta do operador:
usa concessões explícitas, administrador autorizado e leitor PostgreSQL próprio
sem DML. Autenticação sintética de teste reside em OUTRO banco (55483), sem
cadastros sintéticos de negócio no banco importado.

- 1.186 registros conciliados, incluindo 63 colaboradores.
- 382 vínculos resolvidos com IDs canônicos na projeção; IDs legados preservados.
- Valores originais permanecem intactos; saldo histórico não é substituído por
  zero quando não existe movimento operacional novo.
- 54 anexos autorizados tiveram download e SHA-256 conferidos.
- Cinco anexos permanecem em quarentena e retornam 404.
- Pagamento cancelado com referência ausente continua sinalizado; nenhum
  documento fictício foi criado para conciliá-lo.
- Escritas e sincronização são recusadas neste perfil de conferência; isso NÃO
  representa ativação operacional dos documentos históricos.
- Rotas da lista e ficha individual de colaboradores, setores e estoque foram
  exercitadas no Electron de desenvolvimento com dados recuperados. Navegação
  financeira e recarga da sessão também foram verificadas. Não equivale a todos
  os filtros/ações financeiras, instalação NSIS ou atualização homologada.

Nove verificações de integração passaram: autenticação/concessão, contagens,
vínculos, valores, anexos/quarentena, comandos bloqueados, leitor sem escrita,
reinício HTTP e telas Electron. Fontes e fingerprints permaneceram intactos.
As versões exatas dos relatórios ficam na pasta protegida de recuperação,
nunca no Git. Não há exposição de nomes, CPFs ou valores individuais aqui.

## Ponto e escalas

Contratos acrescentados ao mecanismo D1 existente, sem banco paralelo:
Schedule, StandardSchedule, TimeRecord, Absence e Warning. Provisionamento
`attendance.sql` recusa bancos fora de fixtures NOVAS `ruy_d1_rc_*` na 55483.
Não é migration para bases existentes. Disponibilidade da tela depende do
status efetivo do schema; ausência de schema não é tratada como módulo pronto.

O servidor valida referências, datas, horários, conflitos, duplicidades e CAS,
e calcula jornada/atrasos com tolerância configurável. Ajuste de uma marcação
existente exige justificativa. Ocorrência e sinalização da escala são gravadas
na mesma transação. Snapshots de auditoria não são atualizáveis pela role app.

Nove testes PostgreSQL/HTTP sintéticos passaram, incluindo rollback, concorrência,
idempotência, login individual, CSRF e reinício da API. Não houve efeito de
pagamento ou estoque. Jornadas noturnas exigem contrato específico e continuam
recusadas. A implementação não presume descontos legais ou vínculo trabalhista.

## Critérios ainda abertos

- Provisionamento supervisionado do primeiro administrador no perfil Windows
  completo, sem promover automaticamente a conta do teste de e-mail.
- Uso editável de cadastros migrados e regras de abertura de saldos aprovadas;
  documentos históricos continuam protegidos contra reaplicação de efeitos.
- Folha por período com regras configuráveis, rastreabilidade e fechamento
  transacional; não declarar concluída pela existência do formulário financeiro.
- Homologação das telas de ponto/escalas, cálculos/fechamentos financeiros e
  comprovantes com a interface final.
- Instalador, instalação/desinstalação descartável, atualização e restauração
  independente. R4 não foi reinstalada ou substituída.
- Dois Windows, rede real, certificados e conectores externos exigem ambiente
  e autorizações próprios; não são necessários para testar consulta local.

## Execução reproduzível

Definir `RUY_D1_INSTALLATION=final-dev-20261021`, `RUY_D1_ALLOW_TESTS=1` e
`RUY_D1_TEST_API_PORT=18133`. Nenhuma API anterior deve ser encerrada para testes.

- `RUY_IDENTITY_ACCEPTANCE=1`: `node scripts/d1-lab/test-identity.mjs`.
- `RUY_ATTENDANCE_ACCEPTANCE=1`: `node scripts/d1-lab/test-attendance.mjs`.
- `RUY_OPERATIONAL_SCREEN_ACCEPTANCE=1`:
  `node scripts/recuperacao/test-operational-screens.mjs <nova-copia-importada>`.
  O leitor é próprio e as contas técnicas são criadas apenas no banco de auth
  sintético separado. Definir `RUY_OPERATIONAL_ELECTRON_EXE` para incluir UI.
- `node --test scripts/d1-lab/test-brevo.mjs` não envia e-mail real.

Nunca executar novamente o helper de prova Brevo sem autorização de envio.
