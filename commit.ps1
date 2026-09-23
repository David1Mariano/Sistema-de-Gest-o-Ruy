$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force | Out-Null
Set-Location $PSScriptRoot

$out = "$env:TEMP\commit-result.txt"
Remove-Item $out -ErrorAction SilentlyContinue

Remove-Item "checks.ps1","checks2.ps1","checks3.ps1","checks-result.txt","checks2-result.txt","checks3-result.txt","test-web3.js","out1.txt","wf-payload.json","wf-body.txt","lint.log","lint-fix.log" -ErrorAction SilentlyContinue

git status -sb | Out-File $out -Encoding utf8

git add -A 2>&1 | Out-File $out -Append -Encoding utf8
git commit -m "Cadastro com codigo de confirmacao por e-mail (Web3Forms), senha fixa de acesso e lint limpo" 2>&1 | Out-File $out -Append -Encoding utf8
git push 2>&1 | Out-File $out -Append -Encoding utf8
"PUSH exit=$LASTEXITCODE" | Out-File $out -Append -Encoding utf8
git status -sb | Out-File $out -Append -Encoding utf8
git log --oneline -2 | Out-File $out -Append -Encoding utf8