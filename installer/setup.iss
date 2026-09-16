; Inno Setup Script - Pensieve Installer
; Build: ISCC.exe setup.iss
; Output: ..\dist\Pensieve-Setup.exe

#define MyAppName "Pensieve"
#define MyAppTagline "Claude의 기억 그릇"
#define MyAppVersion "0.11.0"
#define MyAppPublisher "winCube"
#define MyAppExeNameDummy "pensieve.txt"

[Setup]
AppId={{8B7E2F11-9CC8-4D6E-8E4F-3D2A1F8C9A02}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppSupportURL=https://github.com/minjund/pensieve
DefaultDirName={localappdata}\ClaudeHermesMemory
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=Pensieve-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#MyAppName} {#MyAppVersion}
SetupLogging=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; 메모리 마크다운 템플릿
Source: "..\global\memory\*"; DestDir: "{%USERPROFILE}\.claude\memory"; Flags: ignoreversion recursesubdirs createallsubdirs onlyifdoesntexist
; 글로벌 스킬
Source: "..\global\skills\*"; DestDir: "{%USERPROFILE}\.claude\skills"; Flags: ignoreversion recursesubdirs createallsubdirs
; Hermes 런타임 (훅, lib, cli, 설정 예시)
Source: "..\global\hermes-memory\*"; DestDir: "{%USERPROFILE}\.claude\hermes-memory"; Excludes: ".claude\*,node_modules\*,state\*"; Flags: ignoreversion recursesubdirs createallsubdirs
; 슬래시 명령
Source: "..\global\commands\*"; DestDir: "{%USERPROFILE}\.claude\commands"; Flags: ignoreversion recursesubdirs createallsubdirs
; CLAUDE.md (추가형 — 기존 보존 후 섹션 추가)
Source: "..\global\CLAUDE.md"; DestDir: "{tmp}"; DestName: "claude-md-snippet.md"; Flags: ignoreversion
; 설정 예시 파일을 기본 설정으로 (사용자 파일이 없을 때만)
Source: "..\global\hermes-memory\hermes-memory-config.example.json"; DestDir: "{%USERPROFILE}\.claude"; DestName: "hermes-memory-config.json"; Flags: ignoreversion onlyifdoesntexist
; 언인스톨 보조 스크립트 (앱 폴더에 보관)
Source: "..\scripts\uninstall-windows.ps1"; DestDir: "{app}"; Flags: ignoreversion
; settings.json 갱신용 헬퍼
Source: "register-hooks.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "merge-claude-md.js"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; 1. settings.json에 훅 등록
Filename: "node"; Parameters: """{app}\register-hooks.js"""; StatusMsg: "Claude Code 훅 등록 중..."; Flags: runhidden
; 2. CLAUDE.md에 Hermes 섹션 추가 (중복 방지)
Filename: "node"; Parameters: """{app}\merge-claude-md.js"" ""{tmp}\claude-md-snippet.md"""; StatusMsg: "CLAUDE.md 갱신 중..."; Flags: runhidden
; 3. better-sqlite3 자동 설치 (SQLite FTS5 검색용 — 무조건 진행)
Filename: "{cmd}"; Parameters: "/C cd /D ""%USERPROFILE%\.claude\hermes-memory"" && npm install --omit=dev --no-audit --no-fund"; StatusMsg: "SQLite (better-sqlite3) 설치 중... (1~2분 소요)"; Flags: runhidden

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-windows.ps1"" -Silent {code:GetKeepFlag}"; RunOnceId: "RemoveClaudeMemory"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
var
  KeepUserData: Boolean;

function GetInstalledVersion(): String;
var
  V: String;
begin
  Result := '';
  // user-mode install uses HKCU. Inno Setup appends "_is1" to AppId.
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8B7E2F11-9CC8-4D6E-8E4F-3D2A1F8C9A02}_is1', 'DisplayVersion', V) then
    Result := V
  else if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8B7E2F11-9CC8-4D6E-8E4F-3D2A1F8C9A02}_is1', 'DisplayVersion', V) then
    Result := V;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
  Prev: String;
  Choice: Integer;
begin
  Result := True;

  // 1. Detect existing installation and show explicit update dialog
  Prev := GetInstalledVersion();
  if Prev <> '' then
  begin
    if Prev = '{#MyAppVersion}' then
    begin
      Choice := MsgBox(
        'Pensieve v' + Prev + '이(가) 이미 설치되어 있습니다.' + #13#10 + #13#10 +
        '같은 버전을 다시 설치(복구)하시겠습니까?' + #13#10 + #13#10 +
        '[예] 진행 — 메모리/설정은 그대로 보존' + #13#10 +
        '[아니오] 취소',
        mbConfirmation, MB_YESNO);
      if Choice = IDNO then
      begin
        Result := False;
        Exit;
      end;
    end
    else
    begin
      Choice := MsgBox(
        '기존 Pensieve v' + Prev + ' 발견.' + #13#10 +
        '새 버전 v{#MyAppVersion}(으)로 업데이트하시겠습니까?' + #13#10 + #13#10 +
        '✓ 메모리 데이터 (~/.claude/memory, ~/.claude/projects-memory) 그대로 보존' + #13#10 +
        '✓ 사용자 설정 (~/.claude/hermes-memory-config.json) 그대로 보존' + #13#10 +
        '✓ Hook 등록은 멱등 (중복 등록 없음, 깨진 분할 hook 자동 정리)' + #13#10 + #13#10 +
        '[예] 업데이트 진행' + #13#10 +
        '[아니오] 취소',
        mbConfirmation, MB_YESNO);
      if Choice = IDNO then
      begin
        Result := False;
        Exit;
      end;
    end;
  end;

  // 2. Node.js 자동 설치 (winget) — 없으면 자동 시도
  if not Exec(ExpandConstant('{cmd}'), '/C node --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    Choice := MsgBox(
      'Node.js가 감지되지 않았습니다. (훅과 SQLite 동작에 필수)' + #13#10 + #13#10 +
      'winget으로 Node.js 22 LTS를 자동 설치할까요?' + #13#10 + #13#10 +
      '[예] winget install OpenJS.NodeJS.LTS 실행 (수 분 소요)' + #13#10 +
      '[아니오] 설치 건너뛰기 (직접 설치 후 인스톨러 재실행 권장)',
      mbConfirmation, MB_YESNO);
    if Choice = IDYES then
    begin
      // winget으로 Node LTS 설치 시도
      if Exec(ExpandConstant('{cmd}'),
              '/C winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements',
              '', SW_SHOW, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
      begin
        MsgBox(
          'Node.js 설치 완료.' + #13#10 + #13#10 +
          '⚠️ 새 PATH 반영을 위해 이 인스톨러를 종료하고 다시 실행해주세요.' + #13#10 +
          '재실행 시 SQLite도 자동 설치됩니다.',
          mbInformation, MB_OK);
        Result := False;  // 종료 — 사용자가 재실행해야 PATH가 잡힘
        Exit;
      end
      else
      begin
        MsgBox(
          'winget으로 Node.js 자동 설치 실패 (exit code: ' + IntToStr(ResultCode) + ').' + #13#10 + #13#10 +
          '직접 설치 후 재실행해주세요:' + #13#10 +
          '  https://nodejs.org/en/download' + #13#10 + #13#10 +
          'winget이 없는 경우: Microsoft Store에서 "App Installer" 설치 필요.',
          mbError, MB_OK);
        Result := False;
        Exit;
      end;
    end
    else
    begin
      if MsgBox(
           'Node.js 없이 진행하면 훅과 SQLite가 동작하지 않습니다.' + #13#10 +
           '그래도 계속 설치하시겠습니까?',
           mbConfirmation, MB_YESNO) = IDNO then
        Result := False;
    end;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  KeepUserData := MsgBox(
    '사용자 메모리/노트 데이터를 보존하시겠습니까?' + #13#10 + #13#10 +
    '[예] 보존: ~/.claude/memory, ~/.claude/projects-memory 그대로 둠 (재설치 시 복원됨)' + #13#10 +
    '[아니오] 삭제: 모든 메모리 데이터까지 완전 제거',
    mbConfirmation, MB_YESNO) = IDYES;
end;

function GetKeepFlag(Param: String): String;
begin
  if KeepUserData then
    Result := '-KeepUserData'
  else
    Result := '';
end;
