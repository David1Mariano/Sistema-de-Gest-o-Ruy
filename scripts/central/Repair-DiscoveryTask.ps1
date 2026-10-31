param([Parameter(Mandatory=$true)][string]$Release)
$ErrorActionPreference='Stop'
$name='SistemaRuyConsulta-Descoberta'
$resultFile=Join-Path $Release 'discovery-task-interactive.json'
try {
 if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_REQUIRED'}
 $root=[IO.Path]::GetFullPath($Release)
 if([IO.Path]::GetDirectoryName($root) -ne (Join-Path $env:ProgramData 'SistemaRuyConsulta') -or [IO.Path]::GetFileName($root) -notmatch '^release-20261029-[a-f0-9]{16}$'){throw 'EXACT_RELEASE_REQUIRED'}
 $d=Get-Content -LiteralPath (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
 $task=Get-ScheduledTask -TaskName $name -ErrorAction Stop
 if($task.Actions.Execute -ne (Join-Path $d.app 'runtime\RuyCentralService.exe') -or -not $task.Actions.Arguments.Contains($d.profile)){throw 'OTHER_TASK_PRESERVED'}
 Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $root 'discovery-task-before-interactive.xml') -Encoding UTF8
 Stop-ScheduledTask -TaskName $name
 $principal=New-ScheduledTaskPrincipal -UserId $d.userSid -LogonType Interactive -RunLevel Limited
 Set-ScheduledTask -TaskName $name -Principal $principal | Out-Null
 [IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');configured=$true;task=$name;logonType='Interactive';runLevel='Limited';passwordSupplied=$false;metadataOnly=$true;started=$false;requiresOwnerWindowsSession=$true}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 $request=Join-Path $root 'start-discovery-task-interactive.request'
 $deadline=[DateTime]::UtcNow.AddMinutes(2)
 while(-not(Test-Path -LiteralPath $request) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 300}
 if(Test-Path -LiteralPath $request){Start-ScheduledTask -TaskName $name;[IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');configured=$true;task=$name;logonType='Interactive';runLevel='Limited';passwordSupplied=$false;metadataOnly=$true;started=$true;requiresOwnerWindowsSession=$true}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))}
}catch{
 [IO.File]::WriteAllText($resultFile,([ordered]@{configured=$false;code='OWNED_DISCOVERY_TASK_REPAIR_FAILED';line=$_.InvocationInfo.ScriptLineNumber}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 exit 2
}
