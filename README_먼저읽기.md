# Claude 전역 메모리 패키지 (v0.4)

이 패키지는 Pi 없이 Claude Code에서 공통 메모리를 쓰기 위한 전역 설정입니다.

v0.4부터는 4가지 큰 기능이 추가되었습니다.

1. **프로젝트 스코프 분리** — 글로벌 메모리는 `~/.claude/memory/`, 프로젝트별 메모리는 `~/.claude/projects-memory/<projectSlug>/`에 저장됩니다. 슬러그는 `basename(cwd)`에서 자동 추출되며 `/memory-switch-project <name>`으로 고정할 수 있습니다.
2. **설정 파일** — `~/.claude/hermes-memory-config.json`에서 메모리 한도, LLM 추출 사용 여부, FIFO 전략, 세션 인덱싱 토글 등을 조정합니다.
3. **CRUD 슬래시 명령** — `/memory-add`, `/memory-search`, `/memory-replace`, `/memory-remove`, `/memory-switch-project`, `/memory-stats`, `/memory-index-sessions` 등이 추가되었습니다.
4. **SQLite 세션 인덱서** — `better-sqlite3` 설치 시 모든 Claude Code 세션 트랜스크립트가 `~/.claude/memory/sessions.db`의 FTS5 인덱스로 적재되어 `/memory-search "..." --sessions`로 검색됩니다.

사용자가 `기억해`, `앞으로`, `하지마`, `아니야`, `실패`, `오류` 같은 표현을 쓰면 자동으로 적절한 메모리 파일에 저장됩니다 (프로젝트 활성 상태면 프로젝트 폴더로, 그렇지 않으면 글로벌로).

## 가장 쉬운 설치 방법

Windows PowerShell에서 압축을 푼 폴더로 이동한 뒤 실행하세요.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

설치 후 Claude Code를 다시 실행하면 됩니다.

## 설치되는 위치

```text
C:\Users\<사용자>\.claude\CLAUDE.md
C:\Users\<사용자>\.claude\hermes-memory-config.json
C:\Users\<사용자>\.claude\memory\USER.md
C:\Users\<사용자>\.claude\memory\MEMORY.md
C:\Users\<사용자>\.claude\memory\FAILURES.md
C:\Users\<사용자>\.claude\memory\SKILLS.md
C:\Users\<사용자>\.claude\memory\PROJECTS.md
C:\Users\<사용자>\.claude\memory\sessions.db
C:\Users\<사용자>\.claude\projects-memory\<projectSlug>\MEMORY.md      (자동 생성)
C:\Users\<사용자>\.claude\projects-memory\<projectSlug>\FAILURES.md    (자동 생성)
C:\Users\<사용자>\.claude\projects-memory\<projectSlug>\CONVENTIONS.md (자동 생성)
C:\Users\<사용자>\.claude\projects-memory\<projectSlug>\SKILLS.md      (자동 생성)
C:\Users\<사용자>\.claude\skills\use-global-memory\SKILL.md
C:\Users\<사용자>\.claude\hermes-memory\hooks\memory-hook.js
C:\Users\<사용자>\.claude\hermes-memory\memory-cli.js
C:\Users\<사용자>\.claude\hermes-memory\lib\*.js
C:\Users\<사용자>\.claude\commands\memory-insights.md
C:\Users\<사용자>\.claude\commands\memory-interview.md
C:\Users\<사용자>\.claude\commands\memory-consolidate.md
C:\Users\<사용자>\.claude\commands\memory-skills.md
C:\Users\<사용자>\.claude\commands\memory-preview-context.md
C:\Users\<사용자>\.claude\commands\memory-search.md
C:\Users\<사용자>\.claude\commands\learn-memory-tool.md
C:\Users\<사용자>\.claude\commands\memory-add.md
C:\Users\<사용자>\.claude\commands\memory-replace.md
C:\Users\<사용자>\.claude\commands\memory-remove.md
C:\Users\<사용자>\.claude\commands\memory-switch-project.md
C:\Users\<사용자>\.claude\commands\memory-stats.md
C:\Users\<사용자>\.claude\commands\memory-index-sessions.md
```

## 수동 설치 방법

1. `global\memory` 폴더를 `C:\Users\<사용자>\.claude\memory`로 복사합니다.
2. `global\skills` 폴더 안의 스킬들을 `C:\Users\<사용자>\.claude\skills`로 복사합니다.
3. `global\CLAUDE.md` 내용을 `C:\Users\<사용자>\.claude\CLAUDE.md`에 붙여넣습니다.
4. 기존 `CLAUDE.md`가 있으면 지우지 말고 아래쪽에 추가하세요.

## 자동 저장 범위

자동 저장은 다음처럼 명확한 표현에 강합니다.

```text
이거 기억해: 나는 짧은 답변을 선호해.
앞으로 npm 말고 pnpm 써.
아니야, 그 방식 하지마.
이 에러는 이전에 실패했어.
```

저장 위치:

- 선호/프로필: `~/.claude/memory/USER.md`
- 일반 기억: `~/.claude/memory/MEMORY.md`
- 실패/교정: `~/.claude/memory/FAILURES.md`

현재 버전은 2단계로 저장합니다.

1. 로컬 규칙 기반 즉시 저장
2. 세션 종료 시 `claude -p`를 사용할 수 있으면 LLM 기반 정밀 추출 시도

또한 `better-sqlite3` 설치가 성공하면 `~/.claude/memory/sessions.db`에 SQLite FTS5 검색 인덱스를 생성합니다. 설치가 실패해도 Markdown fallback으로 동작합니다.

## 사용법

Claude Code에서 아무 프로젝트나 열고 이렇게 말하면 됩니다.

```text
전역 메모리 확인하고 작업해줘.
```

또는 스킬 트리거를 사용할 수 있으면:

```text
/memory
```

그냥 작업을 요청해도 `CLAUDE.md` 지침에 따라 필요한 경우 `~/.claude/memory`를 참고합니다.

## 주의

- API 키, 비밀번호, 토큰은 메모리에 저장하지 마세요.
- 메모리는 참고자료입니다. 현재 요청과 실제 프로젝트 파일이 더 우선입니다.
- Claude 웹 Project에서는 이 파일을 자동으로 읽지 않습니다. Claude Code용입니다.
