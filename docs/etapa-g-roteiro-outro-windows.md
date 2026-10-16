# Etapa G — homologação manual em outro Windows

Versão experimental **0.5.0**, identidade `br.ruy.gestao.laboratorio.g`.
Este roteiro ainda precisa ser executado em outro computador/VM Windows. Ensaios
no computador de desenvolvimento não equivalem a esse aceite. Não usar dados reais.

## Entrega e dependências

- Instalador: `Sistema-Gestao-Ruy-Lab-0.5.0-Setup.exe`.
- Conferir SHA-256 com o arquivo `SHA256SUMS.txt` entregue junto:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\Sistema-Gestao-Ruy-Lab-0.5.0-Setup.exe
```

- Windows x64 compatível com Electron 44 e PostgreSQL 17. A compatibilidade com
  a versão específica do Windows de destino é parte desta homologação.
- PostgreSQL **17 x64**, distribuição confiável completa de binários, incluindo
  `bin`, `lib` e `share` e as dependências de runtime dessa distribuição. Não copiar
  apenas os cinco executáveis. Os utilitários requeridos são `postgres`, `initdb`,
  `pg_ctl`, `pg_dump` e `pg_restore`.
- A [página oficial para Windows](https://www.postgresql.org/download/windows/)
  oferece a opção de arquivo ZIP dos binários sem instalador. Preparar essa
  dependência separadamente; o instalador Ruy **não inclui PostgreSQL**. Não instalar
  serviço permanente de PostgreSQL sem autorização.
- PowerShell do Windows e DPAPI do usuário local. Não é necessário instalar Node,
  npm, Git, Electron ou ter o checkout de desenvolvimento na máquina de destino.
- Preparar os arquivos/dependências antes de retirar o acesso à internet.

Não copiar `.env`, `.dpapi`, cluster, chaves, credenciais de nuvem ou banco do
computador de desenvolvimento. A outra máquina cria identidade e dados próprios.
Não instalar sobre a aplicação operacional. Fechar outros laboratórios Ruy antes
do ensaio; eles compartilham o namespace D1 do usuário local.

## Execução e critérios

Preencher `etapa-g-ficha-homologacao.md` com resultados, horário, capturas e falhas.
Não marcar aprovado somente porque o instalador terminou.

1. **Instalar por usuário.** Executar o instalador e escolher uma pasta própria
   de laboratório. Confirmar atalhos “Sistema de Gestão Ruy — Homologação G” na
   área de trabalho e menu Iniciar. Abrir pelo atalho e conferir janela própria.
2. **Primeira inicialização.** A preparação aparece somente quando o diretório
   D1 ainda não existe. Selecionar a pasta `bin` do PostgreSQL 17, informar e-mail
   fictício `homologacao@example.invalid` e senha local de ao menos 12 caracteres.
   O processo cria cluster privado, tabelas e administrador sintético, sem serviço
   Windows. Se houver erro ou diretório parcial, registrar e parar: não apagar
   diretórios nem repetir init para contornar falha.
3. **Autenticação.** Entrar com senha incorreta uma vez e confirmar recusa. Entrar
   com a senha criada. Não registrar a senha na ficha. Logout deve encerrar a sessão.
   Papéis empresariais, expiração/revogação offline completas ainda não homologados.
4. **Cadastros fictícios.** Criar setor e função começando com `FICTICIO `; criar
   colaborador fictício com vínculo correto. Documentos pessoais, se preenchidos,
   devem usar os marcadores sintéticos aceitos pelo laboratório. Conferir IDs,
   edição, versão e mensagem em tentativa de alteração concorrente.
5. **Retirar internet.** Desconectar somente a máquina de homologação. Não desligar
   a rede do computador operacional. Repetir consulta/edição de cadastros, criar
   vale pendente e consumo registrado, conferir filtros e histórico. Nenhuma ação
   deve depender de Supabase, CDN ou fonte remota.
6. **Produção/estoque/financeiro.** Usar apenas itens fictícios e operações locais
   já portadas. Conferir prévia e baixa única de produção, cancelamento com devolução,
   documentos financeiros e vínculo de desconto RH. Desconto não executa saída
   bancária/caixa. Lotes pela tela permanecem indisponíveis; conferir recusa antes
   de qualquer gravação, inclusive adiantamentos.
7. **Fechar/reabrir.** Anotar quantidades e estado de registros/fila, fechar a janela
   e abrir pelo atalho. Verificar os mesmos registros, histórico e pendências.
8. **Reiniciar Windows.** No computador isolado de homologação, reiniciar o Windows
   e abrir o aplicativo. Ele deve iniciar o PostgreSQL privado e a API local sem
   intervenção e recuperar os mesmos registros e pendências. Não exige serviço
   permanente ou aplicativo aberto automaticamente no logon.
9. **Indicador.** Com alterações locais, conferir nuvem pendente e contador.
   Não aceitar check verde sem recibos/pull verificáveis ou com falhas/pendências.
   A sincronização operacional permanece desativada; não criar conexão Supabase.
10. **Backup.** Menu “Laboratório → Criar backup criptografado agora”. Conferir
    `.ruybak` e estado separado da nuvem. No menu, configurar uma pasta de destino
    escolhida pelo responsável e repetir a cópia. Conferir hash verificado. Se o
    destino estiver indisponível, a falha deve ser informada e a cópia local mantida.
    Não remover o disco onde está o cluster; simular apenas falha do destino externo.
11. **Restore isolado.** Menu “Laboratório → Testar restauração isolada do último
    backup”. Registrar o nome do banco novo `ruy_d1_restore_*` e 12 tabelas verificadas.
    O banco ativo e a sincronização devem permanecer inalterados.
12. **Desinstalar/reinstalar.** Com aplicativo fechado, anotar identidade, registros,
    histórico e fila; desinstalar pelo desinstalador G. Não apagar AppData. Reinstalar
    o mesmo pacote na pasta de laboratório, entrar e conferir os dados anteriores.
13. **Atualização.** Quando houver próxima versão autorizada, repetir a conferência
    antes/depois. Atualização interrompida ainda não foi homologada por este ciclo.

## Diretórios, rede e backups

Dados privados: `%LOCALAPPDATA%\GestaoRuy\etapa-d1-lab`.
Cluster e credenciais ficam fora da pasta de instalação; não são excluídos pela
desinstalação. O cluster pode continuar executando após fechar o app; será
retomado ao abrir após reboot. Nenhum serviço/autostart permanente é instalado.
PostgreSQL somente `127.0.0.1:55436`, API somente `127.0.0.1:18087`. Não criar regras
de firewall públicas nem mudar para `0.0.0.0`. A porta 8080 não é usada pelo pacote.

O menu de backup permite escolher destino posteriormente; não há destino externo
predefinido. Agendamento padrão de 60 minutos e retenção local de 24 cópias, somente
enquanto o aplicativo estiver aberto. Cópias externas são verificadas por hash e
não são removidas automaticamente; definir retenção externa antes de uso real.

**A chave atual depende do usuário/máquina via DPAPI.** A cópia externa não resolve
a recuperação dessa chave após perda do computador. Restore em outro Windows,
custódia independente da chave e recuperação operacional ainda são bloqueios.
Não afirmar que dados reais estão protegidos.

## Matriz do pacote

| Área | Situação |
|---|---|
| Setores/Funções | CRUD local portado; renomeação de setor com cascata/versões; renomeação de função em uso segue bloqueada |
| Colaboradores | Cadastro local e referências; ficha completa/fotos e demais RH parcialmente offline |
| Vales/Consumo | Contratos F offline testados: cadastro/edição, histórico, cancelamento não descontado e vínculo à folha; estornos/anexos indisponíveis |
| Estoque | Operações locais transacionais portadas; saldo global/reservas entre computadores pendentes |
| Produção | Ficha, diário, prévia, baixa e devolução locais testados; aceite completo de interface ainda pendente |
| Financeiro | Documentos/agregados portados offline; conciliação global, estornos e todos os relatórios pendentes |
| Pagamentos em lote | Backend sintético agregado testado; caminho de múltiplos pagamentos e lote legado pela tela indisponíveis |
| Anexos privados | Indisponíveis nas telas; backup aceita somente arquivos sintéticos imutáveis do laboratório |
| D1/C2 | Fila durável preservada; ponte simulada testada no desenvolvimento; o instalador não provisiona central/token C2 |
| Supabase operacional | Desativado/bloqueado, sem alterações de RLS/grants/Auth/Storage |

O pacote é experimental e sem assinatura. Uso diário continua bloqueado por
homologação independente, autorização offline empresarial, recuperação de chave,
segurança Supabase, diagnósticos de qualidade e módulos/fluxos ainda incompletos.

Referência de revisão do isolamento/IPC:
[segurança Electron](https://www.electronjs.org/docs/latest/tutorial/security).
