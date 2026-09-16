# 메모리 주입 설계 — "기억하고 답한다"는 체감 만들기

> 목표: 사용자가 **"이 AI가 나와 이 프로젝트를 기억하고 그 위에서 답한다"** 고 느끼게 한다.
> 기능 나열이 아니라 **체감(felt memory)** 이 기준이다.

## 1. 체감을 만드는 4요소

| # | 요소 | 출처 | 없으면 생기는 느낌 |
|---|---|---|---|
| A | **정체성** — 내가 누군지 안다 | 인터뷰/Profile (직업·환경·스택) | "처음 보는 사람한테 매번 설명" |
| B | **말투/스타일 일관성** | BEHAVIOR.md (존댓말·간결) | "성격이 매번 바뀐다" |
| C | **프로젝트 연속성** — 우리가 뭘 하는지/어떻게 하는지 안다 | 프로젝트 CONVENTIONS/MEMORY/FAILURES | "어제 정한 걸 또 묻는다" |
| D | **과거결정 회상** — 필요할 때 끄집어낸다 | FTS 검색 (/memory-search) | "저번에 말했는데 모른다" |

A·B는 **항상 켜져 있어야** 하고(작음), C는 **세션 시작에 깔려** 있어야 하며(중간), D는 **필요할 때 불러오면** 된다(큼·온디맨드).

## 2. 하드 제약 (실측·공식 확인)

- **훅 출력 10,000자 하드 캡** (SessionStart·UserPromptSubmit 동일). 초과 시 전문은 파일로 빠지고 모델은 프리뷰만 봄 = 인라인 미표시.
- SessionStart: 세션 시작 1회, **세션 내내 유지**, `--resume` 시 재실행, UserPromptSubmit과 **독립된 10K 예산**.
- UserPromptSubmit: 매 턴, 매번 10K 예산(토큰도 매 턴 청구).

→ **"둘 다 풀 주입"은 불가능.** 10K를 우선순위로 쪼개는 게 유일한 정답.

## 3. 3-레이어 아키텍처

```
┌─ Layer 1: IDENTITY (항상, 매 턴) ─ ~1.5K ──────────────┐
│  · 정체성(인터뷰 핵심) + BEHAVIOR 카드 + 회상 정책       │
│  · UserPromptSubmit마다 주입 → 세션이 compact돼도 생존   │
├─ Layer 2: SNAPSHOT (세션 시작 1회, 지속) ─ ~7K ─────────┤
│  · 프로젝트 메모리(CONVENTIONS+최근 MEMORY/FAILURES)     │
│  · 글로벌 digest(크로스-프로젝트 요약)                   │
│  · SessionStart 훅 → 1회 주입, 세션 내내 유지            │
└─ Layer 3: RETRIEVAL (온디맨드) ─ 무제한 ───────────────┘
   · 나머지 전부 → /memory-search (FTS5 + 마크다운)
```

## 4. 10K 예산 배분 (SessionStart 기준)

| 블록 | 내용 | 예산 | 핀 고정? |
|---|---|---|---|
| `<who>` | 인터뷰 Profile 핵심 (직업·환경·스택·말투) | ~700 | ✅ 항상 |
| `<behavior>` | BEHAVIOR.md (행동 규칙) | ~500 | ✅ 항상 |
| `<project:slug>` | 4파일(MEMORY/FAILURES/CONVENTIONS/SKILLS) 엔트리를 **날짜 최신순 머지** → injectCharLimit까지 | ~5,500 | 최근+중요 |
| `<global-digest>` | 글로벌 크로스-프로젝트 요약 | ~1,500 | 최근 |
| `<recall-policy>` | "여기 없으면 /memory-search 먼저" | ~600 | ✅ |
| **합계** | | **~8,800 / 10,000** | 헤드룸 1.2K |

UserPromptSubmit(매 턴)은 `<who>` + `<behavior>` + `<recall-policy>`만 ≈ **~1.8K** 경량.

## 5. 체감 레버 — 프레이밍

스냅샷 헤더로 모델 행동을 유도한다:

```
<memory-snapshot source="session-start">
당신은 이 사용자와 이 프로젝트를 이미 안다. 아래는 당신이 기억하는 내용이다.
여기 있는 걸 다시 묻지 말고, 기억하는 사람처럼 그 위에서 답하라.
여기 없는 과거 결정은 단정하지 말고 /memory-search로 먼저 확인하라.
... (who / behavior / project / global) ...
</memory-snapshot>
```

핵심은 "기억하는 사람처럼 답하라 + 모르면 검색하라" — 이게 D(회상)까지 연결해 **체감을 완성**한다.

## 6. 전달 메커니즘

| 훅 | 주입 내용 | 빈도 | 근거 |
|---|---|---|---|
| **SessionStart** | Layer 1 + Layer 2 (전체 스냅샷 ~8.8K) | 세션당 1회, 지속 | pi의 frozen-snapshot을 네이티브 재현 |
| **UserPromptSubmit** | Layer 1만 (~1.8K) | 매 턴 | compact 생존 + 저장/회상 처리 |
| **(저장)** Stop/PostToolUse | classify + LLM 추출 + consolidate | 기존 유지 | 변경 없음 |

> 왜 Layer 1을 매 턴 또?: 긴 세션에서 컨텍스트가 compact되면 SessionStart 스냅샷이 요약돼 사라질 수 있음. 정체성·말투는 작으니 매 턴 다시 깔아 **절대 안 흔들리게** 한다. 프로젝트/글로벌은 크니 1회만(사라지면 검색으로 복구).

## 7. 구현 항목

1. **`memory-hook.js`에 `SessionStart` 핸들러 추가** — `composeSnapshot()` 호출, `source`(startup/resume) 처리.
2. **`lib/inject.js`**
   - `buildIdentityCard()` — USER.md Profile 섹션 핀 추출 (인터뷰 무조건 포함).
   - `composeSnapshot()` — Layer 2 전체 (who+behavior+project+digest+policy), 10K 예산 배분·캡.
   - `composeContext()`(UserPromptSubmit) → Layer 1 경량 모드로 축소.
3. **`installer/register-hooks.js` + settings.json** — SessionStart 이벤트 등록.
4. **config 키**: `snapshotCharLimit`(기본 9000), `identityCharLimit`(기본 700), `perTurnLight`(기본 true).
5. **테스트**: SessionStart 스냅샷 ≤ 캡, 인터뷰 포함 보장, UserPromptSubmit 경량 확인.

## 8. 결정된 것 / 열린 것

- ✅ 인터뷰는 항상 포함 (Layer 1 + 스냅샷 핀).
- ✅ 프로젝트 > 글로벌 우선순위.
- ✅ 10K 안에서 배분 (풀-둘다 포기).
- ✅ **프로젝트 비대 파일 압축 = 엔트리 날짜 최신순 머지(결정론)** — config `dumpMergeByDate`(기본 true). 4파일 엔트리를 분해→날짜 내림차순 정렬→injectCharLimit까지 최신부터 채움→`- [날짜 파일명] 내용` 한 줄씩. 파일별 고정 tail이 오래된 엔트리로 최신을 밀어내던 문제와 거친 중간절단을 제거하고, 중복은 dedupe, 드롭분은 `+N older entries — /memory-search`로 투명화. `dumpMergeByDate:false`면 레거시 파일별 tail로 폴백. (LLM 요약 압축은 v2 옵션으로 보류.)
- ❓ 글로벌 digest를 SessionStart에만 둘지, UserPromptSubmit 첫 턴에도 별도 10K로 더 실을지.
