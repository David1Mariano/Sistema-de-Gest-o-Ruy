[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'RUI-PC-ESTOQUE'){throw 'Somente no segundo Windows autorizado'}
$receipt=Join-Path $PSScriptRoot 'confianca-aplicada.json'
if(!(Test-Path -LiteralPath $receipt)){throw 'Sem recibo local; nenhuma confianca alterada'}
$r=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
$cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2((Join-Path $PSScriptRoot 'Ruy-Homologacao-CA.cer'))
if($cert.Thumbprint -ne $r.Thumbprint -or $cert.HasPrivateKey){throw 'Certificado divergente'}
if($r.AlreadyPresent){Write-Output 'Confianca anterior preservada; nao foi adicionada por esta homologacao';return}
$target='Cert:\CurrentUser\Root\'+$cert.Thumbprint
if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target}
Write-Output 'Removida somente a CA publica adicionada por esta homologacao. Instalacao e perfis preservados.'
