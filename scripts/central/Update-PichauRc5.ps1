$ErrorActionPreference='Stop'
$project='C:\Users\Pichau\gestao-ruy-integracao-auditoria-20261019'
$release='C:\ProgramData\SistemaRuyConsulta\release-20261029-4760dac54c71b899'
$proof=Get-Content -LiteralPath (Join-Path $project 'artifacts\consulta-ativacao-20261029\production-activation.json') -Raw|ConvertFrom-Json
if(-not $proof.activated -or $env:COMPUTERNAME -ne 'ADM-RUY'){throw 'EXACT_ACTIVE_PICHAU_RELEASE_REQUIRED'}
$guid='75c7b9b8-6d06-4bf1-89d1-4e566b45c050'
$key='HKCU:\Software\'+$guid
$uninstall='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid
$install=(Get-ItemProperty -LiteralPath $key).InstallLocation
$expected=Join-Path $env:LOCALAPPDATA 'Programs\Sistema Ruy'
if([IO.Path]::GetFullPath($install) -ne $expected -or ((Get-Item -LiteralPath $install).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'EXACT_EXISTING_INSTALLATION_REQUIRED'}
if(@(Get-CimInstance Win32_Process -Filter "Name='Sistema Ruy.exe'"|Where-Object {$_.ExecutablePath -eq (Join-Path $install 'Sistema Ruy.exe')}).Count){throw 'APP_OPEN_UPDATE_WINDOW_REQUIRED'}
if((Get-FileHash -LiteralPath $proof.installer.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $proof.installer.sha256){throw 'INSTALLER_HASH_FAILED'}
$existing=Get-ItemProperty -LiteralPath $uninstall
if($existing.DisplayVersion -eq '0.10.0-rc.5'){[pscustomobject]@{AlreadyUpdated=$true;Version=$existing.DisplayVersion}|ConvertTo-Json;exit 0}
$backup=Join-Path $release ('client-before-rc5-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $backup|Out-Null
& reg.exe export ('HKCU\Software\'+$guid) (Join-Path $backup 'install.reg') /y|Out-Null
if($LASTEXITCODE -ne 0){throw 'CLIENT_REGISTRY_BACKUP_FAILED'}
& reg.exe export ('HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid) (Join-Path $backup 'uninstall.reg') /y|Out-Null
if($LASTEXITCODE -ne 0){throw 'CLIENT_UNINSTALL_BACKUP_FAILED'}
$sourceHash=(Get-FileHash -LiteralPath (Join-Path $install 'resources\app.asar') -Algorithm SHA256).Hash
Copy-Item -LiteralPath $install -Destination (Join-Path $backup 'program') -Recurse
if((Get-FileHash -LiteralPath (Join-Path $backup 'program\resources\app.asar') -Algorithm SHA256).Hash -ne $sourceHash){throw 'CLIENT_BINARY_BACKUP_FAILED'}
[IO.File]::WriteAllText((Join-Path $backup 'before.json'),([ordered]@{at=[DateTime]::UtcNow.ToString('o');previousVersion=$existing.DisplayVersion;install=$install;asarSha256=$sourceHash;profilesDeleted=$false}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$process=Start-Process -FilePath $proof.installer.file -ArgumentList @('/S','/currentuser') -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0){throw ('CLIENT_INSTALLER_FAILED_'+$process.ExitCode)}
$updated=Get-ItemProperty -LiteralPath $uninstall
if($updated.DisplayVersion -ne '0.10.0-rc.5'){throw 'CLIENT_VERSION_NOT_UPDATED'}
$candidate=Join-Path $project 'artifacts\multicomputador-0.10.0-rc.5-20261029\build\win-unpacked\resources\app.asar'
if((Get-FileHash -LiteralPath (Join-Path $install 'resources\app.asar') -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash){throw 'INSTALLED_ARCHIVE_MISMATCH'}
$shell=New-Object -ComObject WScript.Shell
$links=@((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Sistema Ruy.lnk'))+@(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Programs')) -Recurse -Filter 'Sistema Ruy.lnk' | ForEach-Object {$_.FullName})
$checked=@();foreach($link in $links){if(Test-Path -LiteralPath $link){$shortcut=$shell.CreateShortcut($link);if($shortcut.TargetPath -ne (Join-Path $install 'Sistema Ruy.exe') -or $shortcut.Arguments){throw 'CLIENT_SHORTCUT_TARGET_FAILED'};$checked+= $link}}
if($checked.Count -lt 2){throw 'CLIENT_OFFICIAL_SHORTCUTS_MISSING'}
$result=[ordered]@{at=[DateTime]::UtcNow.ToString('o');updated=$true;version=$updated.DisplayVersion;install=$install;previousInstallationBackup=$backup;shortcuts=$checked;profilePreserved=$true;originalDatabasesModified=$false;windowsRebooted=$false}
[IO.File]::WriteAllText((Join-Path $project 'artifacts\consulta-ativacao-20261029\pichau-rc5-update.json'),($result|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
$result|ConvertTo-Json -Depth 4
