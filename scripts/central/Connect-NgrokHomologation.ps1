# One-time setup by the server owner. No endpoint, service or database is started.
# Never distribute the resulting CurrentUser DPAPI file to client computers.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'ADM-RUY') { throw 'Configuracao exclusiva do servidor ADM-RUY.' }
$package = Get-AppxPackage -Name 'ngrok.ngrok'
if (-not $package -or $package.SignatureKind -ne 'Store' -or $package.Status -ne 'Ok') {
    throw 'Instale exclusivamente o ngrok oficial pela Microsoft Store.'
}
Add-Type -AssemblyName PresentationFramework
$window = New-Object Windows.Window
$window.Title = 'Sistema Ruy - vincular ngrok de homologacao'
$window.Width = 570
$window.Height = 370
$window.ResizeMode = 'NoResize'
$window.WindowStartupLocation = 'CenterScreen'
$panel = New-Object Windows.Controls.StackPanel
$panel.Margin = '22'
$window.Content = $panel
$intro = New-Object Windows.Controls.TextBlock
$intro.Text = 'Configuracao unica pelo responsavel do servidor. Use uma conta da empresa no plano Free (US$ 0). Nenhum funcionario precisara executar esta etapa.'
$intro.TextWrapping = 'Wrap'
$intro.Margin = '0,0,0,14'
[void]$panel.Children.Add($intro)
$account = New-Object Windows.Controls.Button
$account.Content = 'Abrir conta ngrok no site oficial'
$account.Margin = '0,0,0,12'
$account.Add_Click({ Start-Process 'https://dashboard.ngrok.com/signup' })
[void]$panel.Children.Add($account)
$label = New-Object Windows.Controls.TextBlock
$label.Text = 'Cole SOMENTE o valor do authtoken. Nao cole comandos ou exemplos Python.'
$label.TextWrapping = 'Wrap'
$label.Margin = '0,0,0,6'
[void]$panel.Children.Add($label)
$tokenBox = New-Object Windows.Controls.PasswordBox
$tokenBox.MaxLength = 512
$tokenBox.Margin = '0,0,0,12'
[void]$panel.Children.Add($tokenBox)
$tokenPage = New-Object Windows.Controls.Button
$tokenPage.Content = 'Abrir pagina oficial do authtoken'
$tokenPage.Margin = '0,0,0,12'
$tokenPage.Add_Click({ Start-Process 'https://dashboard.ngrok.com/get-started/your-authtoken' })
[void]$panel.Children.Add($tokenPage)
$save = New-Object Windows.Controls.Button
$save.Content = 'Guardar com protecao do Windows, sem ativar o tunel'
$save.Add_Click({
    $credential = $tokenBox.SecurePassword
    $previous = $null
    $temporary = $null
    try {
        if ($credential.Length -lt 20) { throw 'Token incompleto.' }
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential)
        try {
            $valid = [regex]::IsMatch([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), '^[A-Za-z0-9_-]{20,512}$') -and -not [regex]::IsMatch([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'YOUR_AUTHTOKEN|EXAMPLE_AUTHTOKEN', 'IgnoreCase')
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        if (-not $valid) { throw 'Cole somente o valor real do authtoken.' }
        $parent = Join-Path $env:LOCALAPPDATA 'GestaoRuy'
        $root = Join-Path $parent 'ngrok-homologacao'
        foreach ($entry in @($parent, $root)) {
            if (Test-Path -LiteralPath $entry) {
                $item = Get-Item -LiteralPath $entry -Force
                if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                    throw 'Diretorio redirecionado recusado.'
                }
            }
        }
        [void][IO.Directory]::CreateDirectory($root)
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
        (Get-Item -LiteralPath $root).SetAccessControl($acl)
        $file = Join-Path $root 'ngrok-token.dpapi'
        $previous = $null
        if (Test-Path -LiteralPath $file) {
            $invalid = Get-Content -LiteralPath (Join-Path $root 'invalid-token.json') -Raw | ConvertFrom-Json
            if ($invalid.contract -ne 'RUY_INVALID_NGROK_CREDENTIAL/1' -or $invalid.ciphertextSha256 -ne (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()) {
                throw 'Substituicao de credencial nao validada recusada.'
            }
            $previous = $file + '.invalid-' + [Guid]::NewGuid().ToString('N')
        }
        # Only ciphertext is persisted; no token in command arguments or logs.
        $encrypted = ConvertFrom-SecureString -SecureString $credential
        $temporary = $file + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes($encrypted)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
        } finally { $stream.Dispose() }
        if ($previous) { [IO.File]::Move($file, $previous) }
        [IO.File]::Move($temporary, $file)
        $tokenBox.Clear()
        [void][Windows.MessageBox]::Show('Credencial protegida somente neste usuario do servidor. O tunel ainda nao foi ativado e a conta ainda precisa ser validada pelo agente.', 'Sistema Ruy')
        $window.Close()
    } catch {
        $tokenBox.Clear()
        if ($temporary -and (Test-Path -LiteralPath $temporary)) { [IO.File]::Delete($temporary) }
        if ($previous -and (Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $file)) { [IO.File]::Move($previous, $file) }
        [void][Windows.MessageBox]::Show('Nao foi possivel guardar. Copie SOMENTE o valor real do authtoken da pagina oficial. Nao copie NGROK_AUTHTOKEN=, comandos Python ou textos de exemplo. Nenhum tunel foi iniciado.', 'Sistema Ruy')
    } finally { $credential.Dispose() }
})
[void]$panel.Children.Add($save)
$window.Add_Closed({ $tokenBox.Clear() })
[void]$window.ShowDialog()
