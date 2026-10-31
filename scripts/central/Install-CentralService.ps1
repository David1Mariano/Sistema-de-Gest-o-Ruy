[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Package,[Parameter(Mandatory=$true)][string]$Profile,[string]$Authorization,[switch]$Apply)
$ErrorActionPreference='Stop'
$packagePath=(Resolve-Path -LiteralPath $Package).Path
$profilePath=(Resolve-Path -LiteralPath $Profile).Path
if((Split-Path -Leaf $profilePath) -ne 'central-pichau-rc1-staging'){throw 'Perfil central separado obrigatório'}
$serviceName='SistemaRuyCentralRc1'
if(Get-Service -Name $serviceName -ErrorAction SilentlyContinue){throw 'Serviço existente preservado'}
$hostExe=Join-Path $packagePath 'runtime\RuyCentralService.exe'
$nodeExe=Join-Path $packagePath 'runtime\node.exe'
$supervisor=Join-Path $packagePath 'scripts\central\supervisor.mjs'
foreach($item in @($hostExe,$nodeExe,$supervisor)){if(!(Test-Path -LiteralPath $item -PathType Leaf)){throw 'Pacote incompleto'}}
$manifest=Get-Content -LiteralPath (Join-Path $packagePath 'manifest.json') -Raw | ConvertFrom-Json
foreach($entry in $manifest.files){$item=[IO.Path]::GetFullPath((Join-Path $packagePath $entry.path));if(!$item.StartsWith($packagePath+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Caminho inválido no manifesto'};if((Get-FileHash -LiteralPath $item -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw 'Integridade do pacote inválida'}}
$command='"'+$hostExe+'" --service "'+$nodeExe+'" "'+$supervisor+'" "'+$profilePath+'"'
if(!$Apply){[pscustomobject]@{DryRun=$true;Service=$serviceName;BinaryPath=$command;Automatic=$true;Recovery='restart 5s, restart 15s, stop';Profile=$profilePath;Started=$false};return}
if(!$Authorization){throw 'Autorização específica obrigatória'}
$approval=Get-Content -LiteralPath $Authorization -Raw | ConvertFrom-Json
if($approval.installWindowsServiceApproved -ne $true -or $approval.server -ne 'PICHAU' -or $approval.service -ne $serviceName -or !$approval.approvedBy -or [DateTimeOffset]::Parse($approval.expiresAt) -lt [DateTimeOffset]::Now){throw 'Autorização de serviço inválida'}
# Secrets/profile must be provisioned by THIS service identity using CurrentUser
# DPAPI. Installing does not start or activate the central/API/firewall/database.
$credential=Get-Credential -Message 'Conta Windows dedicada já preparada para a central'
if($credential.UserName -match 'LocalSystem|SYSTEM|Administrator|Pichau$'){throw 'Use conta de serviço dedicada com privilégio mínimo'}
New-Service -Name $serviceName -BinaryPathName $command -StartupType Automatic -Credential $credential -DisplayName 'Sistema Ruy Central RC1' | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/none/0 | Out-Null
if($LASTEXITCODE -ne 0){throw 'Falha ao configurar recuperação; serviço não iniciado'}
& sc.exe failureflag $serviceName 1 | Out-Null
if($LASTEXITCODE -ne 0){throw 'Falha ao configurar recuperação; serviço não iniciado'}
[pscustomobject]@{Installed=$true;Started=$false;Service=$serviceName}
