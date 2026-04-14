# YouTubeRandomPlay 프로젝트 코드 문서

## 문서 편집 원칙
이 문서는 AI가 코드베이스를 이해하고 올바른 코드를 생성하도록 돕기 위한 문서다
- 코드를 보면 바로 알 수 있는 자명한 내용은 생략
- 각 파일과 클래스와 함수의 **의도**, **비자명한 동작**, **중요한 아키텍처 결정**만 기록
- 이 문서는 인간보다 AI가 주로 보는 문서이므로 수정 이력은 불필요하며 코드의 각 클래스와 함수의 현재 상태를 기술하고, 더 이상 유효하지 않은 내용은 즉시 삭제 해야함

## 프로그래밍 작업 원칙
### General Development Approach
- Think before acting. Read existing files before writing code.
- Reason thoroughly.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- User instructions always override this file.
### Project-Specific Approach
- 기능을 구현하기 전에 먼저 이 Document.md를 확인하여, 비슷한 기능이나 유틸리티가 이미 존재하는지 확인
- 기존 코드와 기존 유틸리티 함수(예: `extractAccountFromUrl`, `normalizeUrl` 등)를 적극 재사용하고, 기존과 비슷한 로직을 만들어야 하는 경우가 생기면 가능한 공통 로직으로 만들어서 최대한 같은 로직을 중복 구현하지 않도록 해야함
- 요구사항이 불분명하거나 여러 해석이 가능한 경우, 추측하지 말고 사용자에게 질문
- 코드 수정 후 Document.md도 함께 갱신
- 하나의 정보를 담은 로그는 반드시 한 줄로 작성 (Linux grep 같은 도구로 검색 용이)
  - 좋은 예: `Logger.log('✅ Task completed - id: ${taskId}, duration: ${duration}ms, result: ${result}')`
  - 나쁜 예: 여러 개의 Logger.log 호출로 관련 정보 분산
- 문제의 원인을 바로 파악하기 어려운 경우, 먼저 원인 분석에 도움이 되는 로그를 추가하고 다음 발생 시 로그를 기반으로 재분석
- 사용량 절약을 위해, 어렵지 않은 작업(단순 텍스트 수정, 로그 추가, 간단한 리팩터링 등)은 Gemini CLI를 실행하여 처리할 수 있음. 단, Gemini에게 작업을 넘기기 전에 반드시 사용자에게 먼저 질문하여 넘길지 여부를 확인받을 것

## 프로젝트 개요

YouTube 재생목록을 자동으로 순환 재생하는 Electron 데스크톱 애플리케이션입니다. 주로 일본 애니메이션/성우 관련 채널의 재생목록을 뮤트 상태로 백그라운드 재생합니다.

### 주요 기능
- 4개의 채널 리스트를 매일 로테이션 (4일 주기)
- 1시간마다 랜덤 재생목록으로 자동 전환
- 재생목록 내에서 랜덤 동영상 자동 클릭
- 오디오 항상 뮤트
- 주소창 수동 URL 입력 지원 (? 접두사로 구글 검색)

### 기술 스택
- Electron v13.1.7
- Node.js (renderer에서 직접 사용, contextIsolation: false)
- Electron Webview API

---

## 아키텍처 구조

### 메인 프로세스
- `main.js` - Electron 윈도우 생성, 캐시 관리

### 렌더러 프로세스
- `index.html` - UI (주소창 + webview)
- `EventHandler.js` - 핵심 로직 (재생 사이클, 이벤트 처리, URL 검증)
- `preload.js` - 버전 표시 (최소한의 기능)

### 데이터
- `ChannelList.js` - 메인 재생목록 (383개 URL)
- `ChannelList_l_h.js` - 경량 세트 (232개)
- `ChannelList_l_n.js` - 경량 세트 (204개)
- `ChannelList_l_u.js` - 최경량 세트 (191개)
- `channel_record.json` - 런타임 상태 (오늘 날짜, 활성 채널리스트 인덱스)
- `tlds-alpha-by-domain.js` - IANA TLD 목록 (URL 검증용)

---

## 파일별 상세 설명

### main.js
**역할**: Electron 메인 프로세스 - 윈도우 생성, PIP 모드 관리, 디버그 로깅

**백그라운드 쓰로틀링 대책 (3단계)**
- `webPreferences.backgroundThrottling: false` — 호스트 렌더러(index.html)의 타이머 쓰로틀링 방지. **webview 게스트 프로세스에는 적용되지 않음**
- `app.commandLine.appendSwitch('disable-renderer-backgrounding')` — Chromium 스위치. 비활성 창의 렌더러 프로세스 우선순위 낮추기 방지 (webview 포함)
- `app.commandLine.appendSwitch('disable-background-timer-throttling')` — Chromium 스위치. 비활성 탭/창의 타이머 쓰로틀링 방지 (webview 포함)

**PIP 모드**
- 시작 시 PIP 모드 (320x180, alwaysOnTop, 프레임리스)
- `isPip` 플래그로 모드 관리 (`win.isAlwaysOnTop()` 대신 — OS가 alwaysOnTop을 풀어도 PIP 의도 유지)
- `win.setAlwaysOnTop(true, 'screen-saver')` — 전체화면 앱 위에도 표시 (기본 `'floating'` 레벨은 전체화면 뒤에 숨겨짐)
- `always-on-top-changed` 이벤트: PIP 모드에서 alwaysOnTop이 풀리면 자동 복구 (리사이즈 등에 의한 해제 대응)
- 일반 모드 전환 시 `normalBounds` 복원 (초기값 527x407)

`createWindow()`
- PIP 모드로 윈도우 생성 (320x180, frame: false, alwaysOnTop: true)
- `did-finish-load`에서 렌더러에 `pip-changed` IPC 전송
- `always-on-top-changed`, `resize` 이벤트에 디버그 로그 연결

`ipcMain.on('toggle-pip')` — PIP ↔ 일반 모드 전환. PIP 진입 시 현재 bounds 저장, 해제 시 복원

`log(msg)` — `debug.log` 파일에 타임스탬프 포함 로그 추가 (appendFileSync)

**IPC 핸들러**: `toggle-pip`, `window-minimize`, `window-maximize`, `window-close`

---

### index.html
**역할**: UI 레이아웃 - 커스텀 타이틀바, 주소창, PIP 바, webview

**모드별 UI 전환** (`body.pip-mode` CSS 클래스)
- **일반 모드**: `#titleBar`(드래그 가능, 윈도우 컨트롤 버튼) + `#addressDivision`(주소창) 표시, `#pipBar` 숨김
- **PIP 모드**: `#titleBar` + `#addressDivision` 숨김, `#pipBar`(드래그 가능, ⛶해제 + ✕종료 버튼) 표시

**타이틀바 버튼 (일반 모드)**: ⛶(PIP 진입), ─(최소화), □(최대화), ✕(닫기)
**PIP 바 버튼 (PIP 모드)**: ⛶(PIP 해제), ✕(종료)

---

### EventHandler.js
**역할**: 핵심 애플리케이션 로직 - 재생 사이클, 이벤트 처리, URL 검증, PIP/윈도우 제어 IPC

**글로벌 상태 변수**
- `play` (boolean) — YouTube 재생 버튼 클릭 인터벌이 활성화되었는지 여부
- `click` (boolean) — 재생목록 내 랜덤 동영상 클릭이 완료되었는지 여부
- `intervalID` (Set) — 활성 setInterval ID 추적 (정리용)
- `randomPlayTimeoutID` — RandomPlay 1시간 타이머 ID (크래시 복구 시 중복 방지용)

`log(msg)` — `debug.log` 파일에 타임스탬프 포함 로그 추가 (main.js와 동일 파일에 기록)

**채널 리스트 로테이션**

`getChannelListForToday()`
- `channel_record.json`에서 마지막 사용 날짜와 인덱스 로드
- 오늘과 같은 날짜면 같은 인덱스 유지, 다른 날이면 다음 인덱스로 순환 (% 4)
- 프로그램 시작 시 1회 실행, 결과를 `channelList` 상수에 저장

**재생 사이클**

`RandomPlay()`
- 이전 1시간 타이머 취소 후 `play`, `click` 플래그 리셋
- `channelList`에서 `crypto.randomInt()`으로 랜덤 URL 선택 후 webview 로드
- `setTimeout(RandomPlay, 3600000)` — 1시간 후 재귀 호출

**OnBodyLoad()**
- webview 이벤트 리스너 등록 (did-navigate, did-navigate-in-page, did-frame-finish-load)
- PIP/윈도우 버튼 이벤트 리스너 등록 (pipEnterBtn, pipExitBtn, pipCloseBtn, minBtn, maxBtn, closeBtn → ipcRenderer.send)
- webview `crashed` 이벤트 → `RandomPlay()` 재시작 (webview 프로세스 크래시 시 자동 복구)
- `ipcRenderer.on('pip-changed')` — body에 `pip-mode` CSS 클래스 토글
- `RandomPlay()` 10ms 후 호출

**이벤트 핸들러 동작 흐름**

1. `OnWebViewTranslationDidNavigate()` — 페이지 전체 로드 시
   - 주소창 업데이트, 오디오 뮤트
   - `insertCSS`로 YouTube 로고(`ytd-topbar-logo-renderer`) 및 만들기 버튼(`ytd-button-renderer.style-scope.ytd-masthead`) 숨김
   - `play == false`이면: 1초 인터벌로 YouTube 재생 버튼 CSS 클래스 탐색 및 클릭 → `play = true`

2. `OnWebViewTranslationDidFrameFinishLoad()` — 프레임 로드 완료 시
   - `play == false`이면 `click = true` 설정 후 조기 반환
   - YouTube watch 페이지일 때: 인터벌 정리 후 60초 대기 → 재생목록 사이드바에서 랜덤 동영상 클릭
   - **실제 랜덤 동영상 클릭이 발생하는 유일한 경로**: RandomPlay() → 재생목록 로드 → play 버튼 클릭 인터벌 시작(play=true) → did-frame-finish-load에서 watch 페이지 감지 → click==false 확인 → 60초 후 랜덤 클릭 → click=true

**랜덤 동영상 클릭의 비자명한 동작**
- `elements.length / 10` — 재생목록 앞쪽 10%에서만 랜덤 선택 (전체가 아닌 상위 항목 선호)
- CSS 클래스 `yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer` — YouTube 재생목록 사이드바 동영상 요소

**URL 검증 (OnTextBoxAddressKeyDown)**
- 검증 순서: 온전한 URI → `?` 검색 → IPv4 → TLD 검증 → DNS 비동기 질의 + 동시에 구글 검색
- **비자명한 결정**: DNS 질의 결과 대기 중 사용자 체감 지연 방지를 위해 구글 검색을 동시 실행

---

## 주요 타이밍

| 타이머 | 값 | 용도 |
|--------|------|------|
| 초기 시작 | 10ms | OnBodyLoad → RandomPlay 지연 호출 |
| 재생 버튼 클릭 | 1초 인터벌 | YouTube 재생 버튼 반복 탐색/클릭 |
| 랜덤 동영상 클릭 | 60초 대기 | watch 페이지 로드 후 재생목록 동영상 클릭 |
| 재생목록 로테이션 | 1시간 (3,600,000ms) | 새 랜덤 재생목록으로 전환 |

---

## IPC 통신

| 채널 | 방향 | 용도 |
|------|------|------|
| `toggle-pip` | renderer → main | PIP ↔ 일반 모드 전환 |
| `window-minimize` | renderer → main | 윈도우 최소화 |
| `window-maximize` | renderer → main | 윈도우 최대화/복원 토글 |
| `window-close` | renderer → main | 윈도우 닫기 |
| `pip-changed` | main → renderer | PIP 모드 변경 알림 (boolean) |
