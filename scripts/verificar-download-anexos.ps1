# ============================================================================
# VERIFICACAO DE DOWNLOAD DOS ANEXOS — bucket "anexos" (somente leitura)
# Projeto Supabase: wvcvveqdkecsoygtilop. NAO EXECUTAR sem autorizacao.
#
# O que faz (APENAS leitura; nao altera bucket, RLS, politicas nem objetos):
#   1) Lista os objetos RECURSIVAMENTE (subpastas) com paginacao por prefixo,
#      via API Storage (POST /storage/v1/object/list — operacao de leitura).
#   2) Testa o GET de cada objeto; o conteudo vai para NUL (memoria apenas).
#      NADA e salvo em disco; NADA de conteudo, nome ou caminho e exibido.
#   3) Emite SOMENTE estatisticas agregadas: quantidade de arquivos, HTTP 200,
#      HTTP 401/403, HTTP 404, outros codigos agrupados e bytes totais.
#      Sem hashes, sem nomes, sem caminhos — saida segura para compartilhar.
#
# CREDENCIAIS — permissoes minimas, sem exposicao:
#   - SOMENTE anon key. service_role PROIBIDO neste teste (param removido).
#   - Chave NUNCA aparece em argv, logs, arquivos, terminal ou relatorio:
#     lida de $env:SUPABASE_ANON_KEY (se ja existir, fica intacta) ou prompt
#     MASCARADO; entregue ao curl por config VIA STDIN (curl -K -); o script
#     NAO escreve nem limpa variaveis de ambiente; memoria limpa ao final.
#   - Feche o terminal apos o teste (strings do PowerShell so saem da memoria
#     quando o processo morre).
#
# Compatibilidade PowerShell: 5.1+ / 7+ (curl.exe embutido no Windows 10+).
#   - Read-Host -MaskInput nao existe em todas as versoes: o script detecta o
#     suporte e cai para -AsSecureString (desde 2.0) + BSTR convertido e zerado.
#   - Encoding UTF-8 sem BOM em stdin/stdout: prefixos com acento nao sao
#     corrompidos pelo padrao ASCII/437 do Windows PowerShell 5.1.
#
# Referencia Etapa 2: 59 objetos, 2928141 bytes.
# NAO executa exportacao, importacao, restauracao ou migracao.
# ============================================================================

param(
  [string]$BaseUrl = 'https://wvcvveqdkecsoygtilop.supabase.co',
  [string]$Bucket = 'anexos',
  [int]$ExpectedCount = 59,
  [long]$ExpectedBytes = 2928141
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 5) {
  Write-Host 'ERRO: PowerShell 5.1 ou superior e obrigatorio.' -ForegroundColor Red; exit 1
}
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
  Write-Host 'ERRO: curl.exe nao encontrado (Windows 10/11 traz embutido).' -ForegroundColor Red; exit 1
}

# UTF-8 sem BOM no pipe de entrada e na saida (nao confiar no padrao ASCII)
try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [Console]::OutputEncoding = $utf8NoBom
  $OutputEncoding = $utf8NoBom
} catch { }

# --- ANON KEY: leitura protegida; nunca escrita, nunca exibida --------------
$Key = $null
if ($env:SUPABASE_ANON_KEY) {
  $Key = $env:SUPABASE_ANON_KEY   # somente lida; nao e modificada nem limpada
} else {
  $promptText = 'Cole a anon key (fica so em memoria; nao sera salva em lugar nenhum)'
  $maskSupported = (Get-Command Read-Host).Parameters.ContainsKey('MaskInput')
  if ($maskSupported) {
    $Key = Read-Host -Prompt $promptText -MaskInput
  } else {
    $sec = Read-Host -Prompt $promptText -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try     { $Key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $sec = $null }
  }
}
if ([string]::IsNullOrWhiteSpace($Key)) {
  Write-Host 'ERRO: anon key vazia. Abortado.' -ForegroundColor Red; exit 1
}

# --- curl via CONFIG STDIN: a chave sai do argv (invisivel na process list) --
function ConvertTo-CurlValue([string]$s) {
  return '"' + ($s -replace '\\', '\\' -replace '"', '\"') + '"'
}

$authHeaders = @(
  ('header = ' + (ConvertTo-CurlValue ('apikey: ' + $Key))),
  ('header = ' + (ConvertTo-CurlValue ('Authorization: Bearer ' + $Key)))
)

function Invoke-CurlStdin([string[]]$configLines) {
  $out = ($configLines -join "`n") | & curl.exe -K - --silent --show-error
  $code = $LASTEXITCODE
  $text = ''
  if ($null -ne $out) {
    if ($out -is [array]) { $text = ($out -join "`n") } else { $text = [string]$out }
  }
  return [pscustomobject]@{ Text = $text; ExitCode = $code }
}

# --- Listagem por prefixo (valida HTTP ANTES de interpretar o JSON) ---------
function Invoke-StorageList([string]$prefix, [int]$limit, [int]$offset) {
  $bodyObj = @{ prefix = $prefix; limit = $limit; offset = $offset;
                sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Depth 5 -Compress
  $cfg = @(
    ('url = ' + (ConvertTo-CurlValue ($BaseUrl + '/storage/v1/object/list/' + $Bucket)))
    'request = "POST"'
  ) + $authHeaders + @(
    'header = "Content-Type: application/json"'
    ('data = ' + (ConvertTo-CurlValue $bodyObj))
    'write-out = "\n__HTTP__%{http_code}"'
  )
  $res = Invoke-CurlStdin $cfg
  if ($res.ExitCode -ne 0) {
    Write-Host 'ERRO: falha de conexao na listagem (curl). Abortado.' -ForegroundColor Red; exit 1
  }
  $marker = '__HTTP__'
  $idx = $res.Text.LastIndexOf($marker)
  if ($idx -lt 0) {
    Write-Host 'ERRO: resposta da listagem sem marcador HTTP. Abortado.' -ForegroundColor Red; exit 1
  }
  $body = $res.Text.Substring(0, $idx).Trim()
  $http = $res.Text.Substring($idx + $marker.Length).Trim()
  if ($http -ne '200') {   # valida ANTES de interpretar o JSON
    $detail = ''
    try {
      $errObj = $body | ConvertFrom-Json
      if ($errObj.message) { $detail = ' - ' + [string]$errObj.message }
    } catch {
      if ($body) {
        $flat = ($body -replace '\s+', ' ').Trim()
        $detail = ' - ' + $flat.Substring(0, [Math]::Min(120, $flat.Length))
      }
    }
    Write-Host ('ERRO: listagem recusada (HTTP ' + $http + ')' + $detail + '. Nenhum JSON foi interpretado. Abortado.') -ForegroundColor Red
    exit 1
  }
  try { return @($body | ConvertFrom-Json) }
  catch {
    Write-Host 'ERRO: JSON invalido na listagem (HTTP 200). Abortado.' -ForegroundColor Red; exit 1
  }
}

# --- 1) Listagem RECURSIVA (subpastas) com paginacao por prefixo ------------
$listedFiles = New-Object 'System.Collections.Generic.HashSet[string]'

function Add-PrefixFiles([string]$prefix, [int]$depth) {
  if ($depth -gt 16) { return }   # guarda contra caminhos mal formados
  $limit = 100
  $offset = 0
  do {
    $batch = @(Invoke-StorageList $prefix $limit $offset)
    foreach ($o in $batch) {
      $name = [string]$o.name
      if ([string]::IsNullOrEmpty($name)) { continue }
      # Pasta: id/metadata nulos (ou nome terminado em '/'); arquivo tem id+metadata
      $isFolder = (($null -eq $o.id) -and ($null -eq $o.metadata)) -or $name.EndsWith('/')
      if ($isFolder) {
        $sub = $name
        if (-not $sub.EndsWith('/')) { $sub = $sub + '/' }
        Add-PrefixFiles ($prefix + $sub) ($depth + 1)
      } else {
        [void]$listedFiles.Add($prefix + $name)
      }
    }
    $offset += $limit
  } while ($batch.Count -eq $limit)
}

Add-PrefixFiles '' 0

# --- 2) GET de cada objeto: conteudo -> NUL; so contadores ficam em memoria --
$tested = 0; $ok = 0; $denied = 0; $missing = 0; $bytes200 = 0
$others = @{}

foreach ($name in $listedFiles) {
  $enc = ($name -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
  $urlLine = 'url = ' + (ConvertTo-CurlValue ($BaseUrl + '/storage/v1/object/' + $Bucket + '/' + $enc))
  $cfg = @($urlLine) + $authHeaders + @(
    'output = "NUL"'
    'write-out = "%{http_code} %{size_download}"'
  )
  $res = Invoke-CurlStdin $cfg
  $http = '000'; $size = 0
  if ($res.ExitCode -eq 0) {
    $tokens = @($res.Text.Trim() -split '\s+' | Where-Object { $_ })
    if ($tokens.Count -ge 1) { $http = $tokens[0] }
    if ($tokens.Count -ge 2) { [void][int]::TryParse($tokens[1], [ref]$size) }
  }
  $tested++
  if ($http -eq '200') { $ok++; $bytes200 += $size }
  elseif (($http -eq '401') -or ($http -eq '403')) { $denied++ }
  elseif ($http -eq '404') { $missing++ }
  else {
    if ($others.ContainsKey($http)) { $others[$http]++ } else { $others[$http] = 1 }
  }
}

# --- 3) RESUMO AGREGADO (unico formato de saida; seguro para compartilhar) ---
$listed = $listedFiles.Count
$divergence = ''
if ($listed -ne $ExpectedCount) { $divergence = ' - DIVERGENCIA: revisar listagem antes de concluir' }
Write-Host ''
Write-Host '=== RESUMO AGREGADO (seguro para compartilhar) ==='
Write-Host ("Bucket: {0} (privado e inalterado) | credencial: anon key (permissoes minimas; service_role NAO usado)" -f $Bucket)
Write-Host ("Objetos listados: {0} (referencia Etapa 2: {1}){2}" -f $listed, $ExpectedCount, $divergence)
Write-Host ("Objetos testados: {0}" -f $tested)
Write-Host ("HTTP 200: {0} arquivo(s) | bytes recebidos: {1} (referencia: {2})" -f $ok, $bytes200, $ExpectedBytes)
Write-Host ("HTTP 401/403: {0}" -f $denied)
Write-Host ("HTTP 404: {0}" -f $missing)
if ($others.Count -gt 0) {
  $otherParts = $others.GetEnumerator() | Sort-Object Name | ForEach-Object { ('HTTP ' + $_.Name + ': ' + $_.Value) }
  Write-Host ('Outros: ' + ($otherParts -join ' | '))
} else {
  Write-Host 'Outros: nenhum'
}
Write-Host ''
Write-Host 'Interpretacao: 200 = baixavel | 401/403 = RLS/permissao negada para a anon key'
Write-Host '  (o teste NAO escala para service_role; baixabilidade com sessao autenticada'
Write-Host '   fica para decisao do proprietario) | 404 = objeto ausente | 000 = falha de conexao.'
Write-Host 'Nenhum conteudo, nome, caminho ou hash foi salvo, exibido ou compartilhado.'

# --- 4) Limpeza de memoria (nao mexe em variaveis de ambiente) --------------
$authHeaders = $null
$Key = $null
