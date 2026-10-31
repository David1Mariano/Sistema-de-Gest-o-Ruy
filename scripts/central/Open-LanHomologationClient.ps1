[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Receipt)
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'ADM-RUY'){throw 'Somente cliente isolado no ADM-RUY'}
$r=Get-Content -LiteralPath $Receipt -Raw | ConvertFrom-Json
if($r.purpose -ne 'RUY_TEMPORARY_SYNTHETIC_LAN' -or [DateTimeOffset]::Parse($r.expiresAt) -le [DateTimeOffset]::Now){throw 'Homologacao invalida ou expirada'}
$status=Get-Content -LiteralPath (Join-Path (Split-Path $Receipt) 'status.json') -Raw | ConvertFrom-Json
if(!$status.running){throw 'Central nao esta pronta'}
$repo=Split-Path (Split-Path $PSScriptRoot)
$exe=Join-Path $repo 'artifacts\multicomputador-0.10.0-rc.2-20261028\build\win-unpacked\Sistema Ruy.exe'
if(!(Test-Path -LiteralPath $exe)){throw 'Executavel candidato existente nao encontrado'}
$clientRoot=Join-Path $env:LOCALAPPDATA ('GestaoRuy\installation-final-dev-20261021\shared-electron-test-'+[Guid]::NewGuid().ToString('N').Substring(0,16))
New-Item -ItemType Directory -Path $clientRoot | Out-Null
$ca=[IO.File]::ReadAllText((Join-Path $r.publicDir 'Ruy-Homologacao-CA.cer'))
if(!$status.hostClientPort){throw 'Endereco estavel do cliente isolado ainda nao preparado'}
[IO.File]::WriteAllText((Join-Path $clientRoot 'synthetic-endpoint.json'),(@{endpoint=('https://127.0.0.1:'+$status.hostClientPort+'/');ca=$ca} | ConvertTo-Json))
$info=New-Object Diagnostics.ProcessStartInfo
$info.FileName=$exe;$info.WorkingDirectory=$repo;$info.UseShellExecute=$false
foreach($name in @($info.EnvironmentVariables.Keys)){if($name -like 'RUY_*' -or $name -eq 'ELECTRON_RUN_AS_NODE'){$info.EnvironmentVariables.Remove($name)}}
$info.EnvironmentVariables['RUY_SHARED_LAB']='1';$info.EnvironmentVariables['RUY_SHARED_CLIENT_TEST_ROOT']=$clientRoot
$info.EnvironmentVariables['PATH']=(Join-Path $env:SystemRoot 'System32')+';'+$env:SystemRoot+';'+(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0')
$process=New-Object Diagnostics.Process;$process.StartInfo=$info
[void]$process.Start()
$result=[pscustomobject]@{Pid=$process.Id;Executable=$exe;ClientProfile=$clientRoot;InstalledApplicationChanged=$false;TrustStoreChanged=$false;ExternalNodeOnPath=$false;Authentication='Individual fictitious account; type password locally';FirstScreenVisuallyChecked=$false}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path $Receipt) 'cliente-pichau-isolado.json') -Encoding utf8
$result
