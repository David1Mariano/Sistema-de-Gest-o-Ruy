# Backup Windows — laboratório D1

Na versão 0.2.0, o manifesto também inclui e confere dez tabelas de sincronização
e operações: bindings, queue, versões, inbox, shadow, saldos, movimentos, contas,
partidas e eventos. O teste de restauração compara esse conteúdo ao snapshot;
o banco recuperado continua fora da API e com sincronização desativada.

Implementado somente para dados sintéticos, sem serviço permanente. O Electron
executa uma cópia no início e periodicamente enquanto aberto; padrão 60 minutos,
24 cópias. Sem app aberto não há agendamento Windows em segundo plano.

Configuração privada opcional em
`%LOCALAPPDATA%\GestaoRuy\etapa-d1-lab\backup-settings.json`:

```json
{"enabled":true,"intervalMinutes":60,"retain":24}
```

Intervalo aceito: 1–1440 minutos. Retenção: 2–365 cópias. Uma única execução por
vez, por lock privado. Após crash, verificar se há backup ativo antes de recuperar
um lock residual; ele nunca é apagado automaticamente para contornar a proteção.

## Consistência e proteção

- Configuração valida Windows, DPAPI, home, máquina, cluster e banco D1; não recebe
  URL arbitrária. `pg_dump` usa papel restrito e snapshot exportado de uma transação
  repeatable read; fila e manifesto de operações vêm do mesmo snapshot.
- Schema `public` é o contrato do produto D1. Schemas de motores críticos de teste
  ficam fora da cópia. `d1_records`, `d2_catalog`, usuários, sessões, auditoria e
  outbox são incluídos. DDL de novas funcionalidades exigirá atualizar esse contrato.
- Arquivo `.ruybak` criptografado por AES-256-GCM, IV aleatório, autenticação e
  hashes SHA-256 de dump e anexos. Chave aleatória de 256 bits protegida por DPAPI
  fora do backup. Senha PG só no ambiente do subprocesso, nunca em argumento/log.
- Dump não é gravado em texto aberto no disco; tamanho total limitado a 64 MiB
  neste protótipo em memória. Não atende volume operacional sem avaliação/streaming.
- Anexos do laboratório: arquivos regulares imutáveis `FICTICIO-*` na pasta privada
  `attachments`, com nomes/tipos permitidos e hash. Diretórios redirecionados e
  symlinks de arquivos são recusados. Ainda não há upload/anexos pessoais offline
  integrado às telas nem sincronização de Storage privado.
- Escrita em `.partial`, flush e rename antes de registrar sucesso. Retenção só
  após cópia íntegra. Falhas são publicadas no estado separado de backup.

## Execução e restauração de teste

```powershell
node --require ./scripts/d1-lab/network-guard.cjs scripts/d1-lab/backup.mjs create
node --require ./scripts/d1-lab/network-guard.cjs scripts/d1-lab/backup.mjs restore-test NOME.ruybak
```

Restore aceita apenas arquivo da pasta privada de backups validada e gera nome
novo `ruy_d1_restore_<aleatório>`. Não aceita banco de destino do usuário. O banco
novo é criado antes de `pg_restore --clean --if-exists --single-transaction`;
essas opções nunca são aplicadas a D1, C1/C2 ou banco operacional. O schema public
padrão do banco vazio é substituído pelo schema do dump. Falhas preservam o banco
de teste para diagnóstico, sem limpeza automática de dados anteriores.

O teste confere UUIDs de todas as operações restauradas e bytes/hashes de anexos.
O banco restaurado não é registrado na API nem ativa sincronização. Roles/ACL
operacionais e recuperação de identidade exigem procedimento próprio; `--no-acl`
não pode virar restauração de produção automática.

## Limites ainda impeditivos para uso real

Destino externo e custódia independente da chave não foram definidos. A chave
DPAPI atual depende deste usuário/máquina; restauração em outro Windows ainda
não foi entregue. Backup no mesmo disco não protege de perda física, ransomware
ou comprometimento do administrador. Não há RPO/RTO operacional homologado nem
ensaio com volume real. **Proteção contra perda do computador: não concluída.**

Sincronização e backup são independentes: pendência é preservada no dump e nunca
marcada confirmada por restaurar um arquivo. Retomar envio após restauração real
dependerá de reconciliação de dispositivo, cursores e recibos centrais.
