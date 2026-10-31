[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PublicCertificate,[Parameter(Mandatory=$true)][string]$ExpectedSha256,[string]$Authorization,[switch]$Apply)
$ErrorActionPreference='Stop'
$file=(Resolve-Path -LiteralPath $PublicCertificate).Path
$hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
if($ExpectedSha256 -notmatch '^[a-f0-9]{64}$' -or $hash -ne $ExpectedSha256){throw 'Certificado publico divergente; verificar hash por canal administrativo confiavel'}
$cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2($file)
$ca=@($cert.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.19'})
if($cert.HasPrivateKey -or $ca.Count -ne 1 -or !$ca[0].CertificateAuthority -or $cert.Subject -ne $cert.Issuer -or $cert.NotBefore -gt (Get-Date) -or $cert.NotAfter -le (Get-Date)){throw 'Somente raiz CA publica valida; nenhuma chave privada ou certificado de dispositivo'}
if(!$Apply){[pscustomobject]@{DryRun=$true;Computer=$env:COMPUTERNAME;PublicCA=$cert.Subject;SHA256=$hash;PrivateKey=$cert.HasPrivateKey;Store='CurrentUser\Root';TrustChanged=$false};return}
if($env:COMPUTERNAME -eq 'ADM-RUY'){throw 'Nao modificar confianca na maquina operacional nesta homologacao'}
if(!$Authorization){throw 'Autorizar explicitamente a confianca desta CA neste Windows'}
$a=Get-Content -LiteralPath $Authorization -Raw | ConvertFrom-Json
if($a.trustServerCaApproved -ne $true -or $a.computer -ne $env:COMPUTERNAME -or $a.caSha256 -ne $hash -or !$a.approvedBy -or !$a.expiresAt -or [DateTimeOffset]::Parse($a.expiresAt) -le [DateTimeOffset]::Now){throw 'Autorizacao invalida'}
$already=Test-Path -LiteralPath ('Cert:\CurrentUser\Root\'+$cert.Thumbprint)
if(!$already){Import-Certificate -FilePath $file -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null}
[pscustomobject]@{Trusted=$true;AlreadyPresent=$already;Thumbprint=$cert.Thumbprint;PrivateKey=$false;DeviceApprovalRequired=$false;Scope='CurrentUser Root; administrator must validate CA ownership before applying'}
