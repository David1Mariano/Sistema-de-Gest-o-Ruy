$ErrorActionPreference = 'Stop'
# Read-only inventory. Never send signals, close terminals, or print command lines.
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 18080 -ErrorAction SilentlyContinue)
$result = foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)"
    $ancestor = if ($parent) { Get-CimInstance Win32_Process -Filter "ProcessId=$($parent.ParentProcessId)" }
    [pscustomobject]@{
        Port = 18080
        Address = $listener.LocalAddress
        ProcessId = $process.ProcessId
        Name = $process.Name
        Started = $process.CreationDate.ToString('o')
        Script = @([regex]::Matches($process.CommandLine, '[A-Za-z0-9_./\\-]+\.mjs') | ForEach-Object { $_.Value })
        ParentId = $process.ParentProcessId
        ParentName = $parent.Name
        AncestorId = $parent.ParentProcessId
        AncestorName = $ancestor.Name
        ShutdownRequested = $false
    }
}
@($result) | ConvertTo-Json -Depth 3
