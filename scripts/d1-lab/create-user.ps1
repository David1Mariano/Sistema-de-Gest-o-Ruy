param([ValidateSet('admin','writer','viewer')][string]$Role='writer')
$ErrorActionPreference = 'Stop'
$ruyLabLogin = Read-Host 'Login fictício (ex.: operador@example.invalid)'
$ruyLabPassword = Read-Host 'Nova senha apenas do laboratório (mínimo 12 caracteres)' -AsSecureString
$ruyLabPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ruyLabPassword)
try {
  $ruyLabPayload = @{ login=$ruyLabLogin; password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ruyLabPointer) } | ConvertTo-Json -Compress
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ruyLabPayload)) | & node (Join-Path $PSScriptRoot 'create-user.mjs') --base64-stdin --role $Role
  if ($LASTEXITCODE -ne 0) { throw 'Conta não criada. Não houve troca automática de senha.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ruyLabPointer)
  $ruyLabPayload = $null
  $ruyLabPassword.Dispose()
}
