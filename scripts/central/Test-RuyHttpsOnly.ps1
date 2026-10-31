# Read-only continuation after the physical TCP test has passed.
# No raw TCP probe, trust import, DNS update, credential or login attempt.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'RUI-PC-ESTOQUE'){throw "Computador atual: $env:COMPUTERNAME. Executar no RUI-PC-ESTOQUE."}
if($null -ne [Net.ServicePointManager]::ServerCertificateValidationCallback){throw 'Abra um PowerShell novo, sem excecoes de TLS.'}
$p=[ordered]@{Computador=$env:COMPUTERNAME;Nome=@();CAConfiavel=$false;HTTPS=$null;API=$false;Erro=$null}
$raiz='2D1FAD108A72E42A16CD1C0D2140B4DFF8545116'
$p.CAConfiavel=(Test-Path "Cert:\CurrentUser\Root\$raiz") -or (Test-Path "Cert:\LocalMachine\Root\$raiz")
try{
 $p.Nome=@([Net.Dns]::GetHostAddresses('ADM-RUY') | ForEach-Object {$_.IPAddressToString})
 $r=Invoke-WebRequest -UseBasicParsing -Uri 'https://ADM-RUY:18716/api/local/d1/connection' -Headers @{'X-Ruy-Sync-Contract'='RUY-SHARED-LAB/1'} -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction Stop
 $p.HTTPS=[int]$r.StatusCode
 $p.API=($r.Content | ConvertFrom-Json).available
}catch{$p.Erro=$_.Exception.GetBaseException().Message}
$p | ConvertTo-Json -Depth 3
