[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageRoot,[Parameter(Mandatory=$true)][string]$PreviousInstaller,[Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
if($env:USERNAME -ne 'WDAGUtilityAccount' -or $env:COMPUTERNAME -in @('ADM-RUY','RUI-PC-ESTOQUE')){throw 'Teste destrutivo de instalacao permitido somente dentro do Windows Sandbox, nunca no host operacional'}
$guid='75c7b9b8-6d06-4bf1-89d1-4e566b45c050'
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid
$installKey='HKCU:\Software\'+$guid
if(Test-Path -LiteralPath $key){throw 'Sandbox deve iniciar limpo; instalacao existente preservada'}
$manifest=Get-Content -LiteralPath (Join-Path $PackageRoot 'release-manifest.json') -Raw | ConvertFrom-Json
$candidate=Join-Path $PackageRoot 'build\Sistema-Ruy-Compartilhado-0.10.0-rc.2-Setup.exe'
if((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256){throw 'Candidata divergente'}
if((Get-FileHash -LiteralPath $PreviousInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne '89720ab2f5f83a3b38ba5b242f6288ec7786a8ea9a5c9e4bce38a777e90d1418'){throw 'Candidata anterior divergente'}
New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
$proof=[ordered]@{Executed=$true;Environment='Windows Sandbox';PreviousVersion='0.10.0-rc.1';NewVersion=$manifest.version;OperationalHostTouched=$false;PhysicalTwoComputers=$false;LoginVisuallyApproved=$false}
function Run-Installer([string]$File,[string[]]$Parameters){$p=Start-Process -FilePath $File -ArgumentList $Parameters -Wait -PassThru;if($p.ExitCode -ne 0){throw ('Processo terminou com codigo '+$p.ExitCode)}}
try{
 $profileRoots=@((Join-Path $env:APPDATA 'SistemaGestaoRuy-shared-client'),(Join-Path $env:LOCALAPPDATA 'GestaoRuy\shared-client'))
 foreach($folder in $profileRoots){New-Item -ItemType Directory -Path $folder -Force | Out-Null;Set-Content -LiteralPath (Join-Path $folder 'homologacao-sentinel.txt') -Value 'FICTICIO PRESERVAR'}
 Run-Installer $PreviousInstaller @('/S')
 if((Get-ItemProperty -LiteralPath $key).DisplayVersion -ne '0.10.0-rc.1'){throw 'Instalacao anterior nao confirmada'}
 $oldLocation=(Get-ItemProperty -LiteralPath $installKey).InstallLocation
 $desktopLink=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sistema Ruy.lnk'
 $menuLink=Join-Path ([Environment]::GetFolderPath('Programs')) 'Sistema Ruy.lnk'
 foreach($link in @($desktopLink,$menuLink)){if(!(Test-Path -LiteralPath $link)){throw 'Instalacao limpa anterior nao criou atalho'};Remove-Item -LiteralPath $link -Force}
 Run-Installer $candidate @('/S')
 $location=(Get-ItemProperty -LiteralPath $installKey).InstallLocation
 if($location -ne $oldLocation -or (Get-ItemProperty -LiteralPath $key).DisplayVersion -ne $manifest.version){throw 'Atualizacao nao preservou diretorio/registro oficial'}
 $exe=Join-Path $location 'Sistema Ruy.exe'
 $shell=New-Object -ComObject WScript.Shell
 foreach($file in @($desktopLink,$menuLink)){$link=$shell.CreateShortcut($file);if(!(Test-Path -LiteralPath $file) -or $link.TargetPath -ne $exe -or $link.Arguments -or $link.WorkingDirectory -ne $location){throw ('Atalho incorreto: '+$file)}}
 $proof.FreshInstall=$true;$proof.InPlaceUpgrade=$true;$proof.MissingShortcutsRepaired=$true;$proof.InstalledProgramsEntry=$true
 $app=Start-Process -FilePath $exe -PassThru
 Start-Sleep -Seconds 12
 if($app.HasExited){throw 'Electron encerrou antes da verificacao'}
 $app.Refresh();$proof.FirstLaunchProcess=$true;$proof.FirstWindowTitle=$app.MainWindowTitle
 Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing
 $bounds=[Windows.Forms.Screen]::PrimaryScreen.Bounds;$image=New-Object Drawing.Bitmap($bounds.Width,$bounds.Height);$graphics=[Drawing.Graphics]::FromImage($image)
 try{$graphics.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size);$image.Save((Join-Path $EvidenceRoot 'primeira-tela-sandbox.png'))}finally{$graphics.Dispose();$image.Dispose()}
 if(!$app.CloseMainWindow()){throw 'Fechar a janela manualmente antes de desinstalar; nenhum processo foi forcado'}
 if(!$app.WaitForExit(30000)){throw 'Encerramento gracioso pendente; nenhum processo foi forcado'}
 $uninstaller=Join-Path $location 'Uninstall Sistema Ruy.exe'
 Run-Installer $uninstaller @('/S','/currentuser',('_?='+$location))
 if((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $exe) -or (Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $menuLink)){throw 'Desinstalacao deixou registro, executavel ou atalhos'}
 foreach($folder in $profileRoots){if((Get-Content -LiteralPath (Join-Path $folder 'homologacao-sentinel.txt') -Raw).Trim() -ne 'FICTICIO PRESERVAR'){throw 'Perfil de teste nao preservado'}}
 $proof.Uninstall=$true;$proof.ProfileSentinelsPreserved=$true;$proof.Passed=$true
}catch{$proof.Passed=$false;$proof.Error=$_.Exception.Message;throw}finally{$proof | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'installer-result.json') -Encoding utf8}
