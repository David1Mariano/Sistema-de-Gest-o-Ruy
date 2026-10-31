[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Receipt,[Parameter(Mandatory=$true)][ValidateSet('pichau.teste@example.invalid','estoque.teste@example.invalid')][string]$Conta)
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'ADM-RUY'){throw 'Executar somente no servidor, sem enviar senhas pelo chat'}
$r=Get-Content -LiteralPath $Receipt -Raw | ConvertFrom-Json
if($r.purpose -ne 'RUY_TEMPORARY_SYNTHETIC_LAN' -or [DateTimeOffset]::Parse($r.expiresAt) -le [DateTimeOffset]::Now){throw 'Perfil de homologacao invalido ou expirado'}
$secret=Read-Host ('Senha ficticia individual para '+$Conta+' (minimo 15 caracteres)') -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$process=$null;$payloadBytes=$null
try{
 $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 if($password.Length -lt 15 -or [Text.Encoding]::UTF8.GetByteCount($password) -gt 256){throw 'Senha precisa ter entre 15 caracteres e 256 bytes'}
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=Join-Path $r.prepDirectory 'runtime\node.exe'
 $runner=Join-Path $PSScriptRoot 'run-lan-homologation.mjs'
 $info.Arguments='"'+$runner+'" --set-password "'+[IO.Path]::GetFullPath($Receipt)+'"'
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true
 $process=New-Object Diagnostics.Process;$process.StartInfo=$info
 [void]$process.Start()
 # Windows PowerShell 5.1 uses Console.InputEncoding (often IBM850) for
 # StandardInput.Write. Send explicit UTF-8 bytes so accented passwords match
 # the Electron JSON request. Never pass the password in arguments or files.
 $payloadBytes=[Text.Encoding]::UTF8.GetBytes((@{email=$Conta;password=$password} | ConvertTo-Json -Compress))
 $process.StandardInput.BaseStream.Write($payloadBytes,0,$payloadBytes.Length)
 $process.StandardInput.BaseStream.Flush()
 $process.StandardInput.Close();$password=$null
 $process.WaitForExit();if($process.ExitCode -ne 0){throw 'Senha nao foi confirmada; consultar a mensagem local'}
}finally{$password=$null;if($payloadBytes){[Array]::Clear($payloadBytes,0,$payloadBytes.Length)};[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose();if($process){$process.Dispose()}}
