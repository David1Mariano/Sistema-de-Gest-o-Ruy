param([Parameter(Mandatory=$true)][string]$Release)
$ErrorActionPreference='Stop'
$name='SistemaRuyConsulta-DescobertaUsuario'
$resultFile=Join-Path $Release 'discovery-task-install.json'
try {
 $root=[IO.Path]::GetFullPath($Release)
 if([IO.Path]::GetDirectoryName($root) -ne (Join-Path $env:ProgramData 'SistemaRuyConsulta') -or [IO.Path]::GetFileName($root) -notmatch '^release-20261029-[a-f0-9]{16}$'){throw 'EXACT_RELEASE_REQUIRED'}
 if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'EXISTING_TASK_PRESERVED'}
 $d=Get-Content -LiteralPath (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
 $profile=Get-Content -LiteralPath (Join-Path $d.profile 'consultation.json') -Raw|ConvertFrom-Json
 if(-not $profile.legacyDiscovery.perUserTaskApproved -or -not $profile.legacyDiscovery.publicationApproved){throw 'METADATA_ONLY_TASK_APPROVAL_REQUIRED'}
 $action=New-ScheduledTaskAction -Execute (Join-Path $d.app 'runtime\RuyCentralService.exe') -Argument ('--task "'+(Join-Path $d.app 'runtime\node.exe')+'" "'+(Join-Path $d.app 'scripts\central\discovery-task.mjs')+'" "'+$d.profile+'"') -WorkingDirectory $d.app
 # Microsoft Store execution requires the package owner's interactive session.
 $principal=New-ScheduledTaskPrincipal -UserId $d.userSid -LogonType Interactive -RunLevel Limited
 $triggers=@((New-ScheduledTaskTrigger -AtLogOn -User $d.userSid))
 $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
 Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Trigger $triggers -Settings $settings -Description 'Somente descoberta assinada do Sistema Ruy pelo agente ngrok da Microsoft Store; nenhum dado operacional.' | Out-Null
 [IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');registered=$true;task=$name;logonType='Interactive';runLevel='Limited';passwordSupplied=$false;metadataOnly=$true;started=$false;requiresOwnerWindowsSession=$true}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 $request=Join-Path $root 'start-discovery-task.request'
 $deadline=[DateTime]::UtcNow.AddMinutes(2)
 while(-not(Test-Path -LiteralPath $request) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 300}
 if(Test-Path -LiteralPath $request){Start-ScheduledTask -TaskName $name;[IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');registered=$true;task=$name;logonType='Interactive';runLevel='Limited';passwordSupplied=$false;metadataOnly=$true;started=$true;requiresOwnerWindowsSession=$true}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))}
} catch {
 $code=if($_.Exception.Message -match '^[A-Z0-9_]+$'){$_.Exception.Message}else{'DISCOVERY_TASK_INSTALL_FAILED'}
 [IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');registered=$false;code=$code;exceptionType=$_.Exception.GetType().FullName;line=$_.InvocationInfo.ScriptLineNumber}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 exit 2
}
