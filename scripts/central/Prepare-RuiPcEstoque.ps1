[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Installer,[string]$Authorization,[switch]$Apply)
$ErrorActionPreference='Stop'
$expected='3c23471db8b4b7550b5029002e7325e887d56b872838d3deb282f8d9c3f3698e'
$file=(Resolve-Path -LiteralPath $Installer).Path
if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Instalador oficial 0.9.0-rc.1 divergente'}
$installed=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -match 'Sistema Ruy'})
if(!$Apply){[pscustomobject]@{DryRun=$true;Installer=$file;SHA256=$expected;ExistingInstallations=$installed.Count;Target='RUI-PC-ESTOQUE';CredentialsIncluded=$false;RemoteAccess=$false;Installed=$false};return}
if($env:COMPUTERNAME -ne 'RUI-PC-ESTOQUE'){throw 'Executar somente LOCALMENTE no computador autorizado RUI-PC-ESTOQUE'}
if($installed.Count -gt 0){throw 'Instalação existente preservada; revisão específica obrigatória'}
if(!$Authorization){throw 'Autorização específica obrigatória'}
$approval=Get-Content -LiteralPath $Authorization -Raw | ConvertFrom-Json
if($approval.installClientApproved -ne $true -or $approval.computer -ne 'RUI-PC-ESTOQUE' -or !$approval.approvedBy -or !$approval.expiresAt -or [DateTimeOffset]::Parse($approval.expiresAt) -le [DateTimeOffset]::Now){throw 'Autorização de cliente inválida'}
if(![Environment]::Is64BitOperatingSystem){throw 'Windows x64 obrigatório'}
# Interactive installation only after authorization; never any remote command.
$process=Start-Process -FilePath $file -Wait -PassThru
if($process.ExitCode -ne 0){throw "Instalador terminou com código $($process.ExitCode)"}
[pscustomobject]@{Installed=$true;Provisioned=$false;Next='Gerar CSR no aplicativo; validar certificado/CA/token do dispositivo; importar autorização individual; preencher checklist físico.'}
