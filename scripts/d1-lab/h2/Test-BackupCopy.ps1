param(
    [Parameter(Mandatory=$true)][string]$LocalBackup,
    [Parameter(Mandatory=$true)][string]$ExternalBackup,
    [Parameter(Mandatory=$true)][string]$RecoveryKey
)
$ErrorActionPreference = 'Stop'
foreach ($pair in @(@($LocalBackup,'.ruybak'),@($ExternalBackup,'.ruybak'),@($RecoveryKey,'.ruykey'))) {
    $file = Get-Item -LiteralPath $pair[0]
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Extension -ne $pair[1]) { throw 'Invalid backup/key file.' }
}
if ((Resolve-Path -LiteralPath $LocalBackup).Path -eq (Resolve-Path -LiteralPath $ExternalBackup).Path) { throw 'A separate copy is required.' }
$localHash = (Get-FileHash -LiteralPath $LocalBackup -Algorithm SHA256).Hash.ToLowerInvariant()
$externalHash = (Get-FileHash -LiteralPath $ExternalBackup -Algorithm SHA256).Hash.ToLowerInvariant()
if ($localHash -ne $externalHash) { throw 'Backup copies have different hashes.' }
$key = Get-Item -LiteralPath $RecoveryKey
if ($key.Length -gt 8192) { throw 'Invalid key envelope size.' }
$envelope = Get-Content -LiteralPath $RecoveryKey -Raw | ConvertFrom-Json
if ($envelope.purpose -ne 'RUY_D1_RECOVERY_KEY' -or $envelope.version -ne 1 -or $envelope.kdf -ne 'scrypt-131072-8-1') { throw 'Invalid protected recovery-key envelope.' }
@{copyHashVerified = $true; sha256 = $localHash; keySha256 = (Get-FileHash -LiteralPath $RecoveryKey -Algorithm SHA256).Hash.ToLowerInvariant(); authenticatedDecryption = 'pending-application-restore'; physicalIndependence = 'pending'; attachmentsAndQueue = 'pending-restore'; externalProtected = $false} | ConvertTo-Json
