$ErrorActionPreference = 'Stop'

# 콘솔 한글 깨짐 방지 (UTF-8로 통일)
try {
  $null = chcp 65001
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  [Console]::InputEncoding  = [System.Text.UTF8Encoding]::new()
  $OutputEncoding           = [System.Text.UTF8Encoding]::new()
} catch {}

$Root      = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$IssPath   = Join-Path $Root 'installer\setup.iss'
$DistDir   = Join-Path $Root 'dist'

if (-not (Test-Path $IssPath)) {
  Write-Error "setup.iss를 찾을 수 없습니다: $IssPath"; exit 1
}

# 1. ISCC.exe 탐색
function Find-Iscc {
  $candidates = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe',
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    'C:\Program Files (x86)\Inno Setup 5\ISCC.exe'
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command iscc -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  return $null
}

$iscc = Find-Iscc

# 2. 없으면 winget으로 설치 시도
if (-not $iscc) {
  Write-Host "Inno Setup이 깔려있지 않아 winget으로 설치 시도..."
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Error "winget이 없습니다. Inno Setup을 수동으로 설치해주세요: https://jrsoftware.org/isdl.php"
    exit 1
  }
  & winget install --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    Write-Error "winget 설치 실패 (exit=$LASTEXITCODE). 수동 설치 후 다시 시도하세요."
    exit 1
  }
  $iscc = Find-Iscc
  if (-not $iscc) {
    Write-Error "winget 설치 후에도 ISCC.exe를 찾을 수 없습니다. PATH를 확인하거나 PC를 재시작하세요."
    exit 1
  }
}

Write-Host "ISCC: $iscc"

# 3. 출력 디렉터리 보장
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# 4. 빌드
Push-Location (Split-Path $IssPath -Parent)
try {
  & $iscc /Qp $IssPath
  $exit = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($exit -ne 0) {
  Write-Error "Inno Setup 빌드 실패 (exit=$exit)"
  exit $exit
}

$artifact = Join-Path $DistDir 'Pensieve-Setup.exe'
if (Test-Path $artifact) {
  $size = (Get-Item $artifact).Length
  Write-Host ""
  Write-Host "빌드 성공: $artifact ($([math]::Round($size/1KB)) KB)"
  Write-Host "더블클릭하면 GUI 인스톨러가 뜨고, 제어판 → 프로그램 추가/제거에서 언인스톨됩니다."
} else {
  Write-Error "빌드는 끝났지만 산출물($artifact)을 찾을 수 없습니다."
  exit 1
}
