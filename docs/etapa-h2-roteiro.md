# Homologação H2 — aplicativo 0.5.0 H1

Estado inicial: **outro Windows, reboot real e backup em dispositivo físico
independente pendentes**. Preencher `ficha-h2.json`; nunca converter observações
automáticas em aprovação manual. Usar somente cadastros FICTICIO e conta
`@example.invalid`. O pacote contém o instalador H1 original, sem recompilação.

## Preparar o destino

1. Utilizar outro Windows 10/11 x64, separado do ADM-RUY. Registrar versão/build,
   responsável e identificação não sensível. Nenhuma máquina remota foi presumida.
2. Extrair todo o ZIP em pasta de homologação. Conferir o SHA-256 do ZIP recebido
   com a entrega e executar `powershell.exe -NoProfile -File .\Verify-Package.ps1`.
   O instalador deve ter hash
   `4e65feaa43612911494863f1f6689dc868960e1c86fdc8b6f73029ece9937c91`.
   O pacote não é assinado. Respeitar a política de execução do computador;
   não desativar antivírus, SmartScreen, assinatura ou políticas para aprová-lo.
3. Preparar PostgreSQL **17 x64 completo**, de origem confiável, com `bin`, `lib`,
   `share` e runtimes da distribuição. O app verifica executáveis e versão na
   primeira preparação; existência dos arquivos não comprova suas dependências.
   Não instalar serviço permanente sem autorização. Electron/Chromium/Node/pg
   estão empacotados; **não há dependência separada de Edge WebView2**, npm ou Git.
   A compatibilidade em cada Windows deve ser constatada pela execução real.
4. Executar antes de instalar (ajustar caminho se necessário):

   ```powershell
   powershell.exe -NoProfile -File .\Collect-H2.ps1 -Stage AntesInstalar -PostgresBin 'C:\Program Files\PostgreSQL\17\bin'
   ```

   Portas 18087 e 55436 devem estar livres em perfil novo. Não encerrar processos
   desconhecidos para liberá-las. Não abrir firewall público. Escolher instalação
   por usuário em diretório exclusivo. Nunca selecionar a produção ou instalar
   sobre outro produto. O instalador não apaga dados privados na desinstalação.

## Instalar e verificar interface/offline

5. Executar `Sistema-Gestao-Ruy-Lab-0.5.0-H1-Setup.exe`. Confirmar atalhos Área de
   Trabalho e menu Iniciar com sufixo **Homologação H**, janela própria e versão
   H1. Abrir pelo ícone, sem terminal nem checkout. Se não existir laboratório,
   selecionar `bin` do PostgreSQL e criar conta fictícia com senha >=12 caracteres.
   Não copiar `.env`, `.dpapi`, cluster ou credenciais de outra máquina. Pasta
   parcial/existente deve ser preservada e diagnosticada, sem reinicializá-la.
6. Executar `Collect-H2.ps1 -Stage AposAbrir`. Esperado: saúde `ruy-d1-lab`, modo
   `synthetic-only`, `syncEnabled=false`; `/api/d1/me` sem cookie retorna **401**;
   origem estrangeira retorna **403**. Ambas as portas escutam apenas 127.0.0.1.
   O coletor usa GET local sem sessão e não lê credenciais ou dados dos cadastros.
7. Criar setor, função e colaborador FICTICIO. Criar vale de R$10 e consumo
   sintético compatível com as opções da tela. Consultar, filtrar, editar e abrir
   histórico; conferir vínculo ao colaborador. Registrar IDs, versões, totais e
   número de pendências na ficha, sem senha/cookie/dados pessoais. Fotografar
   somente telas com dados fictícios. Repetir para contratos já portados da
   matriz abaixo. Não executar pagamento externo ou baixar caixa operacional.
8. Fechar pelo menu Sair e abrir pelo mesmo atalho. Conferir os mesmos dados,
   histórico e fila. Informar explicitamente se a sessão persistiu ou exigiu novo
   login: sessão expirada exige autenticação, não perda de dados. A conta local
   previamente criada deve entrar sem internet; isso não homologa autorização
   empresarial offline, expiração/revogação global ou sincronização de usuários.
9. Desligar internet **somente no Windows de homologação**; manter loopback ativo.
   Repetir login, criação, consulta e edição. Fechar/reabrir e conferir fila. Não
   desligar a rede do ADM-RUY. Nuvem deve indicar pendências/estado desconhecido,
   nunca confirmação verde operacional. Não configurar Supabase nem central real.

## Reboot real — ação manual autorizada

10. Registrar dados/IDs/versões/fila e executar `Collect-H2.ps1 -Stage AntesReboot`.
    Fechar o app. Obter autorização do responsável **para o Windows de destino**,
    registrando data e responsável na ficha. Reiniciar manualmente pelo Windows.
    Os scripts não têm comando de reboot. Não reiniciar o ADM-RUY.
11. Sem internet, abrir pelo atalho. PostgreSQL/API devem iniciar, sem serviço
    permanente; não iniciar scripts de desenvolvimento. Esperar a recuperação:
    após crash o PostgreSQL pode levar até 180 s por fase. Não apagar banco,
    `postmaster.pid`, lock ou cluster, nem desabilitar fsync. Usar o menu de
    tentativa de recuperação caso o limite automático se esgote e registrar falha.
12. Entrar com a mesma conta, conferir dados/fila/histórico e executar
    `Collect-H2.ps1 -Stage AposReboot`. Comparar `machineHash` igual e
    `lastBootUtc` diferente/mais recente entre os dois JSONs; isso é evidência de
    boot, não prova dos registros. Preencher aceite visual e funcional separado.
    PostgreSQL pode continuar como processo privado após fechar o app; API própria
    encerra com ele. Não há serviço nem inicialização automática com o Windows.

## Backup independente e recuperação

13. Escolher HD externo/outra unidade **em outro dispositivo físico**, protegido,
    com espaço e custódia definidos. Outra letra/partição do mesmo disco não basta.
    Execute `Collect-H2.ps1 -Stage AposAbrir -ExternalDirectory 'E:\Ruy-H2'` usando
    pasta existente. `same-disk-rejected` impede aceite; `different-disk-candidate`
    ainda exige confirmar topologia/custódia e restaurar. Rede/RAID/Storage Spaces
    exigem verificação manual; o coletor nunca declara proteção concluída.
14. Pelo menu Laboratório, configurar destino de cópia e criar backup criptografado.
    Registrar caminho e SHA-256 da cópia local e da externa; ambas devem coincidir.
    Exportar `.ruykey` pelo menu, com frase forte >=16 caracteres. Guardar frase
    por meio independente do PC e dos arquivos, sem colocá-la em ficha, CLI ou log.
    Guardar mais de uma cópia protegida da chave; não enviar chave/backup com a ficha.
15. Verificar somente identidade da cópia (não substitui decriptação):

    ```powershell
    powershell.exe -NoProfile -File .\Test-BackupCopy.ps1 -LocalBackup 'C:\CAMINHO\arquivo.ruybak' -ExternalBackup 'E:\Ruy-H2\ruy-d1-ID\arquivo.ruybak' -RecoveryKey 'E:\Chaves\laboratorio.ruykey'
    ```

    A chave é envelope protegido AES-256-GCM/scrypt; o script só verifica formato
    e hashes, sem pedir frase nem decriptar. Retenção externa acompanha a local
    (padrão 24); `externalRetain` privado permite 2–365. Não editar configurações
    reais. Em perfil sintético recém-criado, o técnico pode testar retenção 2 com
    três backups novos: restam dois na subpasta `ruy-d1-<deviceId>`. Apenas cópias
    antigas autenticadas da mesma origem são elegíveis. Não reduzir retenção de
    um perfil herdado para facilitar o teste; arquivos G na raiz são preservados.
16. Na instalação isolada de destino, usar menu “Restaurar backup externo em banco
    isolado”, selecionar `.ruybak` e `.ruykey`, informar frase pela janela protegida.
    Esperado: banco novo `ruy_d1_restore_*`, sem substituir ativo, 12 tabelas,
    anexos sintéticos e operações pendentes conferidos. A fila restaurada não é
    ativada nem sincronizada. Registrar mensagem/contagens e identidade de origem.
    Anexos desta versão são fixtures `FICTICIO-*` imutáveis; o fluxo completo de
    anexos privados na interface continua indisponível. Não usar anexo real.
17. Frase incorreta e cópia adulterada (somente duplicata descartável do teste)
    devem falhar sem substituir banco. Repetir com originais corretos. Falha de
    destino externo deve ser informada mantendo backup local. Nunca remover mídia
    que contém cluster ativo. Não apagar bancos para repetir testes.
18. Aprovar backup físico somente após evidência do dispositivo independente,
    hashes coincidentes, chave custodiada e restauração com anexos/fila conferidos
    no destino. `externalProtected` permanece falso no app H1: aprovação manual
    deve ser documentada; não alterar esse indicador para facilitar aceite.

## Matriz dos módulos existentes

| Módulo | Escopo offline a conferir | Limites preservados |
|---|---|---|
| Setores/Funções | Cadastro, consulta, edição e relacionamentos portados | Não alterar cadastros reais |
| Colaboradores | Fluxos portados na tela oficial e vínculo RH | Módulo completo parcial; anexos privados não integrados |
| Estoque | Fluxos portados, movimentações/versões/idempotência | Não representa todas as rotinas do módulo |
| Produção | Contratos transacionais locais já portados | Rotinas não portadas permanecem bloqueadas |
| Financeiro | Lançamentos e relacionamentos portados | Sem pagamento externo; estornos/conciliação global limitados |
| Vales/Consumo | Formulários, filtros, totais, estados, histórico e desconto | Sem dupla despesa/transferência automática; não reimplementar |
| Pagamentos em lote | Backend transacional testado em laboratório | Caminho legado de vales/adiantamentos pela tela bloqueado |
| Nuvem | Fila durável e estado real | Supabase desativado; conflitos sem resolução assistida completa |

Não há novos módulos H2. Preservar layout/campos e registrar divergências; não
contornar guardas. Cobertura automatizada não equivale à paridade visual integral.

## Encerrar e devolver evidências

19. Registrar contagens/IDs/fila, fechar app e desinstalar somente H pelo Windows.
    Não apagar AppData. Reinstalar H1 na mesma pasta isolada, abrir pelo ícone,
    entrar e conferir os mesmos registros. Coletar `-Stage AposReinstalar`.
20. Preencher ficha com resultados `aprovado`, `reprovado`, `pendente` ou
    `nao-aplicavel-justificado`, responsável/data e evidências correspondentes.
    Enviar apenas ficha/JSONs/capturas sintéticas revisadas. Não enviar `.dpapi`,
    `.env`, senha, frase, cluster, backups ou chaves. Lint/TypeScript herdados
    continuam bloqueios registrados, sem desabilitar verificações.

Uso diário com dados reais continua bloqueado até outro Windows/reboot/restore
independente, autorização empresarial offline, RLS/Auth/Storage, recuperação
operacional e módulos necessários serem homologados separadamente. Esta etapa
não autoriza migração, instalação definitiva, sync operacional, deploy ou push.
