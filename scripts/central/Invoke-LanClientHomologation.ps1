[CmdletBinding()]
param([switch]$ConfiarCa)
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'RUI-PC-ESTOQUE'){throw 'Executar localmente no RUI-PC-ESTOQUE; nenhuma administracao remota'}
$bundle=$PSScriptRoot
$authorization=Join-Path $bundle 'autorizacao-homologacao.json'
$a=Get-Content -LiteralPath $authorization -Raw | ConvertFrom-Json
if($a.computer -ne $env:COMPUTERNAME -or $a.testLanConnectivityApproved -ne $true -or [DateTimeOffset]::Parse($a.expiresAt) -le [DateTimeOffset]::Now){throw 'Autorizacao temporaria invalida ou expirada'}
if($null -ne [Net.ServicePointManager]::ServerCertificateValidationCallback){throw 'Executar em PowerShell novo, sem excecoes de TLS'}
$proof=[ordered]@{Computer=$env:COMPUTERNAME;Timestamp=[DateTimeOffset]::UtcNow.ToString('o');Endpoint='https://ADM-RUY:18716/';Resolved=@();TcpByName=$false;TcpByObservedIp=$false;TrustedTlsByIpWithAdmRuyName=$false;ApiAvailable=$false;LoginRequired=$false;ConfigurationChanged=@();InstalledVersion=$null;InstalledExe=$null;Shortcuts=@();Errors=@();RealDataUsed=$false}
if($ConfiarCa){
 $trust=& (Join-Path $bundle 'Trust-ServerPublicCa.ps1') -PublicCertificate (Join-Path $bundle 'Ruy-Homologacao-CA.cer') -ExpectedSha256 $a.caSha256 -Authorization $authorization -Apply
 $trustReceipt=Join-Path $bundle 'confianca-aplicada.json'
 if(!(Test-Path -LiteralPath $trustReceipt)){$trust | ConvertTo-Json | Set-Content -LiteralPath $trustReceipt -Encoding utf8}
 if(!$trust.AlreadyPresent){$proof.ConfigurationChanged+= 'Somente CA publica de homologacao em CurrentUser Root'}
}
try{$proof.Resolved=@([Net.Dns]::GetHostAddresses('ADM-RUY') | ForEach-Object {$_.IPAddressToString})}catch{$proof.Errors+='ADM-RUY nao resolveu pelo mecanismo usado pelo aplicativo'}
function Test-TcpQuick([string]$Computer){
 $socket=New-Object Net.Sockets.TcpClient
 try{$task=$socket.ConnectAsync($Computer,18716);if(!$task.Wait(5000)){return $false};return $socket.Connected}catch{return $false}finally{$socket.Dispose()}
}
if($proof.Resolved.Count){$proof.TcpByName=Test-TcpQuick 'ADM-RUY'}
# Observed DHCP address is diagnostic only; it is never installed as the API URL.
$proof.TcpByObservedIp=Test-TcpQuick '192.168.1.102'
if($proof.TcpByObservedIp){
 $socket=New-Object Net.Sockets.TcpClient
 try{
  $socket.Connect('192.168.1.102',18716)
  $stream=New-Object Net.Security.SslStream($socket.GetStream(),$false)
  try{$stream.ReadTimeout=10000;$stream.WriteTimeout=10000;$stream.AuthenticateAsClient('ADM-RUY');$proof.TrustedTlsByIpWithAdmRuyName=$stream.IsAuthenticated -and $stream.IsEncrypted}finally{$stream.Dispose()}
 }catch{$proof.Errors+=('TLS: '+$_.Exception.Message)}finally{$socket.Dispose()}
}
if($proof.TcpByName){
 try{
  $headers=@{'X-Ruy-Sync-Contract'='RUY-SHARED-LAB/1'}
  $r=Invoke-WebRequest -UseBasicParsing -Uri 'https://ADM-RUY:18716/api/local/d1/connection' -Headers $headers -TimeoutSec 10 -MaximumRedirection 0
  $proof.ApiAvailable=$r.StatusCode -eq 200 -and ($r.Content | ConvertFrom-Json).available -eq $true
  try{$private=Invoke-WebRequest -UseBasicParsing -Uri 'https://ADM-RUY:18716/api/local/d1/state' -Headers $headers -TimeoutSec 10 -MaximumRedirection 0;$proof.LoginRequired=$false}catch{if($_.Exception.Response){$proof.LoginRequired=[int]$_.Exception.Response.StatusCode -eq 401}else{throw}}
 }catch{$proof.Errors+=('API: '+$_.Exception.Message)}
}
$guid='75c7b9b8-6d06-4bf1-89d1-4e566b45c050'
$entry=Get-ItemProperty -LiteralPath ('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid) -ErrorAction SilentlyContinue
$location=(Get-ItemProperty -LiteralPath ('HKCU:\Software\'+$guid) -ErrorAction SilentlyContinue).InstallLocation
if($entry){$proof.InstalledVersion=$entry.DisplayVersion}
if($location){$proof.InstalledExe=Join-Path $location 'Sistema Ruy.exe'}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
 $f=Join-Path $folder 'Sistema Ruy.lnk';$exists=Test-Path -LiteralPath $f
 $target=$null;$arguments=$null;if($exists){$link=$shell.CreateShortcut($f);$target=$link.TargetPath;$arguments=$link.Arguments}
 $proof.Shortcuts+= [pscustomobject]@{Path=$f;Exists=$exists;Target=$target;Arguments=$arguments;Valid=$exists -and $target -eq $proof.InstalledExe -and !$arguments}
}
$proof.Passed=$proof.ApiAvailable -and $proof.LoginRequired -and $proof.InstalledVersion -eq '0.10.0-rc.2'
$proof | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $bundle 'RESULTADO-RUI-PC-ESTOQUE.json') -Encoding utf8
$proof | ConvertTo-Json -Depth 6
Write-Host 'Devolva RESULTADO-RUI-PC-ESTOQUE.json. Nenhuma senha ou token foi solicitado ou registrado.'
