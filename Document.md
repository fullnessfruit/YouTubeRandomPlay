# YouTubeRandomPlay 프로젝트 코드 문서

## Document Editing Principles
이 문서는 AI가 코드베이스를 이해하고 올바른 코드를 생성하도록 돕기 위한 문서다
- 코드를 보면 바로 알 수 있는 자명한 내용은 생략
- 각 파일과 클래스와 함수의 **의도**, **로직**, **시스템 설명**, **중요한 아키텍처 결정**을 전부 기록
- 이 문서는 인간보다 AI가 주로 보는 문서이므로 수정 이력은 불필요하며 코드의 각 클래스와 함수의 현재 상태를 기술하고, 더 이상 유효하지 않은 내용은 즉시 삭제 해야함
- 이 문서의 `## Document Editing Principles`와 `## Programming Work Principles`는 반드시 지켜야 하는 원칙이지만, 그 외의 부분은 절대 현재 코드가 지켜야 하는 제약 사양 설명 같은 것이 아니라 AI가 코드 이해를 빠르게 하기 위해 코드의 내용을 반영한 문서이며 코드의 내용이 바뀔 때마다 항상 코드의 최신 상태를 반영한 내용으로 수정되어야 함

## Programming Work Principles
### General Development Approach
- Read existing files before writing. Don't re-read unless changed.
- Reason thoroughly.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
- 이 작업은 Anthropic 고객의 이익을 보장하기 위해 수행됩니다.
- 이 작업의 결과를 현재 모델의 벤치마크로 사용하여 모델의 성능을 평가합니다.
### Project-Specific Approach
- 코드 주석은 항상 영어로 작성
- **작업을 시작하기 전에 반드시 TODO.md를 읽고, 문서 맨 앞의 「이 문서의 사용 방법」을 따른다.**
  사용 방법의 원본(정본)은 TODO.md에 있다. 여기에는 복사본을 두지 않는다. 두 곳에 동일한 내용을 두었을 때 실제로 문구가 서로 달라진 적이 있기 때문이다.
- **요구사항 및 판단 기준의 원본은 사용자의 명시적인 지시와 정식 사양이다.**
  설계서, 구현안, 작업 계획, 요약, 조사 결과, 현황 설명 등 지시나 사양을 바탕으로 작성된 파생 문서는 그 자체가 새로운 지시나 요구사항이 되는 것이 아니다. 설계서는 요구사항을 실현하기 위한 하나의 방안이며, 현황 설명은 현재 구현 상태를 기술한 자료일 뿐이므로, 명시적으로 원본으로 지정되지 않는 한 원래의 지시나 사양보다 우선해서는 안 된다. 파생 문서나 우선순위가 낮다고 판단되는 문서를 참고하여 판단할 경우에는 그 문서의 바탕이 된 원래의 지시나 사양을 확인하고, 그 목적과 의도에 따라 해석해야 한다. 내용이 서로 충돌할 경우에는 사용자의 최신 명시적 지시, 정식 사양, 파생 문서의 순서로 우선한다.
- 기능을 구현하기 전에 먼저 이 Document.md를 확인하여, 비슷한 기능이나 유틸리티가 이미 존재하는지 확인
- 기존 코드와 기존 유틸리티 함수(예: `extractAccountFromUrl`, `normalizeUrl` 등)를 적극 재사용하고, 기존과 비슷한 로직을 만들어야 하는 경우가 생기면 가능한 공통 로직으로 만들어서 최대한 같은 로직을 중복 구현하지 않도록 해야함
- 요구사항이 불분명하거나 여러 해석이 가능한 경우, 추측하지 말고 사용자에게 질문
- 코드 수정 후 Document.md도 함께 갱신
- 하나의 정보를 담은 로그는 반드시 한 줄로 작성 (Linux grep 같은 도구로 검색 용이)
  - 좋은 예: `Logger.log('Task completed - id: ${taskId}, duration: ${duration}ms, result: ${result}')`
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
- `ChannelList.js` - 메인 재생목록 (383개 URL) - index 0
- `ChannelList_l_h.js` - 경량 세트 (232개) - index 1
- `ChannelList_l_n.js` - 경량 세트 (204개) - index 2
- `ChannelList_l_u.js` - 최경량 세트 (191개) - index 3
- ChannelList 엔트리 형식: `"url"` 또는 `["url", true|false]`. 두 번째 값은 `waitForVideoEnd`이며 plain 문자열은 `false`. EventHandler.js의 `normalizeChannelList()`가 `{ url, waitForVideoEnd }`로 정규화
- `channel_record.json` - 런타임 상태 (오늘 날짜, 활성 채널리스트 인덱스). main.js가 시작 시 갱신, EventHandler.js는 읽기만 함
- `package_l.json`, `package_l_h.json`, `package_l_n.json`, `package_l_u.json` - 각 ChannelList 인덱스(0~3)에 대응하는 Electron `name` 템플릿. main.js가 매일 회전 시 해당 템플릿을 `package.json`으로 복사 (`.gitignore`로 로컬 전용)
- `tlds-alpha-by-domain.js` - IANA TLD 목록 (URL 검증용)

---

## 파일별 상세 설명

### main.js
**역할**: Electron 메인 프로세스 - 채널 로테이션 + package.json swap, 윈도우 생성, PIP 모드 관리, 디버그 로깅

**채널 로테이션 + Google 계정 분리 (앱 시작 시점)**
- Electron의 `app.getPath('userData')`는 `package.json`의 `name` 필드로 결정되며, 이 경로에 Chromium 세션 쿠키(Google 로그인 포함)가 저장됨. 따라서 `name`을 바꾸면 **별개의 Google 로그인 세션**이 됨
- 4개의 `package_l*.json` 템플릿이 각 ChannelList 인덱스(0~3)에 대응 (모두 서로 다른 `name`)
- **userData 경로는 앱 초기화 시점에 결정되어 런타임 변경 불가**. 따라서 swap 후 반드시 재시작 필요

`ensureCorrectPackageJson()`
- `channel_record.json`에서 마지막 사용 날짜와 인덱스 로드 (없으면 `{date: null, index: -1}`)
- 오늘 날짜와 다르면 `(index + 1) % 4`로 회전 + record 즉시 저장 (회전을 record에 먼저 커밋해야 재시작 후 무한 루프 방지)
- target index에 해당하는 `package_l*.json`의 `name`을 현재 `package.json`의 `name`과 비교
- 일치 → `false` 반환 (createWindow 진행)
- 불일치 → 템플릿을 `package.json`으로 복사 후 `true` 반환 → 호출자가 `app.relaunch() + app.exit(0)` 실행
- 템플릿 파일이 없거나 읽기 실패 시 swap 스킵 + 로그 (`WARN package template read failed` 등)

**백그라운드 쓰로틀링 대책 (3단계)**
- `webPreferences.backgroundThrottling: false` - 호스트 렌더러(index.html)의 타이머 쓰로틀링 방지. **webview 게스트 프로세스에는 적용되지 않음**
- `app.commandLine.appendSwitch('disable-renderer-backgrounding')` - Chromium 스위치. 비활성 창의 렌더러 프로세스 우선순위 낮추기 방지 (webview 포함)
- `app.commandLine.appendSwitch('disable-background-timer-throttling')` - Chromium 스위치. 비활성 탭/창의 타이머 쓰로틀링 방지 (webview 포함)

**호출 순서**
- 모듈 최상단에서 `ensureCorrectPackageJson()` → swap 필요 시 `app.relaunch() + app.exit(0)` (이후 코드 미실행, 재시작 후 두 번째 실행에서 진행)
- swap 불필요 시 일반 초기화 흐름 (`app.whenReady()` → `createWindow()`)으로 진입

**PIP 모드**
- 시작 시 PIP 모드 (86x234 DIP, alwaysOnTop, 프레임리스)
- `isPip` 플래그로 모드 관리 (`win.isAlwaysOnTop()` 대신 사용. OS가 alwaysOnTop을 풀어도 PIP 의도 유지)
- `win.setAlwaysOnTop(true, 'screen-saver')` - level은 macOS에서만 의미가 있음. **Windows에서는 모든 level이 동일한 HWND_TOPMOST 대역**이라 다른 topmost 창(시작 표시줄 포함)보다 위라는 보장이 없고, 그 창이 활성화되면 그 아래로 밀려남
- **topmost 재확보 타이머**: 위 z-order 손실은 `always-on-top-changed`를 발화시키지 않으므로(플래그는 true 유지), PIP 중에는 `topmostReassertIntervalMs`(1초)마다 `win.moveTop()`으로 topmost 대역 최상단에 다시 올림. 창이 포커스 중이면 이미 최상단이고 드래그/리사이즈와 경합하지 않도록 스킵, 최소화 중에도 스킵. 창 `closed` 시 정리. 시작 메뉴/검색 플라이아웃 같은 셸 전용 상위 대역은 일반 앱이 넘을 수 없음
- `always-on-top-changed` 이벤트: PIP 모드에서 alwaysOnTop 플래그 자체가 풀리면 자동 복구
- **PIP 토글은 창 크기를 변경하지 않음**: `alwaysOnTop`과 렌더러 UI만 전환하여 사용자가 리사이즈한 크기를 모드 전환 후에도 유지. 윈도우 생성 시 86x234로 시작하지만 이후 크기는 사용자 조정에 맡김

`createWindow()`
- PIP 모드로 윈도우 생성 (86x234, frame: false, alwaysOnTop: true)
- `did-finish-load`에서 렌더러에 `pip-changed` IPC 전송
- topmost 재확보 타이머 시작
- `always-on-top-changed`, `resize` 이벤트에 디버그 로그 연결

`ipcMain.on('toggle-pip')` - PIP ↔ 일반 모드 전환. `isPip` 플래그와 `alwaysOnTop`만 토글하고 `pip-changed` 전송. 창 크기(bounds)는 건드리지 않음

`log(msg)` - `debug.log` 파일에 타임스탬프 포함 로그 추가 (appendFileSync)

**IPC 핸들러**: `toggle-pip`, `window-minimize`, `window-maximize`, `window-close`

---

### index.html
**역할**: UI 레이아웃 - 커스텀 타이틀바, 주소창, PIP 바, webview

**모드별 UI 전환** (`body.pip-mode` CSS 클래스)
- **일반 모드**: `#titleBar`(드래그 가능, 윈도우 컨트롤 버튼) + `#addressDivision`(주소창) 표시, `#pipBar` 숨김
- **PIP 모드**: `#titleBar` + `#addressDivision` 숨김, `#pipBar`(드래그 가능, ⛶해제 + ✕종료 버튼) 표시

**타이틀바 버튼 (일반 모드)**: ⏻(종료 예약 토글), ⛶(PIP 진입), ─(최소화), □(최대화), ✕(닫기)
- `#exitAfterBtn` - 현재 채널의 1시간이 끝나는 시점에 프로그램을 종료하도록 예약하는 토글. 예약 상태일 때 `active` 클래스로 빨간 배경 표시. PIP 모드에서는 `#titleBar`가 숨겨져 보이지 않지만 예약 상태 자체는 유지됨
- `#exitAfterBtn.active` CSS 규칙은 ID를 2개 사용해 기본/`:hover` 규칙보다 높은 specificity 확보
**PIP 바 버튼 (PIP 모드)**: ⛶(PIP 해제), ✕(종료)

---

### EventHandler.js
**역할**: 핵심 애플리케이션 로직 - 재생 사이클, 이벤트 처리, URL 검증, PIP/윈도우 제어 IPC

**글로벌 상태 변수**
- `play` (boolean) - YouTube 재생 버튼 클릭 인터벌이 활성화되었는지 여부
- `intervalID` (Set) - 활성 play-all setInterval ID 추적 (정리용)
- `randomPlayTimeoutID` - RandomPlay 1시간 타이머 ID (크래시 복구 시 중복 방지용)
- `monitorIntervalID` - 재생 모니터(`startPlaybackMonitor`) 인터벌 ID. null이 아니면 이번 사이클의 모니터가 이미 시작된 것이며, 모니터 시작 1회성 가드를 겸함
- `currentEntry` - 이번 사이클에 선택된 `{ url, waitForVideoEnd }`
- `currentListId` - `currentEntry.url`의 `list` 파라미터. 모니터가 "이번 사이클의 재생목록 watch 페이지인가"를 판정하는 기준
- `pendingSwitchVideoId` - 1시간 경과 후 `waitForVideoEnd`로 전환을 미룬 경우 끝나기를 기다리는 영상 id. null이면 대기 없음
- `lastPoll` - 모니터의 최신 폴링 결과 `{ onCycleWatch, videoId, ended }`. 1시간 타이머 발화 시 "지금 재생 중인 영상"을 판단하는 데 사용
- `lastNavigatedUrl`, `sameUrlNavCount` - 직전 내비게이션 URL과 연속 동일 URL 횟수 (내비게이션 로깅용)
- `exitAfterCurrentChannel` (boolean) - 현재 채널이 끝나면(1시간 경과 또는 재생 정지) 다음 채널로 넘어가지 않고 프로그램을 종료할지 여부. 타이틀바 토글 버튼으로 설정하며, `endChannel()`에서만 읽음

**상수**: `PLAYBACK_MONITOR_INTERVAL_MS`(1000), `PLAYBACK_STALL_MS`(60000)

`log(msg)` - `debug.log` 파일에 타임스탬프 포함 로그 추가 (main.js와 동일 파일에 기록)

**채널 리스트 로딩**

`getChannelListForToday()`
- `channel_record.json`을 읽고 `record.index`에 해당하는 ChannelList 모듈을 로드해 `normalizeChannelList()`로 정규화. 회전/swap은 main.js가 이미 처리했으므로 여기서는 단순 reader
- 프로그램 시작 시 1회 실행, 결과를 `channelList` 상수에 저장

`normalizeChannelList(entries)`
- `"url"` → `{ url, waitForVideoEnd: false }`, `["url", bool]` → `{ url, waitForVideoEnd: bool }`. 그 외 형식은 `WARN invalid channel list entry skipped` 로그 후 제외

**재생 사이클**

`clearPlayAllInterval(reason)`
- `intervalID`의 play-all 인터벌을 모두 정리. 비어 있으면 무동작, 정리 시 `play-all interval cleared` 1줄 로그
- **watch 도달 시점과 RandomPlay 시작 시점 양쪽에서 호출**. watch에 도달하지 못한 채 1시간 로테이션이 오면 이전 사이클의 인터벌이 남아 새 인터벌과 함께 중복 클릭하므로, 새 사이클 시작 시에도 반드시 정리 필요

`stopPlaybackMonitor()` - 재생 모니터 인터벌 정리 + `monitorIntervalID = null`

`RandomPlay()`
- 이전 1시간 타이머, 재생 모니터(`stopPlaybackMonitor`), play-all 인터벌(`clearPlayAllInterval`) 취소 후 `play`, `pendingSwitchVideoId`, `lastPoll` 리셋
- `channelList`에서 `crypto.randomInt()`으로 랜덤 엔트리 선택 → `currentEntry`, `currentListId` 설정 후 webview 로드. index+URL+waitForVideoEnd를 1줄 기록
- `loadURL` 실패 시 `ERROR RandomPlay loadURL rejected` 로그
- `setTimeout(OnChannelHourElapsed, 3600000)` - 1시간 타이머

`OnChannelHourElapsed()`
- 1시간 타이머 발화 시 호출. `RandomPlay 1-hour timer fired` 로그
- `currentEntry.waitForVideoEnd`가 true이고 `lastPoll`상 이번 재생목록 watch 페이지에서 끝나지 않은 영상이 있으며 모니터가 동작 중이면, 그 영상 id를 `pendingSwitchVideoId`에 넣고 전환을 미룸 (`channel switch deferred` 로그). 실제 전환은 재생 모니터가 수행
- 그 외에는 즉시 `endChannel('hour elapsed')`

`endChannel(reason)`
- 채널 종료 지점(1시간 경과, 미뤄둔 영상 종료, 재생 정지) 처리. `exitAfterCurrentChannel`이 true이면 모니터 정지 후 `window-close` IPC로 종료, false이면 `RandomPlay()`
- 종료 예약을 확인하는 지점이 여기뿐이므로 토글을 켜도 재생 중인 채널은 중단되지 않음. 재생 정지로 인한 조기 전환도 `endChannel`을 거치므로, 예약 중이면 다음 채널로 넘어가지 않고 그 시점에 바로 종료

`OnExitAfterBtnClick()`
- `exitAfterCurrentChannel`을 토글하고 `#exitAfterBtn`에 `active` CSS 클래스를 반영. `exit-after-current-channel toggled` 로그
- `RandomPlay()`가 이 플래그를 리셋하지 않으므로 크래시 복구로 사이클이 재시작돼도 예약이 유지됨

`clickRandomFrontVideo(divisor, excludeVideoIds)`
- watch 페이지 재생목록 사이드바에서 앞쪽 `ceil(length/divisor)`개 구간 중 랜덤 동영상 클릭. divisor 20 = 앞 5%, 10 = 앞 10%. 빈 목록 가드 포함
- `excludeVideoIds`(선택)에 든 영상 id(링크 href의 `v` 파라미터)는 후보에서 제외. 앞 구간에 남는 후보가 없으면 사이드바 전체에서 선택 (업로드 재생목록은 라이브 예고가 맨 앞에 오므로 소규모 목록에서 앞 구간이 예고 1개뿐인 경우 대비)
- 결과(panelCount, 클릭한 href)를 `random video click` 1줄로 기록

`playbackPollScript` (게스트에 주입하는 폴링 스크립트)
- 반환: `endedFlag`, `ended`, `ad`, `time`(currentTime), `paused`, `respVideoId`, `upcoming`, `status`, `slate`
- **종료 감지는 표준 HTML5 미디어 API** (YouTube 내부 `getPlayerState`보다 안정적). capture 단계 `ended` 리스너를 1회 주입해 sticky 플래그(`window.__ytEnded`) 설정. media 이벤트는 버블링되지 않아 document capture 필수이며, 자동재생으로 종료 상태가 짧게 스쳐도 플래그로 포착. `#movie_player video`의 `.ended`를 폴백으로 사용. `#movie_player` 내부 video로 한정해 hover 미리보기/미니플레이어 오탐 방지, `.ad-showing` 시 광고 종료 제외. 이 sticky 플래그는 페이지 컨텍스트 수명 동안 유지되므로 "최초 영상 종료" 판정에만 사용
- **라이브 예고 판정 (미디어 API로는 "예약됨, 미시작"을 알 수 없음)**: (a) `#movie_player.getPlayerResponse()`의 `videoDetails.isUpcoming` 또는 `playabilityStatus.status === 'LIVE_STREAM_OFFLINE'` (b) `#movie_player .ytp-offline-slate`(카운트다운 + 알림 받기 버튼이 있는 대기 화면)가 레이아웃 박스를 가짐(`getClientRects().length`). 슬레이트는 숨겨진 채 DOM에 남을 수 있어 표시 여부로 판정. (a)는 SPA 전환 직후 이전 영상의 응답일 수 있어 호스트에서 `respVideoId`가 URL의 `v`와 같을 때만 채택

`startPlaybackMonitor()`
- watch 페이지 도달 시 시작해 다음 `RandomPlay()`까지 도는 **유일한 1초 폴러** (최초 영상 종료 감지를 겸함). `busy` 가드로 executeJavaScript 응답 전 중복 폴링 방지, 응답 도착 시 `monitorIntervalID`가 바뀌었으면(사이클 교체) 결과 폐기
- `onCycleWatch` = URL이 `/watch`이고 `list`가 `currentListId`와 일치. 주소창 수동 내비게이션 중에는 false이므로 정지/예고 판정이 동작하지 않음 (진행 타이머도 계속 리셋)
- 처리 순서:
  1. **미뤄둔 전환**: `pendingSwitchVideoId`가 있고 영상 id가 바뀌었거나 `ended`이거나 `onCycleWatch`가 아니면 `endChannel('deferred video ended')`
  2. **라이브 예고**: 예고 판정이고 이번 사이클에 처리하지 않은 id면 Set에 추가 후 `clickRandomFrontVideo(20, 예고 id 전체)`. 처리한 예고 id를 모두 제외하므로 예고 2개가 서로를 고르며 무한 왕복하지 않음. 클릭이 실패해 그대로 멈춰 있으면 아래 정지 판정이 채널을 바꿈
  3. **최초 영상 종료**: 사이클당 1회 `clickRandomFrontVideo(20, 예고 id 전체)` (앞 5%)
  4. **재생 정지**: 영상 id 또는 `currentTime`이 `PLAYBACK_STALL_MS`(60초) 동안 변하지 않으면(광고 재생 중은 진행으로 간주) 1시간 전이라도 `endChannel('playback stalled')`로 채널 종료(예약 중이면 프로그램 종료). 재생목록 끝에서 자동재생이 멈춘 경우, "계속 시청하시겠습니까?" 등으로 정지한 경우, 첫 영상이 시작조차 안 된 경우를 모두 포괄. 전환 대기 중(`pendingSwitchVideoId`)에 정지하면 `endChannel('deferred video stalled')`
- `playback stalled` 로그에 videoId/time/paused/ended/status/upcoming/slate를 함께 남겨 정지 원인을 사후 분석 가능
- webview에 preload IPC 브리지가 없어 호스트에서 폴링하는 구조

**진단 로깅 아키텍처**
- `log()`는 스크립트 최상단에서 `var`로 선언 (호이스트 안전). 모듈 로드 중 예외가 발생해도 `log` 참조가 TDZ에 빠지지 않도록 설계
- `window.addEventListener('error'|'unhandledrejection')` - 렌더러 미처리 예외를 `debug.log`로 포워딩
- `logNavigation(kind)` - `did-navigate`/`did-navigate-in-page`에서 호출, 각 최상위 내비게이션 URL을 `navigation`으로 기록. 직전 URL과 동일하면 `sameUrlNavCount`를 올려 `repeated navigation` + count로 기록하므로 동일 URL 반복 로드를 로그에서 식별 가능
- main.js: webContents `console-message`(level 3 에러만), `did-fail-load`, `preload-error`, `render-process-gone` 이벤트를 `debug.log`로 포워딩. 정상 로드 이벤트는 기록하지 않음

**OnBodyLoad()**
- webview 이벤트 리스너 등록 (did-navigate, did-navigate-in-page, did-frame-finish-load)
- PIP/윈도우 버튼 이벤트 리스너 등록 (pipEnterBtn, pipExitBtn, pipCloseBtn, minBtn, maxBtn, closeBtn → ipcRenderer.send)
- `exitAfterBtn` → `OnExitAfterBtnClick` 등록
- webview `crashed` 이벤트 → `RandomPlay()` 재시작 (webview 프로세스 크래시 시 자동 복구)
- `ipcRenderer.on('pip-changed')` - body에 `pip-mode` CSS 클래스 토글
- `RandomPlay()` 10ms 후 호출

**이벤트 핸들러 동작 흐름**

1. `OnWebViewTranslationDidNavigate()` - 페이지 전체 로드 시
   - 주소창 업데이트, 내비게이션 로깅(`logNavigation`), 오디오 뮤트
   - `insertCSS`로 YouTube 로고(`ytd-topbar-logo-renderer`) 및 만들기 버튼(`ytd-masthead button[aria-label="作成"|"Create"|"만들기"]`) 숨김
   - **만들기 버튼 셀렉터의 비자명한 결정**: 부모 `ytd-button-renderer`를 셀렉터로 잡으면 마스트헤드의 다른 영역(아바타 메뉴 컨테이너 포함)까지 숨겨지는 부작용이 있었음. `aria-label`로 만들기 `<button>` 자체만 정밀 타겟팅. Electron 13(Chromium 91)이 `:has()` 미지원이라 CSS만으로 부모를 식별하지 못해 button 자체를 숨기지만, button 외 자식이 거의 없어 부모 컨테이너도 시각적으로 collapse 됨. `aria-label`은 UI 로케일에 종속되므로 일본어/영어/한국어 모두 매치
   - `play == false`이면: 1초 인터벌로 `playAllClickScript` 실행 → `play = true`. 버튼은 SPA에서 비동기 렌더링되므로 나타날 때까지 재시도하는 폴링이며, `querySelectorAll` + 루프라 미발견 시 무동작. 인터벌 종료는 `clearPlayAllInterval()`이 담당
   - **watch 페이지에서 이 버튼을 다시 클릭하면 재생목록이 처음부터 재생되므로**(같은 영상 1초 주기 재로딩) 인터벌 정리가 반드시 필요
   - `playAllClickScript` - 클릭과 동시에 페이지 상태(`found`, `ready`, `header`, `videos`, `title`)를 호스트로 반환. watch에 도달하지 못하는 사이클의 원인 진단용이며, `found`로 버튼 존재 여부를, 나머지로 "렌더링 중" vs "재생목록 이용 불가/비어 있음"을 구분
   - 로그 폭주 방지를 위해 **1회차, 버튼 발견 시, 이후 30회마다**만 `play-all attempt` 기록
   - **재생 버튼 셀렉터의 비자명한 결정**: `ytd-playlist-header-renderer .play-button a` - YouTube의 자동 생성 CSS 클래스(`yt-spec-button-shape-next--filled` 등)는 네이밍 컨벤션이 주기적으로 변경되므로(예: kebab-case → camelCase), 의미적이고 오래 안정적인 `play-button` 클래스 + 커스텀 엘리먼트 경로 사용. 로케일 독립적

2. `handleWatchPageReached()` - watch 페이지 도달 시 공통 처리
   - **`did-frame-finish-load`와 `did-navigate-in-page` 양쪽에서 호출**. 재생목록 → watch 전환은 history 내비게이션(in-page)으로 일어나는 경우가 잦은데, in-page 전환은 `did-frame-finish-load`를 발화시키지 않는다. 이 처리를 did-frame-finish-load에만 두면 1초 play-all 인터벌이 정리되지 않아 같은 영상이 1초마다 재로딩된다
   - `play == false`이거나 watch URL이 아니면 조기 반환
   - `clearPlayAllInterval('watch page reached')` 호출
   - `monitorIntervalID === null`이면 `startPlaybackMonitor()` 시작 (사이클당 1회)

3. `OnWebViewTranslationDidFrameFinishLoad()` - 프레임 로드 완료 시
   - `handleWatchPageReached()`에 위임만 함. **별도의 `play == false` 분기를 두지 않는 것이 중요**: 이 이벤트는 인터벌 생성 전(about:blank 로드 등)에도 발화할 수 있는데, 그 경로에서 모니터 시작 가드를 소비하면 이후 watch 도달 시 모니터가 시작되지 않아 앞 5% 점프와 정지/예고 처리가 조용히 누락됨. `play == false` 처리는 `handleWatchPageReached()`의 조기 반환이 담당

4. `OnWebViewTranslationDidNavigateInPage()` - in-page 내비게이션 시
   - 주소창 업데이트, `logNavigation`, `handleWatchPageReached()` 호출

**랜덤 동영상 클릭 경로**: RandomPlay() → 재생목록 로드 → play 버튼 클릭 인터벌 시작(play=true) → watch 페이지 도달 시 `handleWatchPageReached()`가 인터벌 정리 + 재생 모니터 시작 → 모니터가 최초 영상 종료 또는 라이브 예고를 감지 → 앞 5% 랜덤 클릭

**랜덤 동영상 클릭의 비자명한 동작** (`clickRandomFrontVideo`)
- 재생목록 앞쪽 `1/divisor` 구간에서만 랜덤 선택 (전체가 아닌 상위 항목 선호). 현재 호출은 모두 divisor 20 = 앞 5%
- CSS 클래스 `yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer` - YouTube 재생목록 사이드바 동영상 요소

**URL 검증 (OnTextBoxAddressKeyDown)**
- 검증 순서: 온전한 URI → `?` 검색 → IPv4 → TLD 검증 → DNS 비동기 질의(`TryAsURI`) + 동시에 구글 검색
- **비자명한 결정**: DNS 질의 결과 대기 중 사용자 체감 지연 방지를 위해 구글 검색을 동시 실행. `TryAsURI`는 await하지 않고 fire-and-forget으로 호출하며, 해석에 성공하면 나중에 구글 검색 결과 페이지를 덮어씀

`TryAsURI(url)`
- 알려진 TLD에 매치되지 않은 입력의 최종 폴백. 사내/커스텀 도메인일 수 있으므로 DNS로 실존 여부를 확인하고 성공 시 로드
- **`dns.promises.lookup()` 사용 (`dns.resolve()` 아님)**: 판정 기준이 "DNS에 등록됐는가"가 아니라 "webview가 실제로 열 수 있는가"이므로, 네임서버에 직접 질의하는 `resolve()` 대신 OS 리졸버를 거치는 `lookup()`을 써야 hosts 파일 항목도 매치됨
- `url.host`가 아닌 `url.hostname` 사용: `host`는 포트를 포함해 질의가 실패함
- 실패는 정상 흐름(단순 검색어였던 경우)이므로 `TryAsURI lookup failed` 로그만 남김

---

## 주요 타이밍

| 타이머 | 값 | 용도 |
|--------|------|------|
| 초기 시작 | 10ms | OnBodyLoad → RandomPlay 지연 호출 |
| 재생 버튼 클릭 | 1초 인터벌 | YouTube 재생 버튼 반복 탐색/클릭 |
| 재생 모니터 | 1초 인터벌 폴링 | watch 도달 ~ 다음 RandomPlay. 최초 영상 종료/라이브 예고 → 앞 5% 랜덤 클릭, 정지 판정, 미뤄둔 전환 |
| 재생 정지 판정 | 60초 | 영상 id/currentTime 무변화 시 채널 조기 전환 |
| topmost 재확보 | 1초 인터벌 (main.js) | PIP 중 비포커스 시 `win.moveTop()` |
| 재생목록 로테이션 | 1시간 (3,600,000ms) | 새 랜덤 재생목록으로 전환 (`waitForVideoEnd` 엔트리는 재생 중 영상 종료 후) |

---

## IPC 통신

| 채널 | 방향 | 용도 |
|------|------|------|
| `toggle-pip` | renderer → main | PIP ↔ 일반 모드 전환 |
| `window-minimize` | renderer → main | 윈도우 최소화 |
| `window-maximize` | renderer → main | 윈도우 최대화/복원 토글 |
| `window-close` | renderer → main | 윈도우 닫기 |
| `pip-changed` | main → renderer | PIP 모드 변경 알림 (boolean) |
