[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$ReleaseManifest,[string]$Authorization,[switch]$Apply)
$ErrorActionPreference='Stop'
$release=Get-Content -LiteralPath $ReleaseManifest -Raw | ConvertFrom-Json
if($release.version -notin @('0.10.0-rc.2','0.10.0-rc.3','0.10.0-rc.4') -or $release.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Manifesto de candidata inesperado'}
$file=(Resolve-Path -LiteralPath $Installer).Path
if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.sha256){throw 'SHA-256 do instalador divergente'}
if(![Environment]::Is64BitOperatingSystem){throw 'Windows x64 necessario'}
$guid='75c7b9b8-6d06-4bf1-89d1-4e566b45c050'
$installKey='HKCU:\Software\'+$guid
$uninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid
$existing=Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction SilentlyContinue
$location=(Get-ItemProperty -LiteralPath $installKey -ErrorAction SilentlyContinue).InstallLocation
$machineEntries=@(('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid),('HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid))
foreach($key in $machineEntries){if(Test-Path -LiteralPath $key){throw 'Instalacao para todos os usuarios preservada; revisao de escopo obrigatoria antes de atualizar'}}
if($existing -and (!$location -or !(Test-Path -LiteralPath (Join-Path $location 'Sistema Ruy.exe')))){throw 'Registro existente incompleto; preservar instalacao e obter diagnostico'}
if(!$Apply){[pscustomobject]@{DryRun=$true;Computer=$env:COMPUTERNAME;Installer=$file;Version=$release.version;SHA256=$release.sha256;ExistingVersion=$existing.DisplayVersion;ExistingLocation=$location;Mode=$(if($existing){'UpdateSameOfficialIdentity'}else{'FreshCurrentUser'});Guid=$guid;RemoteAccess=$false;Installed=$false};return}
if($env:COMPUTERNAME -eq 'ADM-RUY' -or ($env:COMPUTERNAME -ne 'RUI-PC-ESTOQUE' -and $env:COMPUTERNAME -notlike 'RUY-HOMOLOG-*')){throw 'Somente localmente no RUI-PC-ESTOQUE ou Windows de homologacao autorizado; Pichau operacional bloqueado'}
if(!$Authorization){throw 'Autorizacao especifica obrigatoria'}
$approval=Get-Content -LiteralPath $Authorization -Raw | ConvertFrom-Json
if($approval.updateClientApproved -ne $true -or $approval.computer -ne $env:COMPUTERNAME -or $approval.installerSha256 -ne $release.sha256 -or !$approval.approvedBy -or !$approval.expiresAt -or [DateTimeOffset]::Parse($approval.expiresAt) -le [DateTimeOffset]::Now){throw 'Autorizacao invalida'}
if($location){$running=@(Get-Process -Name 'Sistema Ruy' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq (Join-Path $location 'Sistema Ruy.exe')});if($running.Count){throw 'Feche o Sistema Ruy antes da atualizacao; nenhum processo foi encerrado automaticamente'}}
$receiptRoot=Join-Path $env:LOCALAPPDATA ('GestaoRuy\client-updates\'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $receiptRoot | Out-Null
[pscustomobject]@{Timestamp=[DateTimeOffset]::UtcNow.ToString('o');Computer=$env:COMPUTERNAME;PreviousVersion=$existing.DisplayVersion;PreviousLocation=$location;UninstallString=$existing.UninstallString;NewSHA256=$release.sha256;ProfilesRemoved=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receiptRoot 'before.json') -Encoding utf8
# Electron Builder performs the in-place upgrade using the unchanged GUID.
# Never run the old uninstaller manually or remove AppData/backups.
$process=Start-Process -FilePath $file -Wait -PassThru
if($process.ExitCode -ne 0){throw ('Instalador terminou com codigo '+$process.ExitCode+'; preserve os perfis e consulte o recibo '+$receiptRoot)}
$after=Get-ItemProperty -LiteralPath $uninstallKey
$installedAt=(Get-ItemProperty -LiteralPath $installKey).InstallLocation
if($after.DisplayVersion -ne $release.version){throw 'Versao instalada nao confirmada'}
$exe=Join-Path $installedAt 'Sistema Ruy.exe'
if(!(Test-Path -LiteralPath $exe)){throw 'Executavel instalado nao encontrado'}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
 $linkFile=Join-Path $folder 'Sistema Ruy.lnk'
 if(!(Test-Path -LiteralPath $linkFile)){throw ('Atalho ausente: '+$linkFile)}
 $link=$shell.CreateShortcut($linkFile)
 if($link.TargetPath -ne $exe -or $link.Arguments){throw ('Destino de atalho incorreto: '+$linkFile)}
}
$result=[pscustomobject]@{Installed=$true;Version=$after.DisplayVersion;Location=$installedAt;SameOfficialGuid=$true;ShortcutsVerified=$true;DataDeleted=$false;Receipt=$receiptRoot;AppLaunched=$false;Next='Abrir pelo atalho; confirmar login e TLS; executar checklist fisico'}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receiptRoot 'after.json') -Encoding utf8
$result
