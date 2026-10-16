param([string]$PackageDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PackageDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $root 'package-manifest.json') -Raw | ConvertFrom-Json
$expected = '4e65feaa43612911494863f1f6689dc868960e1c86fdc8b6f73029ece9937c91'
if ($manifest.installerSha256 -ne $expected) { throw 'Unexpected H1 installer identity.' }
foreach ($entry in $manifest.files) {
    if ($entry.name -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Invalid package member.' }
    $file = Get-Item -LiteralPath (Join-Path $root $entry.name)
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected package member.' }
    if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw ('Hash mismatch: ' + $entry.name) }
}
$installer = Join-Path $root 'Sistema-Gestao-Ruy-Lab-0.5.0-H1-Setup.exe'
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'H1 installer changed.' }
Write-Output 'H2_PACKAGE_INTEGRITY_OK. Functional acceptance, reboot and restore remain manual.'
