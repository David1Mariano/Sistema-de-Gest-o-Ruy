# Run interactively as the laboratory Windows user, never elevated.
# Input is local; never place the API key in command arguments or chat.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Use a non-elevated terminal.' }
$labHome = Join-Path $env:LOCALAPPDATA 'GestaoRuy\installation-final-dev-20261021'
$marker = Get-Content -LiteralPath (Join-Path $labHome 'lab.json') -Raw | ConvertFrom-Json
if ($marker.installationId -ne 'final-dev-20261021' -or $marker.purpose -ne 'RUY_D1_SYNTHETIC_ONLY') { throw 'Laboratory identity refused.' }
$target = Join-Path $labHome 'brevo-candidate.dpapi'
if (Test-Path -LiteralPath $target) { throw 'Candidate exists; no overwrite performed.' }
$sender = Read-Host 'Sender email already verified in Brevo'
$recipient = Read-Host 'Authorized test recipient email'
foreach ($address in @($sender,$recipient)) { if ($address.Length -gt 254 -or $address -notmatch '^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$') { throw 'Invalid address.' } }
if ((Read-Host 'Confirm the sender is verified in Brevo: type VERIFIED') -cne 'VERIFIED') { throw 'Sender verification required.' }
$secret = Read-Host 'Brevo API key (hidden; not the SMTP key)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
 $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 if ($apiKey.Length -lt 20 -or $apiKey.Length -gt 512 -or $apiKey -match '\s') { throw 'Invalid key format.' }
 $payload = @{purpose='RUY_BREVO_IDENTITY_DEV';installationId='final-dev-20261021';provider='brevo';apiKey=$apiKey;senderEmail=$sender;recipient=$recipient.ToLowerInvariant();senderVerified=$true;deliveryConfirmed=$false} | ConvertTo-Json -Compress
 $encrypted = ConvertFrom-SecureString (ConvertTo-SecureString $payload -AsPlainText -Force)
 $stream = [IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try { $bytes = [Text.Encoding]::UTF8.GetBytes($encrypted); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
 Write-Host 'Protected candidate saved. No email sent; application configuration unchanged.'
} finally {
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
 $apiKey = $null; $payload = $null; $secret.Dispose()
}
