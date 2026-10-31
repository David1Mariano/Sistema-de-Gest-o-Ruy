param([Parameter(Mandatory=$true)][string]$Release,[switch]$Activate)
# Only the recovered/private cluster. Never the original operational database.
$ErrorActionPreference='Stop'
$name='SistemaRuyConsultaPostgres'
$api='SistemaRuyCentralRc1'
$resultFile=Join-Path $Release 'private-database-service.json'
$stage='validate'
try {
 if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_REQUIRED'}
 $root=[IO.Path]::GetFullPath($Release)
 if([IO.Path]::GetDirectoryName($root) -ne (Join-Path $env:ProgramData 'SistemaRuyConsulta') -or [IO.Path]::GetFileName($root) -notmatch '^release-20261029-[a-f0-9]{16}$'){throw 'EXACT_RELEASE_REQUIRED'}
 $d=Get-Content -LiteralPath (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
 if($d.serviceName -ne $api -or $d.backupHashesVerified -ne 2){throw 'VERIFIED_READONLY_RELEASE_REQUIRED'}
 $private=Join-Path ([IO.Path]::GetDirectoryName([Environment]::GetFolderPath('UserProfile'))) 'Pichau\AppData\Local\GestaoRuy\installation-final-dev-20261021'
 $cluster=Join-Path $private 'cluster'
 $marker=Get-Content -LiteralPath (Join-Path $private 'lab.json') -Raw|ConvertFrom-Json
 if($marker.installationId -ne 'final-dev-20261021' -or $marker.port -ne 55483 -or (Get-Content -LiteralPath (Join-Path $cluster 'PG_VERSION') -Raw).Trim() -ne '17'){throw 'EXACT_RECOVERED_PRIVATE_CLUSTER_REQUIRED'}
 foreach($dir in @($root,$private,$cluster)){if((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REDIRECTED_DIRECTORY_REFUSED'}}
 $pgctl=[IO.Path]::GetFullPath((Join-Path $marker.bin 'pg_ctl.exe'))
 # postgres refuses administrative execution, including -C. Inspect the exact
 # already-running private instance; startup flags below pin the same binding.
 $postmaster=[IO.File]::ReadAllLines((Join-Path $cluster 'postmaster.pid'))
 if($postmaster.Length -lt 8 -or [IO.Path]::GetFullPath($postmaster[1]) -ne $cluster -or $postmaster[3] -ne '55483' -or $postmaster[5] -ne '127.0.0.1' -or $postmaster[7].Trim() -ne 'ready'){throw 'PRIVATE_LOOPBACK_ONLY_REQUIRED'}
 $service=Get-CimInstance Win32_Service -Filter "Name='$name'"
 if($service -and (-not $service.PathName.Contains($cluster) -or -not $service.PathName.Contains($pgctl))){throw 'OTHER_SERVICE_PRESERVED'}
 if(-not $service){
  $stage='register-stopped'
  & $pgctl register -N $name -D $cluster -S demand -U 'NT AUTHORITY\LocalService' -e $name -o '-p 55483 -h 127.0.0.1' -w -t 60 *> (Join-Path $root 'private-database-registration.log')
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_DATABASE_SERVICE_REGISTRATION_FAILED'}
  & sc.exe config $name obj= ('NT SERVICE\'+$name) | Out-Null
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_DATABASE_VIRTUAL_IDENTITY_FAILED'}
  & sc.exe sidtype $name unrestricted | Out-Null
  $sid=(New-Object Security.Principal.NTAccount('NT SERVICE\'+$name)).Translate([Security.Principal.SecurityIdentifier]).Value
  $aclFile=Join-Path $root 'private-cluster-acl-before-service.txt'
  & icacls.exe $cluster /save $aclFile /t /q | Out-Null
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_CLUSTER_ACL_BACKUP_FAILED'}
  & icacls.exe $cluster /grant:r ("*$($sid):(OI)(CI)M") /t /q | Out-Null
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_CLUSTER_SERVICE_ACCESS_FAILED'}
  & sc.exe failure $name reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_DATABASE_RECOVERY_FAILED'}
  & sc.exe failureflag $name 1 | Out-Null
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_DATABASE_NONCRASH_RECOVERY_FAILED'}
 }
 if($Activate){
  $stage='owned-private-cluster-transition'
  $pidFile=Join-Path $cluster 'postmaster.pid'
  if(Test-Path -LiteralPath $pidFile){
   $postmasterId=[int](Get-Content -LiteralPath $pidFile -TotalCount 1)
   $process=Get-CimInstance Win32_Process -Filter "ProcessId=$postmasterId"
   if(-not $process.CommandLine.Contains($cluster.Replace('\','/')) -and -not $process.CommandLine.Contains($cluster)){throw 'EXACT_PRIVATE_PROCESS_REQUIRED'}
  }
  Stop-Service $api -ErrorAction Stop
  if(Test-Path -LiteralPath $pidFile){& $pgctl stop -D $cluster -m fast -w -t 60 *> (Join-Path $root 'private-database-transition.log');if($LASTEXITCODE -ne 0){throw 'PRIVATE_CLUSTER_SAFE_STOP_FAILED'}}
  Start-Service $name -ErrorAction Stop
  & sc.exe config $name start= auto | Out-Null
  if($LASTEXITCODE -ne 0){throw 'PRIVATE_DATABASE_AUTOSTART_FAILED'}
  & sc.exe config $api depend= $name | Out-Null
  if($LASTEXITCODE -ne 0){throw 'OWNED_API_DATABASE_DEPENDENCY_FAILED'}
  Start-Service $api -ErrorAction Stop
 }
 [IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');configured=$true;activated=[bool]$Activate;service=$name;privatePort=55483;loopbackOnly=$true;originalDatabaseModified=$false;dataMigrated=$false;windowsRebooted=$false}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
}catch{
 [IO.File]::WriteAllText($resultFile,([ordered]@{at=[DateTime]::UtcNow.ToString('o');configured=$false;stage=$stage;code=if($_.Exception.Message -match '^[A-Z0-9_]+$'){$_.Exception.Message}else{'PRIVATE_DATABASE_SERVICE_SETUP_FAILED'};line=$_.InvocationInfo.ScriptLineNumber;originalDatabaseModified=$false}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 exit 2
}
