param([switch]$BootTask)
$ErrorActionPreference = 'Stop'
$productionHome = Join-Path $env:LOCALAPPDATA 'GestaoRuy\producao'
$runtime = Join-Path $productionHome 'runtime'
$supervisor = Join-Path $runtime 'supervisor.mjs'
$nodeExe = (Get-Command node.exe).Source
if (!(Test-Path -LiteralPath $supervisor)) { throw 'Execute npm.cmd run prod:publish primeiro.' }
$url = "http://${env:COMPUTERNAME}:8080"

if ($BootTask) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'A tarefa de boot exige PowerShell como administrador. Nenhuma tentativa de elevar ou contornar privilégios foi feita.'
  }
  $taskName = 'GestaoRuy-Producao'
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Tarefa já existe. Inspecione-a antes de substituir.' }
  # S4U: mesmo usuário, sem senha armazenada e sem privilégios elevados no servidor.
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType S4U -RunLevel Limited
  $action = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$supervisor`"" -WorkingDirectory $runtime
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Description 'Frontend estático Ruy, porta 8080, build publicado. Não inicia Vite.' | Out-Null
  $loginLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'GestaoRuy-Producao.lnk'
  if (Test-Path -LiteralPath $loginLink) {
    $shell = New-Object -ComObject WScript.Shell
    $existing = $shell.CreateShortcut($loginLink)
    if ($existing.Arguments -eq "`"$(Join-Path $runtime 'start-hidden.vbs')`"") { Remove-Item -LiteralPath $loginLink }
  }
  Write-Output 'Tarefa instalada para o próximo boot; servidor atual preservado.'
  exit
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop 'Sistema de Gestão Ruy.url'
if (!(Test-Path -LiteralPath $shortcut)) {
  "[InternetShortcut]`r`nURL=$url`r`n" | Set-Content -LiteralPath $shortcut -Encoding ASCII
} else { Write-Output 'Atalho existente preservado.' }

# Alternativa sem administrador: inicia OCULTO ao login deste usuário.
# Não substitui a tarefa de boot para disponibilidade antes do login.
$launcher = Join-Path $runtime 'start-hidden.vbs'
$escaped = ('"' + $nodeExe + '" "' + $supervisor + '"').Replace('"', '""')
@"
Set shell = CreateObject("WScript.Shell")
shell.Run "$escaped", 0, False
"@ | Set-Content -LiteralPath $launcher -Encoding Unicode
$startup = [Environment]::GetFolderPath('Startup')
$linkPath = Join-Path $startup 'GestaoRuy-Producao.lnk'
if (!(Test-Path -LiteralPath $linkPath)) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($linkPath)
  $link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $link.Arguments = "`"$launcher`""
  $link.WorkingDirectory = $runtime
  $link.WindowStyle = 7
  $link.Save()
}
Write-Output "Atalho: $shortcut"
Write-Output 'Início automático ao login instalado. Boot antes do login ainda exige tarefa administrativa.'
