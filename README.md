# Pensieve

Claude Code에서 전역·프로젝트별 기억을 저장하고 다시 불러오는 Windows용 메모리 도구입니다.

## 설치

1. [최신 릴리스](https://github.com/minjund/pensieve/releases/latest)에서 `Pensieve-Setup.exe`를 내려받아 실행합니다.
2. 설치를 완료한 뒤 Claude Code를 다시 시작합니다.

Claude Code와 Node.js가 필요합니다. 설치 프로그램은 메모리 파일, 명령, 훅을 사용자 홈의 `.claude` 폴더에 설치합니다. SQLite 검색을 위한 `better-sqlite3`는 설치 과정에서 npm으로 내려받습니다.

소스에서 직접 설치하려면 저장소 폴더의 PowerShell에서 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

## 주요 기능

- 전역·프로젝트별 Markdown 메모리와 SQLite FTS5 검색
- 세션 시작 시 기억 주입과 관련 기억 자동 검색
- 메모리 추가·검색·수정·삭제 및 중복 정리 명령
- 메모리 노이즈 정리와 비밀정보·프롬프트 주입 패턴 차단
- Windows 설치·제거 프로그램

설치 위치와 기본 사용법은 [상세 안내](README_먼저읽기.md)를 참고하세요. 메모리 주입 설계는 [설계 문서](global/hermes-memory/docs/MEMORY-INJECTION-DESIGN.md)에 있으며, `pensieve-dashboard.html`을 브라우저로 열면 구조를 확인할 수 있습니다.

## 개발

전체 테스트는 PowerShell에서 실행합니다.

```powershell
cd global/hermes-memory
npm install
$testFiles = @(Get-ChildItem tests -Filter '*.test.js' | ForEach-Object { $_.FullName })
node --test @testFiles
```

저장소 루트에서 Windows 설치 파일을 빌드합니다. Inno Setup이 없으면 빌드 스크립트가 winget으로 설치를 시도합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

결과는 `dist/Pensieve-Setup.exe`에 생성됩니다.
