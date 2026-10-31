[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Receipt,[ValidateSet('Start','EnableLogon','Stop')][string]$Action='Start')
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'ADM-RUY'){throw 'Somente ADM-RUY'}
$receiptPath=(Resolve-Path -LiteralPath $Receipt).Path
$r=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if($r.purpose -ne 'RUY_TEMPORARY_SYNTHETIC_LAN' -or $r.production -ne $false){throw 'Somente central ficticia separada'}
$runtime=Join-Path $r.prepDirectory 'runtime\node.exe'
$runner=Join-Path $PSScriptRoot 'run-lan-homologation.mjs'
$startupName='SistemaRuyCentralHomologacao'
$startupKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$command='"'+$psExe+'" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Receipt "'+$receiptPath+'"'
if($Action -eq 'Stop'){
 $existing=(Get-ItemProperty -LiteralPath $startupKey -Name $startupName -ErrorAction SilentlyContinue).$startupName
 if($existing -eq $command){Remove-ItemProperty -LiteralPath $startupKey -Name $startupName}
 Set-Content -LiteralPath (Join-Path $r.profile 'STOP-LAN') -Value 'Encerramento seguro solicitado pelo usuario' -Encoding ascii
 Write-Output 'Encerramento seguro solicitado; entrada de logon desta homologacao removida. Nenhum perfil ou dado removido.'
 return
}
if([DateTimeOffset]::Parse($r.expiresAt) -le [DateTimeOffset]::Now){Write-Output 'Homologacao temporaria expirada; central nao iniciada';return}
if(Test-Path -LiteralPath (Join-Path $r.profile 'STOP-LAN')){Write-Output 'Homologacao encerrada; reinicio automatico bloqueado';return}
if($Action -eq 'EnableLogon'){
 $existing=(Get-ItemProperty -LiteralPath $startupKey -Name $startupName -ErrorAction SilentlyContinue).$startupName
 if($existing -and $existing -ne $command){throw 'Entrada preexistente preservada'}
 if(!(Test-Path -LiteralPath $startupKey)){New-Item -Path $startupKey -Force | Out-Null}
 if(!$existing){New-ItemProperty -LiteralPath $startupKey -Name $startupName -PropertyType String -Value $command | Out-Null}
 [pscustomobject]@{Configured=$true;Scope='Somente logon do usuario Pichau; nao e servico SCM nem inicio antes do login';ExpiresAt=$r.expiresAt;Name=$startupName;PreviousValueAbsent=(!$existing)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path $receiptPath) 'inicio-automatico.json') -Encoding utf8
 Write-Output 'Reinicio apos logon de Pichau configurado somente para esta homologacao temporaria.'
}
$lock=Join-Path $r.profile 'lan-controller.lock'
if(Test-Path -LiteralPath $lock){$marker=Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json;if(Get-Process -Id $marker.pid -ErrorAction SilentlyContinue){Write-Output 'Central ja iniciada; processo preservado';return}}
$output=Split-Path $receiptPath
$controller=Start-Process -FilePath $runtime -ArgumentList @(('"'+$runner+'"'),'--start',('"'+$receiptPath+'"')) -WorkingDirectory (Split-Path (Split-Path $PSScriptRoot)) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $output 'controller.stdout.log') -RedirectStandardError (Join-Path $output 'controller.stderr.log') -PassThru
[pscustomobject]@{ControllerPid=$controller.Id;Temporary=$true;Production=$false}
