param([Parameter(Mandatory=$true)][string]$Release)
$ErrorActionPreference = 'Stop'
$name = 'SistemaRuyCentralRc1'
$resultFile = Join-Path $Release 'service-install-result.json'
try {
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMINISTRATOR_REQUIRED' }
    $resolved = [IO.Path]::GetFullPath($Release)
    $parent = Join-Path $env:ProgramData 'SistemaRuyConsulta'
    if ([IO.Path]::GetDirectoryName($resolved) -ne $parent -or [IO.Path]::GetFileName($resolved) -notmatch '^release-20261029-[a-f0-9]{16}$') { throw 'EXACT_RELEASE_DIRECTORY_REQUIRED' }
    if ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REDIRECTED_RELEASE_REFUSED' }
    if (Get-Service -Name $name -ErrorAction SilentlyContinue) { throw 'EXISTING_SERVICE_PRESERVED' }
    $d = Get-Content -LiteralPath (Join-Path $resolved 'deployment.json') -Raw | ConvertFrom-Json
    if ($d.base -ne $resolved -or $d.serviceName -ne $name -or $d.backupHashesVerified -ne 2) { throw 'VERIFIED_RELEASE_REQUIRED' }
    $manifest = Get-Content -LiteralPath (Join-Path $resolved 'code-manifest.json') -Raw | ConvertFrom-Json
    foreach ($entry in $manifest.files) {
        $file = [IO.Path]::GetFullPath((Join-Path $d.app $entry.path))
        if (-not $file.StartsWith($d.app + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'CODE_PATH_REFUSED' }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'CODE_HASH_MISMATCH' }
    }
    $account = 'NT SERVICE\' + $name
    $binary = '"' + (Join-Path $d.app 'runtime\RuyCentralService.exe') + '" --service "' + (Join-Path $d.app 'runtime\node.exe') + '" "' + (Join-Path $d.app 'scripts\central\consultation-supervisor.mjs') + '" "' + $d.profile + '"'
    $stage = 'SCM_CREATE'
    # WMI validates the account before the service SID exists. Register stopped
    # under LocalService first, then set the virtual identity before any start.
    $created = Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{Name=$name;DisplayName='Sistema Ruy - consulta central somente leitura';PathName=$binary;ServiceType=[byte]16;ErrorControl=[byte]1;StartMode='Manual';DesktopInteract=$false;StartName='NT AUTHORITY\LocalService';StartPassword=''}
    if ($created.ReturnValue -ne 0) { throw ('SCM_CREATE_FAILED_' + $created.ReturnValue) }
    & sc.exe config $name obj= $account | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'VIRTUAL_SERVICE_IDENTITY_FAILED' }
    & sc.exe sidtype $name unrestricted | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SERVICE_SID_CONFIGURATION_FAILED' }
    $serviceSid = (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value
    & icacls.exe $resolved /grant:r ("*$($serviceSid):(OI)(CI)RX") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SERVICE_CODE_ACCESS_FAILED' }
    & icacls.exe $d.dataRoot /grant:r ("*$($serviceSid):(OI)(CI)M") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SERVICE_PRIVATE_DATA_ACCESS_FAILED' }
    & sc.exe config $name start= delayed-auto | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SERVICE_AUTOSTART_FAILED' }
    & sc.exe failure $name reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SERVICE_RECOVERY_FAILED' }
    & sc.exe failureflag $name 1 | Out-Null
    $sddl = @(& sc.exe sdshow $name | Where-Object { $_ -match '^D:' })
    if ($sddl.Count -ne 1) { throw 'OWNED_SERVICE_DACL_REQUIRED' }
    $ace = '(A;;CCLCSWRPWPLOCRRC;;;' + $d.userSid + ')'
    $descriptor = $sddl[0].Trim()
    $split = $descriptor.IndexOf('S:')
    if ($split -ge 0) { $descriptor = $descriptor.Insert($split, $ace) } else { $descriptor += $ace }
    & sc.exe sdset $name $descriptor | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'OWNED_SERVICE_OPERATOR_CONTROL_FAILED' }
    $result = [ordered]@{at=[DateTime]::UtcNow.ToString('o');installed=$true;service=$name;account=$account;serviceSid=$serviceSid;running=$false;delayedAutomatic=$true;recoverySeconds=@(5,15,60);otherServicesModified=$false;rebooted=$false;firewallChanged=$false}
    [IO.File]::WriteAllText($resultFile,($result|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
} catch {
    $safeCode = if ($_.Exception.Message -match '^[A-Z0-9_]+$') { $_.Exception.Message } else { 'SERVICE_INSTALLATION_FAILED' }
    [IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');installed=$false;code=$safeCode;stage=$stage;exceptionType=$_.Exception.GetType().FullName;line=$_.InvocationInfo.ScriptLineNumber;service=$name;otherServicesModified=$false}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
    exit 2
}
