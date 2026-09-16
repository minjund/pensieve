$ErrorActionPreference = 'Stop'

$PackageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$GlobalDir = Join-Path $PackageRoot 'global'
$SourceClaude = Join-Path $GlobalDir 'CLAUDE.md'
$SourceMemory = Join-Path $GlobalDir 'memory'
$SourceSkills = Join-Path $GlobalDir 'skills'
$SourceHermes = Join-Path $GlobalDir 'hermes-memory'
$SourceCommands = Join-Path $GlobalDir 'commands'

$ClaudeDir = Join-Path $HOME '.claude'
$TargetClaude = Join-Path $ClaudeDir 'CLAUDE.md'
$TargetMemory = Join-Path $ClaudeDir 'memory'
$TargetSkills = Join-Path $ClaudeDir 'skills'
$TargetHermes = Join-Path $ClaudeDir 'hermes-memory'
$TargetCommands = Join-Path $ClaudeDir 'commands'
$TargetSettings = Join-Path $ClaudeDir 'settings.json'

New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
New-Item -ItemType Directory -Force -Path $TargetMemory | Out-Null
New-Item -ItemType Directory -Force -Path $TargetSkills | Out-Null
New-Item -ItemType Directory -Force -Path $TargetCommands | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

if (Test-Path $TargetClaude) {
  Copy-Item $TargetClaude "$TargetClaude.backup.$stamp" -Force
  $existing = Get-Content $TargetClaude -Raw
  $addition = Get-Content $SourceClaude -Raw
  if ($existing -notmatch 'Global Claude Memory') {
    Add-Content $TargetClaude "`n`n---`n`n$addition"
    Write-Host "기존 CLAUDE.md에 전역 메모리 지침을 추가했습니다. 백업: $TargetClaude.backup.$stamp"
  } else {
    Write-Host "CLAUDE.md에 전역 메모리 지침이 이미 있습니다. 백업만 생성했습니다."
  }
} else {
  Copy-Item $SourceClaude $TargetClaude -Force
  Write-Host "CLAUDE.md를 새로 생성했습니다: $TargetClaude"
}

Get-ChildItem $SourceMemory -File | ForEach-Object {
  $dest = Join-Path $TargetMemory $_.Name
  if (Test-Path $dest) {
    Copy-Item $dest "$dest.backup.$stamp" -Force
    $srcText = Get-Content $_.FullName -Raw
    $destText = Get-Content $dest -Raw
    if ($destText.Trim().Length -eq 0) {
      Copy-Item $_.FullName $dest -Force
    } else {
      Add-Content $dest "`n`n---`n`n# Imported template ($stamp)`n`n$srcText"
    }
    Write-Host "메모리 파일 병합: $dest"
  } else {
    Copy-Item $_.FullName $dest -Force
    Write-Host "메모리 파일 생성: $dest"
  }
}

if (Test-Path $SourceSkills) {
  Get-ChildItem $SourceSkills -Directory | ForEach-Object {
    $dest = Join-Path $TargetSkills $_.Name
    if (Test-Path $dest) {
      Copy-Item $dest "$dest.backup.$stamp" -Recurse -Force
      Write-Host "기존 스킬 백업: $dest.backup.$stamp"
    }
    Copy-Item $_.FullName $dest -Recurse -Force
    Write-Host "스킬 설치: $dest"
  }
}

if (Test-Path $SourceHermes) {
  if (Test-Path $TargetHermes) {
    Copy-Item $TargetHermes "$TargetHermes.backup.$stamp" -Recurse -Force
    Write-Host "기존 Hermes hook 백업: $TargetHermes.backup.$stamp"
  }
  Copy-Item $SourceHermes $TargetHermes -Recurse -Force
  Write-Host "Hermes hook 설치: $TargetHermes"
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Push-Location $TargetHermes
    try {
      npm install --omit=dev --no-audit --no-fund
      Write-Host "SQLite FTS 의존성 설치 완료: better-sqlite3"
    } catch {
      Write-Host "SQLite FTS 의존성 설치 실패. Markdown 검색 fallback으로 동작합니다."
    }
    Pop-Location
  } else {
    Write-Host "npm이 없어 SQLite FTS 의존성을 설치하지 않았습니다. Markdown 검색 fallback으로 동작합니다."
  }
}

# Seed hermes-memory-config.json if absent (do not overwrite user changes)
$TargetConfig = Join-Path $ClaudeDir 'hermes-memory-config.json'
$SourceConfigExample = Join-Path $SourceHermes 'hermes-memory-config.example.json'
if (-not (Test-Path $TargetConfig)) {
  if (Test-Path $SourceConfigExample) {
    Copy-Item $SourceConfigExample $TargetConfig -Force
    Write-Host "기본 설정 파일 생성: $TargetConfig"
  }
} else {
  Write-Host "기존 설정 파일 유지: $TargetConfig"
}

# Ensure projects-memory root exists
$TargetProjectsMemory = Join-Path $ClaudeDir 'projects-memory'
New-Item -ItemType Directory -Force -Path $TargetProjectsMemory | Out-Null

if (Test-Path $SourceCommands) {
  Get-ChildItem $SourceCommands -File | ForEach-Object {
    $dest = Join-Path $TargetCommands $_.Name
    if (Test-Path $dest) { Copy-Item $dest "$dest.backup.$stamp" -Force }
    Copy-Item $_.FullName $dest -Force
    Write-Host "명령 설치: $dest"
  }
}

# Register Claude Code hooks in ~/.claude/settings.json without removing existing hooks.
$settingsScript = @'
const fs = require('fs');
const path = require('path');
const home = process.env.USERPROFILE || process.env.HOME;
const settingsPath = path.join(home, '.claude', 'settings.json');
const hookCommand = 'node "' + path.join(home, '.claude', 'hermes-memory', 'hooks', 'memory-hook.js').replace(/\\/g, '/') + '"';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
settings.hooks ||= {};
function addHook(event, matcher = '') {
  settings.hooks[event] ||= [];
  let group = settings.hooks[event].find(g => (g.matcher || '') === matcher);
  if (!group) { group = { matcher, hooks: [] }; settings.hooks[event].push(group); }
  if (!group.hooks.some(h => h.type === 'command' && h.command === hookCommand)) {
    group.hooks.push({ type: 'command', command: hookCommand, timeout: 10 });
  }
}
addHook('UserPromptSubmit', '');
addHook('Stop', '');
addHook('SubagentStop', '');
addHook('PreCompact', '');
addHook('PostToolUse', '');
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('Claude Code hooks registered in ' + settingsPath);
'@
$settingsScript | node

Write-Host ""
Write-Host "설치 완료. Claude Code를 재시작한 뒤 사용하세요."
Write-Host "전역 메모리 위치: $TargetMemory"
Write-Host "전역 스킬 위치: $TargetSkills"
Write-Host "Hermes hook 위치: $TargetHermes"
Write-Host "Claude 명령 위치: $TargetCommands"
