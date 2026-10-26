# Sistema Ruy: laboratório multicomputador — 26/10/2026

## Estado e limites

Implementação em `agente-5-multicomputador-20261026`, baseada em `dcd2455`. Nenhuma instalação existente foi conectada ao servidor compartilhado. Nenhum acesso ao RUI-PC-ESTOQUE, alteração de firewall ou rede da empresa foi realizado. O usuário identificou essa máquina na mesma rede Wi-Fi, mas exige autorização específica antes de acesso, instalação ou configuração.

O laboratório usa uma fonte PostgreSQL central e dois bancos de clientes distintos. Reutiliza filas, recibos, versões, reconciliação e anexos D1/C2. Não cria dois bancos operacionais autoritativos. Propostas locais só se tornam confirmadas após aceitação central. A instalação atual 0.7.1-rc.1 continua local e preservada.

## Componentes e segurança

- `shared-sessions.mjs` reutiliza a identidade existente, com senha scrypt, confirmação e aprovação administrativa. Exige usuário, vínculo ao workspace e dispositivo ativos; não promove o primeiro usuário.
- `shared.sql` guarda vínculos e sessões centrais; aplicado somente em bancos sintéticos novos.
- `shared-server.mjs` exige opt-in de laboratório e banco sintético identificado. A fachada fica em loopback; acesso dos clientes passa pelo transporte mTLS existente. Certificado de dispositivo, token do dispositivo e sessão individual são obrigatórios.
- Escritas revalidam a autorização dentro da transação. Leitores recebem projeção restrita, sem campos pessoais adicionais nem eventos financeiros. Revogação, expiração e logout são conferidos no servidor.
- `shared-policy.mjs` restringe o contrato `RUY-SHARED-LAB/1`: catálogos sintéticos e despesa pendente sem efeitos financeiros. Pagamentos, liquidações de folha, baixa de estoque e recebimentos Delivery não são liberados por snapshots.
- `sync-supervisor.mjs` agenda a sincronização persistente existente, com repetição limitada, estados de conexão e encerramento que aguarda a operação própria. Intervalo padrão de dois segundos; não há eventos push/SSE implementados nesta entrega.
- Anexos usam o armazenamento e os controles SHA-256 existentes, sem mecanismo paralelo.

O contrato ainda é D1LAB/1 e aceita dados sintéticos. Não é autorização para habilitar os dados reais nesse protocolo. As liquidações modernas de folha/Delivery e a propriedade compartilhada dos registros ainda precisam de adaptação transacional antes da ativação operacional.

## Evidências reproduzíveis

No projeto oficial, em PowerShell, apenas para o laboratório de desenvolvimento já provisionado:

```powershell
$env:RUY_D1_INSTALLATION='final-dev-20261021'
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_TEST_API_PORT='18133'
$env:RUY_SHARED_LAB='1'
node --test scripts/d1-lab/test-shared-policy.mjs
node scripts/d1-lab/test-shared-central.mjs
```

Os testes criam bancos novos e descartáveis no cluster de desenvolvimento 55483, sem migrations no banco instalado ou no compartilhado 55436. O gateway do teste é loopback 18584 e o TLS usa uma porta loopback disponível. Não copiar essas portas para a rede operacional.

| Verificação | Resultado e alcance |
|---|---|
| Política offline e supervisor | 3 testes aprovados; sem sobreposição, parada aguarda ciclo, recuperação e estados |
| Integração central | 14 cenários aprovados com PostgreSQL e mTLS reais, dois bancos de clientes e um central |
| Propagação automática | A cria, B consulta; B edita, A converge por polling |
| Reconexão | Falha de transporte simulada; proposta persistente e resposta perdida após commit sem duplicação |
| Concorrência de cadastros | Conflito preservado, plano desatualizado recusado, resolução explícita e arquivo imutável da proposta |
| Estoque e financeiro centrais | Primitivas existentes testadas diretamente: concorrência, obrigação duplicada, insuficiência e rollback parcial. Não equivale a liberar esses comandos no novo cliente |
| Anexos | Bytes reais sintéticos, hash, autorização e reenvio idempotente |
| Segurança | Certificados inválidos/ausentes, troca de dispositivo, usuário sem aprovação, leitor, revogação, expiração e logout |
| Backup central e clientes | Arquivos cifrados restaurados em outros bancos novos; comparação de todas as tabelas, filas e arquivos de reconciliação |
| Windows instalado e dois computadores físicos | PENDENTE; os testes acima são processos/bancos independentes no Pichau, não duas máquinas |

Logs locais sanitizados: `logs/mcp-audit/shared-reconciliation-proof.log`, `shared-lint.log`, `shared-build.log` e `shared-d1-build.log`. Logs, bancos, certificados e backups não pertencem ao Git.

## Inventário e proteção da instalação atual

Inventário somente leitura do workspace atual realizado por `scripts/recuperacao/inventory-current-workspace.mjs`, em transação consistente. Resultado no momento da consulta:

- `d1_records`: 86, sendo 63 colaboradores, 17 funções e seis setores.
- `d2_catalog`: seis, sendo cinco categorias de despesa e um item de estoque.
- 92 masters importados e 1.094 guardas históricos. Esses conjuntos se sobrepõem ao histórico; não somar 92 aos 1.186 registros.
- Histórico separado: 1.186 registros e 59 anexos; 54 vinculados e cinco em quarentena.
- Um saldo de estoque; nenhuma movimentação, liquidação, entrada financeira, folha ou fila de sincronização registrada nas tabelas verificadas naquele instante.

Isso não dispensa novo inventário no corte: todo cadastro ou movimento posterior deve integrar a conferência. Não presumir que 1.186 represente o total operacional futuro.

Um novo backup cifrado da instalação atual foi verificado e restaurado em bancos novos independentes, preservando os backups anteriores. Evidência sanitizada em `shared-current-backup.log`; relatório detalhado protegido no diretório de dados, fora do Git. A recuperação em outro Windows com mecanismo independente de proteção de chaves continua pendente; DPAPI do Pichau não deve ser copiado como se fosse portátil.

## Corte futuro e rollback — ainda não autorizado

1. Confirmar o host central e disponibilidade: fechar a interface Pichau não pode derrubar a fonte usada pelo segundo computador. A supervisão central independente ainda precisa ser preparada e homologada.
2. Obter autorização antes de conectar instalações. Congelar escritas durante corte aprovado; repetir inventário e backup PostgreSQL/anexos/configuração, registrar hashes e snapshot de código.
3. Provisionar banco central novo e importar baseline com IDs/mapeamentos auditáveis, sem chamar comandos que repetem pagamentos, baixas ou estornos. Preservar a exceção do pagamento cancelado sem despesa e a quarentena dos cinco anexos.
4. Conferir registros atuais e históricos, referências, valores agregados, anexos e permissões. Conservar as origens sem alteração.
5. Provisionar clientes com o mesmo workspace, sem criar empresa/banco autoritativo independente. Registrar versão do contrato; versões desconhecidas são recusadas. Não liberar operações críticas até seu protocolo estar homologado.
6. Em falha, interromper novas escritas e preservar filas/recibos antes de retornar ao perfil anterior. Nunca alternar fontes com operações pendentes nem reproduzir efeitos financeiros do baseline.

Snapshots de código não substituem backups. Cada atualização deve preservar dados fora da pasta do programa, testar compatibilidade de versões mistas e restaurar uma cópia antes da aprovação. Backup central não recupera propostas ainda não enviadas: backups dos clientes também são necessários.

## Homologação física e provisionamento

Antes de qualquer acesso ao RUI-PC-ESTOQUE, obter autorização específica. Sem desconexões físicas ou alterações de rede nesta fase.

Preparar endpoint HTTPS em interface privada autorizada, certificado com SAN correto e confiança validada. Nunca expor PostgreSQL à rede/internet. Qualquer regra de firewall exige autorização. Cada dispositivo gera sua própria chave/CSR e usa proteção local; somente certificado público e pedido de vínculo devem chegar ao provisionador. Não distribuir credenciais PostgreSQL, chave Brevo, senha administrativa ou chaves privadas no instalador.

O futuro cliente Windows precisa de modo compartilhado explícito: login central, identificação do dispositivo, estado de sincronização/desatualização, cache e fila autorizada, preservação de conflitos e bloqueio de operações críticas offline. Esse modo ainda não está integrado ao aplicativo instalado. O instalador local 0.7.1-rc.1 não deve ser apresentado como instalador multicomputador; nenhum novo instalador foi produzido nesta fase para mascarar essa pendência.

Depois de homologar esse cliente e autorizar sua instalação, testar com dados fictícios: criação A→B, edição B→A, despesa pendente, edição simultânea, estoque/produção transacionais, perda/reconexão de transporte autorizada, reenvio, permissões por usuário/dispositivo, anexos nos dois lados, reinício/atualização e restauração independente. Confirmar ausência de perda e duplicação antes de qualquer ativação com dados reais.

## Bloqueios para entrega operacional

1. Adaptar comandos críticos modernos e propriedade compartilhada sem substituir ator de auditoria ou duplicar efeitos.
2. Integrar e testar o modo cliente compartilhado no Electron empacotado; o supervisor de laboratório ainda não está conectado à interface instalada.
3. Provisionamento seguro de dispositivos e supervisão central independente, inclusive recuperação de chaves em outro Windows.
4. Pacote cliente compatível, autorização para acesso/instalação no RUI-PC-ESTOQUE e homologação física.
5. Aprovação expressa do corte operacional após reconciliação final e rollback validado.

Nenhum desses bloqueios é resolvido apenas copiando o banco ou o instalador atual para o segundo computador.
