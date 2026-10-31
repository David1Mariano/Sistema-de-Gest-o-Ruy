[CmdletBinding()]
param([string]$Authorization,[switch]$Execute)
$ErrorActionPreference='Stop'
$endpoint='https://ADM-RUY:18716'
if(!$Execute){[pscustomobject]@{DryRun=$true;Computer=$env:COMPUTERNAME;Endpoint=$endpoint;Checks=@('OS name resolution','TCP 18716','trusted HTTPS and hostname','unauthenticated data rejected');RemoteAdministration=$false;ProbesExecuted=$false};return}
if($env:COMPUTERNAME -eq 'ADM-RUY' -or ($env:COMPUTERNAME -ne 'RUI-PC-ESTOQUE' -and $env:COMPUTERNAME -notlike 'RUY-HOMOLOG-*')){throw 'Executar localmente no segundo Windows autorizado; teste no proprio servidor nao comprova acesso do cliente'}
if(!$Authorization){throw 'Autorizacao especifica de teste local obrigatoria'}
$a=Get-Content -LiteralPath $Authorization -Raw | ConvertFrom-Json
if($a.testLanConnectivityApproved -ne $true -or $a.computer -ne $env:COMPUTERNAME -or !$a.approvedBy -or !$a.expiresAt -or [DateTimeOffset]::Parse($a.expiresAt) -le [DateTimeOffset]::Now){throw 'Autorizacao de teste invalida'}
if($null -ne [Net.ServicePointManager]::ServerCertificateValidationCallback){throw 'Remova a excecao de validacao TLS deste processo e execute um PowerShell novo'}
$proof=[ordered]@{Computer=$env:COMPUTERNAME;Endpoint=$endpoint;Timestamp=[DateTimeOffset]::UtcNow.ToString('o');Dns=$false;Tcp=$false;TrustedTls=$false;ApiReady=$false;RequiresLogin=$false;ConfigurationChanged=$false;CredentialsSent=$false;RemoteAdministration=$false}
try{
 $resolved=@(Resolve-DnsName ADM-RUY -ErrorAction Stop | Where-Object {$_.IPAddress} | Select-Object -ExpandProperty IPAddress)
 if(!$resolved.Count){throw 'Nome ADM-RUY sem endereco'}
 $proof.Dns=$true;$proof.Addresses=$resolved
 $tcp=Test-NetConnection -ComputerName ADM-RUY -Port 18716 -InformationLevel Detailed -WarningAction SilentlyContinue
 if(!$tcp.TcpTestSucceeded){throw 'TCP 18716 indisponivel; revisar servidor/rota/firewall sem alterar automaticamente'}
 $proof.Tcp=$true;$headers=@{'X-Ruy-Sync-Contract'='RUY-SHARED-LAB/1'}
 $response=Invoke-WebRequest -UseBasicParsing -Uri ($endpoint+'/api/local/d1/connection') -Headers $headers -TimeoutSec 10 -MaximumRedirection 0
 if($response.StatusCode -ne 200 -or ($response.Content | ConvertFrom-Json).available -ne $true){throw 'API central nao confirmou disponibilidade'}
 $proof.TrustedTls=$true;$proof.ApiReady=$true
 $status=$null
 try{$private=Invoke-WebRequest -UseBasicParsing -Uri ($endpoint+'/api/local/d1/state') -Headers $headers -TimeoutSec 10 -MaximumRedirection 0;$status=[int]$private.StatusCode}catch{if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode}else{throw}}
 if($status -ne 401){throw 'Acesso sem login nao foi recusado como esperado'}
 $proof.RequiresLogin=$true;$proof.Passed=$true
}catch{$proof.Passed=$false;$proof.Error=$_.Exception.Message}
[pscustomobject]$proof
