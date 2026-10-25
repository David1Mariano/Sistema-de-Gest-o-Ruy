# Sistema Ruy — candidata operacional 0.7.0-rc.1

Restrita à homologação. Não substitui rc.3 ou R4 e não autoriza lançamentos reais.

## Perfil e preservação

- Identidade estável: `windows-operational`; produto Windows: **Sistema Ruy**.
- API `127.0.0.1:18146`; PostgreSQL próprio `127.0.0.1:55496`, sem exposição externa.
- Programa previsto: `%LOCALAPPDATA%\Programs\Sistema Ruy`.
- Dados: `%LOCALAPPDATA%\GestaoRuy\installation-windows-operational`.
- Perfil Electron: `%APPDATA%\SistemaGestaoRuy-windows-operational`.
- Fonte histórica restaurada em outro banco dentro do cluster próprio, com usuário efetivamente somente leitura. Não depende da partida do cluster de recuperação 55463.
- Credenciais PostgreSQL, certificados, chaves e arquivos DPAPI próprios do novo perfil. O remetente Brevo previamente confirmado continua no backend, protegido por DPAPI; não houve novo envio real.
- Usuários e hashes scrypt-v2 foram recuperados de uma cópia cifrada preservada da candidata anterior. Aprovação e verificação existentes são mantidas. Não há promoção automática, senha padrão ou cópia de sessões/códigos temporários.

Os 1.186 registros e 59 anexos foram conferidos na fonte isolada: 63 colaboradores, 54 anexos vinculados e cinco em quarentena. Cadastros mestres usam os mesmos identificadores canônicos, com recibos auditáveis. Chaves técnicas por identidade preservam cadastros legados com nomes repetidos; nenhum registro foi mesclado para satisfazer uma restrição de unicidade. Dados financeiros históricos permanecem somente leitura, sem repetir pagamentos ou baixas. O pagamento cancelado com referência ausente é preservado.

`d1_workspace.activation_approved` permanece **false**. O papel da aplicação não pode alterar essa autorização. O servidor bloqueia gravações de negócio antes da aprovação expressa. Mesmo após aprovação, rejeita comandos anteriores ao corte e alterações de identidades históricas protegidas. Sincronização operacional entre computadores continua desativada.

## Liquidações locais

Folha: o registro exige cálculo fechado, fontes conferidas, conta, data e meio informado. O servidor reconcilia líquido, despesa, pagamento, descontos e partidas. O registro é único por origem; reenvio recupera o recibo e concorrência não duplica o pagamento. Estorno compensa o caixa, cancela os documentos vinculados e libera os descontos na mesma transação. Saldo insuficiente e conferência desatualizada recusam a operação inteira.

Delivery: cadastros e pedidos usam o contrato único existente. Recebimento é separado do estado de preparação e permitido após conclusão. Gera receita e partidas locais uma única vez. Estorno financeiro é explícito e compensatório. Cancelar pedido antes da conclusão não recebe dinheiro. Não há pagamento bancário, provedor externo ou baixa automática de estoque.

As telas de Folha e Delivery mostram conferência explícita antes de registrar os fatos financeiros. Caixa mostra a conciliação de documentos e partidas. Documentos liquidados por esses agregados não podem ser alterados por outra rota.

## Evidências automatizadas

| Verificação | Resultado | Ambiente |
|---|---|---|
| Liquidações, concorrência, replay, estornos, saldo insuficiente e rollback | 9 verificações aprovadas | PostgreSQL sintético novo |
| Jornada, folha, compras, recebimento/estorno Delivery e conciliação pela interface | 16 etapas aprovadas | HTTP + Electron de desenvolvimento |
| Autorização do perfil, corte e proteção SQL do histórico | 4 verificações aprovadas | Banco sintético novo |
| Fonte própria, contagens, bloqueio de ativação, backup conjunto e restauração | 6 verificações aprovadas | Cópia histórica isolada; sem operações reais |
| Autenticação individual | 23 verificações aprovadas | PostgreSQL e HTTP, e-mail simulado |
| Contratos Delivery, adaptador, cálculo, rede e Brevo | 28 testes aprovados | Contratos e transportes simulados |
| Espera de backup acima de dez segundos e propagação de falha | 2 testes aprovados | Encerramento assíncrono, sem processos externos |
| Estoque / financeiro integrado | 121 / 9 verificações aprovadas | Regressões sintéticas |

Lint e builds executados. Os 136 arquivos do manifesto original e os dez arquivos WIP da Etapa A foram verificados sem alterações.

O backup conjunto cifra banco operacional, usuários, novos recibos e fonte histórica com os anexos. A restauração cria bancos novos e inativos; não redireciona a aplicação. Contagens, estados recuperáveis e os 59 hashes dos anexos foram conferidos. Retenção automática não remove backups existentes nesta candidata.

## Executável e instalação: critérios ainda abertos

O executável empacotado abriu a tela de login e passou em visibilidade, minimização, recuperação fora da tela e segunda instância sem variáveis configuradas manualmente. O fechamento encontrou um limite inadequado de dez segundos para backup: o aviso modal interrompia o fluxo de fechamento enquanto o backup ainda não havia terminado.

A correção aguarda o backup assincronamente, sem modal durante a espera e sem encerramento forçado. A repetição do ciclo empacotado depende do encerramento normal da instância de teste que exibiu o aviso anterior. Este resultado não deve ser considerado instalação NSIS aprovada.

Não gerar o instalador final antes de repetir o fechamento empacotado. Não declarar aprovação operacional antes de instalar, fazer login individual, conferir Dashboard/menu/dados e reabrir a candidata. O controle gráfico não está disponível nesta sessão; os cliques de instalação e o login real exigem o responsável. Não solicitar senha ou código pelo chat.

## Identidade NSIS e atualização

AppId: `br.ruy.gestao.windows.operacional`. GUID exclusivo: `75c7b9b8-6d06-4bf1-89d1-4e566b45c050`. Instalação por usuário, interativa, sem elevação. O mecanismo NSIS existente confere o registro e o desinstalador por leitura. Não há alteração manual de registro.

Versões futuras devem manter AppId, GUID, namespace e caminhos de dados. Antes de atualizar: criar e verificar backup cifrado conjunto, preservar chave de recuperação por mecanismo seguro e registrar a versão de código. Depois: conferir acesso, contagens, anexos e persistência. Snapshot de código não substitui backup. Rollback deve preservar cópias e restaurar para um destino novo; não sobrepor banco existente automaticamente.

Atualização real, desinstalação, Windows limpo e uso em dois computadores não foram comprovados nesta rodada. Não tratar configurações NSIS ou testes de desenvolvimento como equivalentes a esses testes.
