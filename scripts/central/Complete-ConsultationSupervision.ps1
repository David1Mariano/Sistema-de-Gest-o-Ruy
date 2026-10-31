param([Parameter(Mandatory=$true)][string]$Release)
$ErrorActionPreference='Stop'
$resultFile=Join-Path $Release 'supervision-final-settings.json'
try {
 if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_REQUIRED'}
 $root=[IO.Path]::GetFullPath($Release)
 if([IO.Path]::GetDirectoryName($root) -ne (Join-Path $env:ProgramData 'SistemaRuyConsulta') -or [IO.Path]::GetFileName($root) -notmatch '^release-20261029-[a-f0-9]{16}$'){throw 'EXACT_RELEASE_REQUIRED'}
 $d=Get-Content -LiteralPath (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
 $name='SistemaRuyConsultaPostgres'
 $service=Get-CimInstance Win32_Service -Filter "Name='$name'"
 if($service.StartName -ne ('NT SERVICE\'+$name) -or -not $service.PathName.Contains('installation-final-dev-20261021') -or -not $service.PathName.Contains('55483')){throw 'EXACT_PRIVATE_SERVICE_REQUIRED'}
 & sc.exe failureflag $name 1 | Out-Null
 if($LASTEXITCODE -ne 0){throw 'PRIVATE_SERVICE_FAILURE_FLAG_FAILED'}
 $old=Get-ScheduledTask -TaskName 'SistemaRuyConsulta-Descoberta' -ErrorAction SilentlyContinue
 if($old){
  if($old.Actions.Execute -ne (Join-Path $d.app 'runtime\RuyCentralService.exe') -or -not $old.Actions.Arguments.Contains($d.profile)){throw 'OTHER_TASK_PRESERVED'}
  $current=Get-ScheduledTask -TaskName 'SistemaRuyConsulta-DescobertaUsuario' -ErrorAction Stop
  if($current.State -ne 'Running' -or $current.Principal.LogonType -ne 'Interactive'){throw 'REPLACEMENT_TASK_MUST_BE_RUNNING'}
  Export-ScheduledTask -TaskName $old.TaskName | Set-Content -LiteralPath (Join-Path $root 'superseded-discovery-task.xml') -Encoding UTF8
  Disable-ScheduledTask -TaskName $old.TaskName | Out-Null
 }
 [IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');passed=$true;databaseNonCrashFailureRecovery=$true;supersededDiscoveryTaskDisabled=[bool]$old;dataModified=$false;rebooted=$false;originalServicesChanged=$false}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
}catch{
 [IO.File]::WriteAllText($resultFile,([ordered]@{passed=$false;code=if($_.Exception.Message -match '^[A-Z0-9_]+$'){$_.Exception.Message}else{'SUPERVISION_FINAL_SETTINGS_FAILED'};line=$_.InvocationInfo.ScriptLineNumber;dataModified=$false}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 exit 2
}
