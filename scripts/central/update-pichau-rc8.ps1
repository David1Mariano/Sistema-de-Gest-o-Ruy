$ErrorActionPreference = 'Stop'
$project = 'C:\Users\Pichau\gestao-ruy-integracao-auditoria-20261019'
$release = Join-Path $project 'artifacts\multicomputador-0.10.0-rc.8-20261030'
$metadata = Get-Content -LiteralPath (Join-Path $release 'release.json') -Raw | ConvertFrom-Json
$location = Get-Content -LiteralPath (Join-Path $project 'artifacts\consulta-ativacao-20261029\location.json') -Raw | ConvertFrom-Json
$deployment = Get-Content -LiteralPath (Join-Path $release 'deployment-result.json') -Raw | ConvertFrom-Json
if (-not $deployment.applied -or $metadata.version -ne '0.10.0-rc.8') { throw 'Published rc.8 required.' }
$install = Join-Path $env:LOCALAPPDATA 'Programs\Sistema Ruy'
$executable = Join-Path $install 'Sistema Ruy.exe'
function Assert-Closed {
    $running = @(Get-CimInstance Win32_Process -Filter "Name='Sistema Ruy.exe'" | Where-Object { $_.ExecutablePath -eq $executable })
    if ($running.Count) { throw 'Sistema Ruy is open. Installation was not changed.' }
}
Assert-Closed
if ((Get-FileHash -LiteralPath $metadata.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256) { throw 'Installer hash mismatch.' }
$previousVersion = (Get-Item -LiteralPath $executable).VersionInfo.FileVersion
if ($previousVersion -eq $metadata.version) {
    $saved = Get-ChildItem -LiteralPath $location.base -Directory | Where-Object {$_.Name -like 'client-before-rc8-*'} | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $saved -or (Get-Item -LiteralPath (Join-Path $saved.FullName 'Sistema Ruy.exe')).VersionInfo.FileVersion -ne '0.10.0-rc.7') { throw 'Previous installation backup required.' }
    $backup = $saved.FullName
} else {
if ($previousVersion -ne '0.10.0-rc.7') { throw 'Unexpected installed version; preserve installation.' }
$backup = Join-Path $location.base ('client-before-rc8-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
Get-ChildItem -LiteralPath $install -Force | Copy-Item -Destination $backup -Recurse -Force
foreach ($relative in @('Sistema Ruy.exe','resources\app.asar')) {
    if ((Get-FileHash -LiteralPath (Join-Path $install $relative)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $backup $relative)).Hash) { throw 'Previous installation backup mismatch.' }
}
Assert-Closed
$process = Start-Process -FilePath $metadata.file -ArgumentList @('/S','/currentuser') -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode). Previous installation backup preserved: $backup" }
}
$version = (Get-Item -LiteralPath $executable).VersionInfo.FileVersion
if ($version -ne $metadata.version) { throw 'Installed executable version mismatch.' }
$shortcuts = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sistema Ruy.lnk'),(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Sistema Ruy.lnk'))
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcut in $shortcuts) {
    if (-not (Test-Path -LiteralPath $shortcut)) { throw "Shortcut missing: $shortcut" }
    if ($shell.CreateShortcut($shortcut).TargetPath -ne $executable) { throw 'Shortcut does not point to installed executable.' }
}
$entries = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Get-ItemProperty | Where-Object { $_.PSChildName -eq '75c7b9b8-6d06-4bf1-89d1-4e566b45c050' })
if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -ne $metadata.version) { throw 'Installed program entry is missing or duplicated.' }
$result = [ordered]@{at=(Get-Date).ToUniversalTime().ToString('o');updated=$true;version=$version;install=$install;previousInstallationBackup=$backup;shortcuts=$shortcuts;installedProgramEntries=$entries.Count;profilePreserved=$true;originalDatabasesModified=$false;windowsRebooted=$false}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $release 'pichau-update.json') -Encoding UTF8
$result | ConvertTo-Json -Depth 5
