# Homologação em dois computadores Windows — procedimento preparado

Status: **não executado**. O usuário autorizou apenas Pichau e ambientes simulados até identificar a segunda máquina. Não acessar computadores nem desconectar a rede da empresa nesta fase.

## Pré-condições obrigatórias para agendar

1. Identificar máquina B, operador responsável, acesso autorizado e janela específica. Usar duas estações de laboratório, sem dados reais, sem apontar à produção/Supabase e sem usar os clusters operacionais.
2. Separar a rede de ensaio da rede da empresa. O software atual restringe o transporte à interface loopback; antes do ensaio físico é necessário aprovar e validar um transporte de laboratório entre máquinas (origem, TLS/certificado, allowlist e autenticação por dispositivo). Não ampliar listen_addresses/firewall ou desativar barreiras por conta própria.
3. Instalar a mesma revisão experimental, registrar SHA-256 dos executáveis/ASAR e preparar dados/configurações novos por máquina. Não copiar arquivos DPAPI nem reutilizar identidade/deviceId de Pichau. Confirmar backup e restauração sintéticos antes de começar.
4. Criar contas e workspace sintéticos, provisionar cada dispositivo individualmente; senhas/tokens ficam apenas no canal privado aprovado, sem logs/chat/CLI. Deixar sincronização operacional desativada.

## Sequência e aceites

| Ensaio | Ação e evidência exigida |
| --- | --- |
| Identidade e permissões | Confirmar IDs distintos de dispositivo, workspace correto, papel admin/viewer; POST direto de viewer negado. |
| Cadastro/edição | A cria funcionário fictício; B consulta após sincronização explícita; B edita; A recebe. Conferir IDs, dados, versões e auditoria no servidor. |
| Exclusão | Sem vínculo: confirmar EXCLUIR em A, tombstone e auditoria únicos, registro ausente nas consultas de B. Com vínculo em qualquer máquina: bloquear ou registrar conflito sem apagar cadastro/histórico. |
| Desconexão física | Somente responsável na janela autorizada interrompe o enlace exclusivo de laboratório de A. Empresa/produção permanecem conectadas. A cadastra/edita fictícios, fecha e reabre app; fila deve permanecer e indicador não pode declarar sucesso. |
| Reconexão | Restabelecer enlace autorizado; enviar explicitamente, verificar recibos/cursor e dados em B. Repetir mesmo UUID sem segundo efeito. |
| Concorrência | Editar mesma versão em A/B; um commit e um conflito, duas propostas preservadas. Testar exclusão concorrente com vínculo criado remotamente. Não resolver automaticamente por horário. |
| Reinicialização | Reiniciar controladamente a API de teste e depois somente o PostgreSQL descartável exclusivo da janela; nenhum outro trabalho pode usar esse cluster. Conferir fila, sessões conforme contrato, tombstones e recibos. Sem encerramento forçado ou manipulação de WAL. |
| Recuperação | Backup consistente e criptografado; restore em banco novo da máquina B com custódia de chave aprovada. Conferir registros, versões, relacionamentos, anexos/hash, outbox, recibos, cursor e auditoria; não iniciar sync do restore automaticamente. |

Registrar por ensaio: revisão/hash, horário de São Paulo, máquina/dispositivo, fixture, IDs de operação, status HTTP, versões antes/depois, contagens e digest; nunca payload pessoal, senha ou token. Preservar evidências e bases sintéticas.

Interromper se houver destino inesperado, dados reais, perda de rastreabilidade, duplicação, sobrescrita silenciosa, erro de disco, vínculo órfão ou ausência de backup restaurável. Não usar pg_resetwal, initdb sobre cluster existente, exclusão de WAL, remoção de PID, restart da máquina ou deploy como tentativa de correção.

Liberar qualquer uso operacional somente com a matriz completa, revisão das permissões/autoridade de dados e aceite explícito do proprietário. Ausência da máquina B mantém o item PENDENTE.
