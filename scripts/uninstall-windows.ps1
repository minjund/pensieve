param(
  [switch]$KeepUserData,
  [switch]$Silent
)

$ErrorActionPreference = 'SilentlyContinue'

$ClaudeDir = Join-Path $HOME '.claude'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$Backup = Join-Path $ClaudeDir "hermes-uninstall-backup.$stamp"

function Say($m) { if (-not $Silent) { Write-Host $m } }

if (-not (Test-Path $ClaudeDir)) {
  Say "Claude 디렉터리($ClaudeDir)가 없습니다. 종료."
  exit 0
}

# --- 0. 백업 ---
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
foreach ($name in @('memory','projects-memory','hermes-memory','hermes-memory-config.json','settings.json','CLAUDE.md')) {
  $src = Join-Path $ClaudeDir $name
  if (Test-Path $src) {
    $dst = Join-Path $Backup $name
    try { Copy-Item $src $dst -Recurse -Force -ErrorAction Stop } catch {}
  }
}
Say "백업 위치: $Backup"

# --- 1. 런타임/설정 제거 ---
Remove-Item (Join-Path $ClaudeDir 'hermes-memory') -Recurse -Force
Remove-Item (Join-Path $ClaudeDir 'hermes-memory-config.json') -Force

# --- 2. 사용자 데이터 제거 (옵션) ---
if (-not $KeepUserData) {
  Remove-Item (Join-Path $ClaudeDir 'memory') -Recurse -Force
  Remove-Item (Join-Path $ClaudeDir 'projects-memory') -Recurse -Force
  Say "사용자 메모리/프로젝트 메모리도 삭제했습니다."
} else {
  Say "사용자 메모리는 보존했습니다: $ClaudeDir\memory, projects-memory"
}

# --- 3. 스킬 제거 ---
$SkillsDir = Join-Path $ClaudeDir 'skills'
foreach ($skill in @('use-global-memory','use-hermes-memory','hermes-memory','learn-memory-tool')) {
  Remove-Item (Join-Path $SkillsDir $skill) -Recurse -Force
}
Get-ChildItem $SkillsDir -Directory -Filter "use-global-memory.backup.*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Get-ChildItem $SkillsDir -Directory -Filter "use-hermes-memory.backup.*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

# --- 4. 슬래시 명령 제거 ---
$CommandsDir = Join-Path $ClaudeDir 'commands'
foreach ($pattern in @('memory-*.md','skill-*.md','learn-memory-tool.md')) {
  Get-ChildItem $CommandsDir -Filter $pattern -ErrorAction SilentlyContinue | Remove-Item -Force
}
Get-ChildItem $CommandsDir -Filter "*.backup.*" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(memory-|skill-|learn-memory)' } | Remove-Item -Force

# --- 5. settings.json에서 hermes-memory 훅 제거 ---
$SettingsPath = Join-Path $ClaudeDir 'settings.json'
if (Test-Path $SettingsPath) {
  try {
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($node) {
      $script = @"
const fs=require('fs');
const p=process.argv[2];
const s=JSON.parse(fs.readFileSync(p,'utf8'));
if(!s.hooks){process.exit(0);}
for(const ev of Object.keys(s.hooks)){
  s.hooks[ev]=(s.hooks[ev]||[]).map(g=>({...g,hooks:(g.hooks||[]).filter(h=>!(h.command||'').includes('hermes-memory'))})).filter(g=>(g.hooks||[]).length>0);
  if(s.hooks[ev].length===0)delete s.hooks[ev];
}
fs.writeFileSync(p,JSON.stringify(s,null,2));
"@
      $tmp = Join-Path $env:TEMP "claude-mem-uninstall-$stamp.js"
      Set-Content -Path $tmp -Value $script -Encoding ASCII
      & node $tmp $SettingsPath
      Remove-Item $tmp -Force
      Say "settings.json에서 hermes-memory 훅 제거 완료."
    } else {
      Say "Node.js를 찾지 못해 settings.json은 수동으로 정리하세요."
    }
  } catch {
    Say "settings.json 정리 중 오류: $_"
  }
}

# --- 6. CLAUDE.md에서 Hermes 섹션 제거 ---
$ClaudeMd = Join-Path $ClaudeDir 'CLAUDE.md'
if (Test-Path $ClaudeMd) {
  $content = Get-Content $ClaudeMd -Raw
  $cleaned = $content
  # "Global Claude Memory" 헤딩부터 다음 헤딩 직전까지 또는 EOF까지 제거
  $cleaned = [regex]::Replace($cleaned, '(?ms)(\r?\n---\r?\n\r?\n)?# Global Claude Memory.*?(?=\r?\n# |\Z)', '')
  $cleaned = [regex]::Replace($cleaned, '(?ms)(\r?\n---\r?\n\r?\n)?# Claude Hermes Memory.*?(?=\r?\n# |\Z)', '')
  if ($cleaned -ne $content) {
    Set-Content -Path $ClaudeMd -Value $cleaned.TrimEnd() -Encoding UTF8
    Say "CLAUDE.md에서 Hermes 섹션 제거."
  }
}

Say ""
Say "제거 완료. Claude Code를 재시작하세요."
Say "되돌리려면 백업($Backup)의 파일·폴더를 $ClaudeDir 로 복사 후 재시작하세요."
