param(
    [ValidateSet('Laboratorio','AntesInstalar','AposAbrir','AntesReboot','AposReboot','AposReinstalar')]
    [string]$Stage = 'AntesInstalar',
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
    [string]$ExternalDirectory,
    [string]$EvidenceDirectory = (Join-Path $PSScriptRoot 'evidencias')
)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Windows required.' }
function Get-LocalResponse([string]$Route, [hashtable]$Headers = @{}) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:18087' + $Route) -Headers $Headers -TimeoutSec 5 -MaximumRedirection 0
        $service = $null; $mode = $null; $syncEnabled = $null
        if ($Route -eq '/health' -and $Headers.Count -eq 0) {
            $body = $response.Content | ConvertFrom-Json
            $service = $body.service; $mode = $body.mode; $syncEnabled = $body.syncEnabled
        }
        return @{status = [int]$response.StatusCode; service = $service; mode = $mode; syncEnabled = $syncEnabled}
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        return @{status = $status; unavailable = ($null -eq $status)}
    }
}
$os = Get-CimInstance Win32_OperatingSystem
$machine = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid
$hasher = [Security.Cryptography.SHA256]::Create()
try { $machineHash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($machine)))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
$required = @('postgres','pg_ctl','initdb','pg_dump','pg_restore')
$executables = @($required | ForEach-Object { @{name = $_; present = (Test-Path -LiteralPath (Join-Path $PostgresBin ($_ + '.exe')) -PathType Leaf)} })
$version = $null
if (@($executables | Where-Object { -not $_.present }).Count -eq 0) {
    try { $version = (& (Join-Path $PostgresBin 'postgres.exe') --version 2>$null | Out-String).Trim(); if ($LASTEXITCODE -ne 0) { $version = $null } } catch { $version = $null }
}
$listeners = @(); $listenerInspection = 'verified'
try { $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(18087,55436) } | ForEach-Object { @{port = $_.LocalPort; address = $_.LocalAddress} }) } catch { $listenerInspection = 'unavailable' }
$external = @{configuredByThisScript = $false; supplied = [bool]$ExternalDirectory; physicalIndependence = 'pending'; restoreValidated = $false; protected = $false}
if ($ExternalDirectory) {
    $item = Get-Item -LiteralPath $ExternalDirectory
    if (-not $item.PSIsContainer) { throw 'External destination must be an existing directory.' }
    $external.exists = $true
    try {
        $drive = $item.PSDrive.Name
        $localDrive = [IO.Path]::GetPathRoot($env:LOCALAPPDATA).Substring(0,1)
        $destinationDisk = Get-Partition -DriveLetter $drive -ErrorAction Stop | Get-Disk -ErrorAction Stop
        $localDisk = Get-Partition -DriveLetter $localDrive -ErrorAction Stop | Get-Disk -ErrorAction Stop
        $external.physicalIndependence = $(if ($destinationDisk.Number -eq $localDisk.Number) {'same-disk-rejected'} else {'different-disk-candidate-requires-restore'})
    } catch { $external.physicalIndependence = 'unknown-requires-manual-verification' }
}
$health = Get-LocalResponse '/health'
$unauthenticated = Get-LocalResponse '/api/d1/me'
$foreignOrigin = Get-LocalResponse '/health' @{Origin = 'https://h2.example.invalid'}
$record = [ordered]@{
    purpose = 'RUY_H2_OBSERVATION_ONLY'; createdAt = [DateTime]::UtcNow.ToString('o'); stage = $Stage
    machineHash = $machineHash; windowsVersion = $os.Version; windowsBuild = $os.BuildNumber
    lastBootUtc = $os.LastBootUpTime.ToUniversalTime().ToString('o'); os64bit = [Environment]::Is64BitOperatingSystem
    postgres = @{executables = $executables; version = $version; version17 = [bool]($version -match 'PostgreSQL\) 17\.')}
    runtime = @{electronBundled = $true; separateWebView2Required = $false; actualApplicationLaunch = 'manual-pending'}
    api = @{health = $health; unauthenticated = $unauthenticated; foreignOrigin = $foreignOrigin; anonymousDenied = ($unauthenticated.status -eq 401); foreignOriginDenied = ($foreignOrigin.status -eq 403)}
    network = @{inspection = $listenerInspection; listeners = $listeners; publicListenerDetected = [bool](@($listeners | Where-Object {$_.address -ne '127.0.0.1'}).Count); offlinePhysicalTest = 'manual-pending'}
    externalBackup = $external
    manualAcceptance = @{otherWindows = 'pending'; offlineLogin = 'pending'; recordsAndQueue = 'pending'; reboot = 'pending'; restore = 'pending'; cloudNeverGreen = 'pending'}
    noInstallRebootServiceDatabaseOrCredentialChange = $true
}
$null = New-Item -ItemType Directory -Path $EvidenceDirectory -Force
$file = Join-Path $EvidenceDirectory ($Stage + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + [Guid]::NewGuid().ToString('N') + '.json')
$record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $file -Encoding UTF8
Write-Output $file
Write-Output 'Observation saved; no automatic functional, reboot or external-backup approval.'
