# Instalação da RC1 — somente homologação

Versão 0.5.1-rc.1, revisão A5-RC1-20261017. Não é versão operacional aprovada. A segunda máquina ainda não está identificada: **este roteiro está preparado, não executado**.

## Antes de instalar

1. Identificar Windows B, usuário/operador, acesso autorizado e janela. Confirmar Windows x64 e binários PostgreSQL 17 de origem aprovada; o instalador não contém PostgreSQL. Não acessar outra máquina nem mudar rede/firewall agora.
2. Usar somente dados fictícios, conta example.invalid, identidade/deviceId e credenciais próprias. Não copiar LOCALAPPDATA/GestaoRuy, cluster, perfil, DPAPI ou certificados privados de Pichau. Se existir laboratório na máquina, inventariar e preservar antes; não recriar ou apagar.
3. Receber o instalador por canal autorizado e comparar SHA-256 com o manifesto versionado. Não utilizar o executável parcial de uma tentativa de build falha.

Artefato local: `artifacts/agente5-rc1-20261017/Sistema-Ruy-A5-RC1-20261017-Setup.exe`.

SHA-256: `d7fb2cd129d2515a3481e01c56bcd6d1411e398eb3ec470e524c6b6940517f8f`.

Para verificar a cópia, usar Get-FileHash -Algorithm SHA256 no caminho recebido. O pacote não está assinado e deve permanecer restrito à homologação.

## Instalação limpa e primeiro uso

1. Abrir o instalador interativo, instalar apenas para o usuário de laboratório e selecionar diretório exclusivo. Não substituir a instalação operacional nem iniciar serviços em 8080. O instalador não executa o aplicativo automaticamente ao concluir.
2. AppId: br.ruy.gestao.agente5.homologacao; perfil: APPDATA/SistemaGestaoRuy-Agente5-Homolog. O laboratório de banco usa diretório privado LOCALAPPDATA/GestaoRuy/etapa-d1-lab, separado do operacional. Perfis e dados não são apagados pela desinstalação configurada.
3. Na primeira execução, fornecer os binários aprovados e conta fictícia independente pelo assistente. Confirmar o destino do laboratório antes de preparar qualquer cluster novo; se houver estado existente inesperado, interromper e preservar. Não executar initdb, resetwal ou remoção de WAL manualmente como correção.
4. Validar login, consulta, cadastro/edição/exclusão autorizada de colaborador fictício e cadastro de estoque. Fechar normalmente, aguardar API própria terminar e abrir novamente. Conferir dados e indicador de sincronização; nunca interpretar persistência local como confirmação global.

## mTLS e anexos: preparação por operador

O instalador mantém a sincronização remota desativada. Provisionamento não é automático nem depende de copiar chaves de outro Windows. O operador precisa de central/gateway de laboratório e schemas experimentais em bancos novos autorizados, além de principal/workspace já cadastrados. Não executar os SQL experimentais em bancos operacionais ou inicializar o servidor sobre um banco existente para tentar habilitar a função.

No checkout de ferramentas autorizado, definir RUY_D1_ALLOW_TESTS=1 e RUY_MTLS_PROVISION_FILE com caminho privado. Esse JSON contém actorId, deviceId, workspaceId, endpoint HTTPS, token do dispositivo, keyFile, certFile e caFile. Restringir ACL ao operador; não colocar conteúdo em chat, terminal, Git ou diretório público. Os caminhos apontam para certificados/chave próprios; SAN, CA, validade e EKU devem ser aprovados para o ambiente.

Executar `node scripts/d1-lab/provision-tls.mjs` apenas sobre o laboratório marcado do usuário. O script recusa certificado/chave incompatíveis, identidade divergente, papel insuficiente e sobrescrita de provisão existente. Grava um envelope DPAPI do usuário atual. Ele é ferramenta do checkout, não um assistente gráfico incluído no instalador.

Para o ensaio local provisionado, a equipe pode habilitar RUY_D1_MTLS_LAB=1 junto do opt-in. Anexos exigem separadamente RUY_D1_ATTACHMENTS_LAB=1 e as tabelas experimentais preparadas em banco novo. Não habilitar flags para uso diário. O protocolo foi testado por API; a experiência completa de anexar pelas telas ainda está pendente.

O destino padrão continua loopback, TLS 18443. O gateway TLS encaminha apenas rotas D1 para API interna 18092; PostgreSQL permanece inacessível remotamente. A rede entre máquinas, certificados de serviço e allowlist do aplicativo dependem da topologia/janela autorizadas. Não usar rejectUnauthorized=false, 0.0.0.0, encaminhamento de portas ou exposição à internet. Não desconectar a rede da empresa.

## Reinicialização, reinstalação e restauração — aceites pendentes

1. Registrar hashes/revisão, máquina/usuário/deviceId, operações e contagens, sem payload pessoal ou segredos. Fazer backup sintético cifrado e testar envelope de recuperação antes da janela.
2. Reiniciar normalmente somente Windows B de laboratório na janela autorizada; confirmar persistência, fila, conflitos, recibos e anexos/hash.
3. Desinstalar/reinstalar a RC no mesmo usuário, preservando o diretório de dados. Confirmar identidade e registros; não apagar pastas para forçar primeira execução.
4. Restaurar em destino isolado novo, com custódia autorizada da chave/envelope e provisionamento próprio. Conferir relações, arquivos/hash, outbox/cache/recibos/auditoria. Não copiar DPAPI de Pichau; testar frase incorreta, corrupção e falta da chave. Manter sincronização do restore desativada.
5. Somente o responsável autorizado altera o enlace exclusivo de laboratório durante o ensaio de desconexão/reconexão. Registrar fila antes/depois, mesmo UUID sem segundo efeito e propostas de conflito preservadas. A empresa continua conectada.

Os passos acima ainda não foram comprovados em outro Windows. Divergência de destino, erro de integridade, perda de relacionamento ou encerramento que não conclui exige preservar o estado e investigar, sem kill, reset de banco ou exclusão de arquivos.
