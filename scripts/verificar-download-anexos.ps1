# ============================================================================
# VERIFICACAO DE DOWNLOAD DOS ANEXOS — bucket "anexos" (somente leitura)
# Projeto Supabase: wvcvveqdkecsoygtilop. NAO EXECUTAR sem autorizacao.
#
# O que faz: lista os objetos via API Storage e testa o download de cada um
# (GET), descartando o conteudo em memoria (vai para NUL). NADA e salvo em
# disco, NADA de conteudo e exibido, o bucket NAO e tornado publico e
# nenhuma politica/tabela/registro/objeto e alterado ou removido.
#
# Saida SEGURA para compartilhar: apenas codigos HTTP, tamanhos e um hash
# md5 com sal do caminho — nunca o nome do arquivo, nunca o conteudo dos
# comprovantes, nunca a chave de API.
#
# Requisitos: Windows 10/11 (curl.exe embutido) + PowerShell.
# Chave: digitada no prompt (fica so em memoria) ou via variavel de ambiente.
#   Modo 'anon'   (padrao): usa anon key — testa o caminho publico/RLS.
#   Modo 'service': usa service role key — testa baixabilidade real de tudo.
#   Se 'anon' retornar 401/403 em massa, repita com -KeyMode service.
#   Feche o terminal ao final (a chave e limpa das variaveis no fim do script).
# ============================================================================

param(
  [string]$BaseUrl = 'https://wvcvveqdkecsoygtilop.supabase.co',
  [string]$Bucket = 'anexos',
  [ValidateSet('anon','service')][string]$KeyMode = 'anon'
)

$ErrorActionPreference = 'Stop'

if ($KeyMode -eq 'anon') {
  if (-not $env:SUPABASE_ANON_KEY) { $env:SUPABASE_ANON_KEY = Read-Host -MaskInput 'Cole a anon key (fica so em memoria)' }
  $Key = $env:SUPABASE_ANON_KEY
} else {
  if (-not $env:SUPABASE_SERVICE_KEY) { $env:SUPABASE_SERVICE_KEY = Read-Host -MaskInput 'Cole a service role key (fica so em memoria)' }
  $Key = $env:SUPABASE_SERVICE_KEY
}

function Get-PathHash([string]$p) {
  $md5 = [System.Security.Cryptography.MD5]::Create()
  $b = [Text.Encoding]::UTF8.GetBytes('ruy-anexos-path-2026:' + $p)
  $hex = ($md5.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) -join ''
  return $hex.Substring(0, 16)
}

# --- 1) Lista os objetos (paginado; caminhos NUNCA saem daqui) --------------
$names = New-Object System.Collections.Generic.List[string]
$offset = 0
do {
  $body = @{ prefix = ''; limit = 100; offset = $offset;
             sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Depth 4 -Compress
  $json = & curl.exe -s -S -X POST "$BaseUrl/storage/v1/object/list/$Bucket" `
           -H "apikey: $Key" -H "Authorization: Bearer $Key" `
           -H 'Content-Type: application/json' --data $body
  if ($LASTEXITCODE -ne 0) { Write-Error 'Falha na listagem (verifique a chave/conexao).'; exit 1 }
  $batch = @($json | ConvertFrom-Json)
  foreach ($o in $batch) { $names.Add($o.name) }
  $offset += 100
} while ($batch.Count -eq 100)

# --- 2) Testa o download de cada objeto (conteudo para NUL, so em memoria) --
$report = @()
foreach ($name in $names) {
  $enc = ($name -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
  $u = "$BaseUrl/storage/v1/object/$Bucket/$enc"
  $out = & curl.exe -s -S -o NUL -w '%{http_code} %{size_download}' `
           -H "apikey: $Key" -H "Authorization: Bearer $Key" $u
  $parts = @($out -split ' ')
  $http = '000'; $bytes = 0
  if ($parts.Count -ge 1 -and $parts[0]) { $http = $parts[0] }
  if ($parts.Count -ge 2) { [void][int]::TryParse($parts[1], [ref]$bytes) }
  $report += [pscustomobject]@{ arq = (Get-PathHash $name); http = $http; bytes = $bytes }
}

# --- 3) Resumo (somente estatisticas e hashes — seguro para compartilhar) ---
Write-Host ''
Write-Host '=== RESUMO (seguro para compartilhar) ==='
Write-Host ("Objetos testados: {0}  |  modo da chave: {1}  |  bucket: {2} (privado)" -f $report.Count, $KeyMode, $Bucket)
$report | Group-Object http | Sort-Object Name | ForEach-Object {
  Write-Host ("  HTTP {0}: {1} arquivo(s)" -f $_.Name, $_.Count)
}
$soma = ($report | Measure-Object -Property bytes -Sum).Sum
Write-Host ("Bytes recebidos (somados): {0}" -f $soma)
Write-Host ''
Write-Host '=== DETALHE POR ARQUIVO (hash md5+sal do caminho — seguro) ==='
$report | Sort-Object http, arq | ForEach-Object {
  Write-Host ("  {0}  HTTP {1}  {2} bytes" -f $_.arq, $_.http, $_.bytes)
}

# Limpa a chave desta sessao
if ($KeyMode -eq 'anon') { $env:SUPABASE_ANON_KEY = $null } else { $env:SUPABASE_SERVICE_KEY = $null }

Write-Host ''
Write-Host 'Interpretacao: 200 = baixavel | 401/403 = RLS/permissao (repita com -KeyMode service) | 404 = objeto ausente | 000 = falha de conexao.'
Write-Host 'Nenhum conteudo de comprovante foi salvo, exibido ou compartilhado neste teste.'
