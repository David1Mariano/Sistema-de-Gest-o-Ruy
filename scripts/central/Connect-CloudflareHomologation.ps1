$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'ADM-RUY') { throw 'Servidor autorizado: ADM-RUY.' }
Add-Type -AssemblyName PresentationFramework
$uuid = 'b5dcbb4c-83b9-43f0-af9e-927e86bcfc0d'
$root = Join-Path $env:LOCALAPPDATA 'GestaoRuy\cloudflare-homologacao-b5dcbb4c'
$file = Join-Path $root 'tunnel-token.dpapi'
if (-not (Test-Path -LiteralPath $root) -or ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Diretorio protegido indisponivel.' }
$window = New-Object Windows.Window
$window.Title = 'Sistema Ruy - credencial Cloudflare protegida'
$window.Width = 650
$window.Height = 450
$window.WindowStartupLocation = 'CenterScreen'
$window.Topmost = $true
$panel = New-Object Windows.Controls.StackPanel
$panel.Margin = '22'
$window.Content = $panel
$text = New-Object Windows.Controls.TextBlock
$text.Text = "Somente no ADM-RUY. No painel Cloudflare: Networking > Tunnels > selecione o tunel $uuid > Add a replica (ou Install connector). Copie apenas o token eyJ... do comando apresentado. Nao execute service install, nao cole o comando inteiro e nao envie o token pelo chat."
$text.TextWrapping = 'Wrap'
$text.Margin = '0,0,0,16'
[void]$panel.Children.Add($text)
$label = New-Object Windows.Controls.TextBlock
$label.Text = 'Token do tunel (campo protegido; armazenamento Windows DPAPI):'
$label.TextWrapping = 'Wrap'
[void]$panel.Children.Add($label)
$tokenBox = New-Object Windows.Controls.PasswordBox
$tokenBox.MaxLength = 4096
$tokenBox.Margin = '0,10,0,14'
[void]$panel.Children.Add($tokenBox)
$route = New-Object Windows.Controls.CheckBox
$route.Content = 'Confirmei no painel: tunel gerenciado remotamente e rota conforme abaixo.'
$route.Margin = '0,0,0,10'
[void]$panel.Children.Add($route)
$hint = New-Object Windows.Controls.TextBlock
$hint.Text = 'Hostname api.ruycaldodecana.com.br; service HTTPS 127.0.0.1:18716; Origin Server Name ADM-RUY; CA Pool no test-ca.pem do perfil central-lab-79402bbf27e83425; No TLS Verify DESLIGADO. Sem outras rotas, private networks ou servicos publicados. Se aparecer Locally managed, nao converta nem crie outro tunel: avise ao Codex.'
$hint.TextWrapping = 'Wrap'
$hint.Margin = '0,0,0,14'
[void]$panel.Children.Add($hint)
$save = New-Object Windows.Controls.Button
$save.Content = 'Guardar credencial protegida (sem instalar servico)'
$save.Add_Click({
    $secure = $tokenBox.SecurePassword
    $pointer = [IntPtr]::Zero
    $plain = $null
    $decoded = $null
    try {
        if ($route.IsChecked -ne $true) { throw 'Confirmacao da rota pendente.' }
        if (Test-Path -LiteralPath $file) { throw 'Credencial ja existe; substituicao automatica recusada.' }
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($plain -notmatch '^[A-Za-z0-9_+/=-]{40,4096}$') { throw 'Formato invalido.' }
        $encoded = $plain.Replace('-', '+').Replace('_', '/')
        while ($encoded.Length % 4) { $encoded += '=' }
        $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
        if ($decoded.t -ne $uuid -or $decoded.a -notmatch '^[a-f0-9]{32}$' -or -not $decoded.s) { throw 'Token de outro tunel ou formato invalido.' }
        # Persist only ciphertext. No credentials in command lines, logs or repo.
        $cipher = ConvertFrom-SecureString -SecureString $secure
        $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $bytes = [Text.Encoding]::UTF8.GetBytes($cipher); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        $receipt = [ordered]@{contract='RUY_CLOUDFLARE_LOCAL_PROVISIONING/1';tunnelUuid=$uuid;managementModeConfirmedByOperator='cloudflare';routeConfirmedByOperator=$true;server='ADM-RUY';at=[DateTime]::UtcNow.ToString('o');credentialStoredWithCurrentUserDpapi=$true;tokenPrinted=$false;tunnelStarted=$false}
        [IO.File]::WriteAllText((Join-Path $root 'provisioning.json'), ($receipt | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        $tokenBox.Clear()
        [void][Windows.MessageBox]::Show('Credencial guardada com protecao do Windows. Avise no chat apenas: credencial guardada. Nenhum servico foi instalado e nenhum tunel foi iniciado por esta janela.', 'Sistema Ruy')
        $window.Close()
    } catch {
        $tokenBox.Clear()
        [void][Windows.MessageBox]::Show('Nao foi possivel guardar. Confirme a rota, copie somente o token do tunel correto e nao execute o comando de instalacao. Se ja houver credencial guardada, avise ao Codex. Nenhum segredo foi exibido.', 'Sistema Ruy')
    } finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $plain = $null; $decoded = $null; $encoded = $null
        $secure.Dispose()
    }
})
[void]$panel.Children.Add($save)
$window.Add_Closed({ $tokenBox.Clear() })
[void]$window.ShowDialog()
