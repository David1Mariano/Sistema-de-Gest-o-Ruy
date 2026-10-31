[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ApiEndpoint,[string]$Authorization,[switch]$Apply)
$ErrorActionPreference='Stop'
$uri=[Uri]$ApiEndpoint
$lan=$uri.Host -ieq 'ADM-RUY' -and $uri.Port -eq 18716
$internet=$uri.Port -eq 443 -and $uri.Host.Contains('.')
if(!$uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or (!$lan -and !$internet) -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/' -or $uri.HostNameType -ne [UriHostNameType]::Dns){throw 'URL HTTPS oficial obrigatoria: ADM-RUY:18716 na LAN ou dominio proprio na porta 443; sem IP ou credenciais'}
$key='HKLM:\SOFTWARE\Policies\SistemaRuy'
$existing=Get-ItemProperty -LiteralPath $key -Name ApiEndpoint -ErrorAction SilentlyContinue
if(!$Apply){[pscustomobject]@{DryRun=$true;Computer=$env:COMPUTERNAME;ApiEndpoint=$uri.GetLeftPart([UriPartial]::Authority);ExistingEndpoint=$existing.ApiEndpoint;RegistryModified=$false;RemoteAccess=$false};return}
if(!$Authorization){throw 'Autorizacao nominativa de distribuicao da politica obrigatoria'}
$approval=Get-Content -LiteralPath $Authorization -Raw | ConvertFrom-Json
if($approval.publishApiPolicyApproved -ne $true -or $approval.computer -ne $env:COMPUTERNAME -or $approval.endpoint -ne $uri.GetLeftPart([UriPartial]::Authority) -or !$approval.approvedBy -or !$approval.expiresAt -or [DateTimeOffset]::Parse($approval.expiresAt) -le [DateTimeOffset]::Now){throw 'Autorizacao invalida'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(!(New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Aplicacao exige administrador no destino autorizado'}
# No DNS, tunnel, certificate, service, database, or installed application edits.
# Preserve the old public value for administrative rollback; never remove data.
$backup=[pscustomobject]@{Computer=$env:COMPUTERNAME;Timestamp=[DateTimeOffset]::UtcNow.ToString('o');HadEndpoint=($null -ne $existing);PreviousEndpoint=$existing.ApiEndpoint}
$backupFile=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('SistemaRuy-policy-before-'+[Guid]::NewGuid().ToString('N')+'.json')
$backup | ConvertTo-Json | Out-File -LiteralPath $backupFile -Encoding utf8 -NoClobber
if(!(Test-Path -LiteralPath $key)){New-Item -Path $key -Force | Out-Null}
New-ItemProperty -LiteralPath $key -Name ApiEndpoint -Value $uri.GetLeftPart([UriPartial]::Authority) -PropertyType String -Force | Out-Null
[pscustomobject]@{Applied=$true;Backup=$backupFile;Computer=$env:COMPUTERNAME;ApiEndpoint=$uri.GetLeftPart([UriPartial]::Authority);CentralActivated=$false}
