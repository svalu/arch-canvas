# Arch Canvas

AWS 아키텍처 다이어그램을 노드 방식으로 그리고, 규칙에 어긋나면 이유를 알려주고, PNG/SVG 로 내보내는 도구. 1단계 프로토타입.
`dist/index.html` 하나를 브라우저에서 바로 열면 된다(오프라인, 외부 CDN 없음). EXE 포장은 덤.

## 구조

```
data/icons.json        tools/extract_icons.mjs 가 Icon Shelf index.html 에서 뽑은 아이콘 858개 + 그룹 종류 18개
data/rules.json        아키텍처 규칙 15개 (placement / edge / count, severity block|warn|info = 차단/경고/참고, message + explain)
templates/*.json       내장 템플릿 10개 (그래프 JSON + meta, 인프라 7 + 카드 모드 구성도 3: 솔루션 다크·라이트, Connect CV)
src/model/schema.js    그래프 JSON 스키마(arch-canvas/graph@1), normalize, 정렬
src/model/geometry.js  절대 좌표, 연결선 면 선택/경로(직선·직각·곡선), 그룹 안 빈 자리 — 캔버스/이미지/PPT 가 같이 씀
src/model/rules.js     규칙 평가기: lint(graph) / diffViolations / mergeRuleAnnotations(검수 핀)
src/model/patch.js     applyPatch(graph, ops) — 나중에 모델이 내보낼 명령 형식 (add_node, connect, move_into, annotate ...)
src/model/convert.js   그래프 <-> React Flow 노드/엣지
src/export/image.js    그래프 -> SVG 문자열 -> PNG(2배). 투명/흰 배경, 선택 영역, 클립보드 복사
src/export/scene.js    그래프 -> PowerPoint 장면(EMU). 1px = 11250 EMU, 아이콘 48px = 1.5cm  (EXE 전용)
src/App.jsx            React Flow 캔버스, 팔레트, 템플릿/내보내기 메뉴, 인스펙터, 검수 패널, 패치 패널
host/Program.cs        .NET 4.8 WinForms + WebView2 호스트. PptClipboard: 장면 -> Art::GVML ClipFormat(lockedCanvas)
tools/check_templates.mjs 템플릿 스키마·아이콘 키·규칙 위반 0 확인 + 규칙 자체 테스트 + applyPatch
tools/verify_ppt.ps1   PowerPoint COM 으로 붙여 넣어 도형 수/타입/크기/연결 상태 측정 (+PNG 내보내기)
tools/e2e_exe.mjs      EXE 를 실제로 띄워 원격 디버깅으로 템플릿→추가→연결→PPT 복사까지 돌리는 테스트
tools/e2e_png.mjs      EXE 에서 [PNG 복사] 를 실제 클릭해 클립보드에 이미지가 들어가는지 확인
```

## 규칙 (data/rules.json)

- `placement`: subject(icon/kind 정규식)가 `inside` 그룹 종류 안에 있으면 / `notInside` 안에 없으면 위반. "안에 있다"는 부모 사슬 또는 화면상 중심점 포함(겹쳐 그린 Auto Scaling 같은 경우).
- `edge`: source/target 아이콘, sourceInside/targetInside, sourceContainsTarget.
- `count`: scope 그룹 하나 안에 subject 가 max 개 초과.
- `severity: block`(차단)은 그 동작(드롭, 연결, 이동, 패치)을 되돌리고 빨간 토스트로 이유를, `warn`(경고)·`info`(참고)는 반영하되 토스트 + 노드 핀 + 상단 방패 [규칙 검사] 목록. 모든 규칙에 `explain`(왜 안 되는지) 필수.
- 추가는 JSON 에 항목만 넣으면 됨. `node tools/check_templates.mjs` 가 내장 템플릿이 규칙에 걸리지 않는지 확인.

## 빌드

```
npm install
npm run icons              # (아이콘 데이터 다시 뽑을 때만) Icon Shelf index.html 경로는 스크립트 안 기본값
npm run build              # dist/index.html (아이콘 데이터 내장, 단일 파일)
host\build.cmd             # release\Arch_Canvas_v0.4.x\Arch Canvas.exe (버전은 build.cmd 의 VER, VS 2022 Build Tools 의 csc)
```

개발: `npm run dev` → http://localhost:5178 (브라우저에서는 PPT 복사 대신 장면 JSON 저장).

## 검증

```
node tools/check_templates.mjs                                   # 템플릿 스키마/아이콘 키 + applyPatch 한 바퀴
node tools/graph_to_scene.mjs templates\02_three_tier_web.json _dev\scene.json
powershell -STA -File tools\verify_ppt.ps1 -Scene _dev\scene.json -Png _dev\out.png   # EXE --scene 모드로 복사 후 COM 측정
node tools/e2e_exe.mjs && node tools/graph_to_scene.mjs _dev\e2e_graph.json _dev\scene_e2e.json && powershell -STA -File tools\verify_ppt.ps1 -Scene _dev\scene_e2e.json -FromClipboard
```

테스트용 프레젠테이션은 창 없이 새로 만들고 저장하지 않고 닫는다. 열려 있는 다른 프레젠테이션은 건드리지 않는다.

## GVML 메모 (PowerPoint 가 받아주는 조건)

- 루트 `_rels/.rels` 의 Type 은 `.../relationships/drawing` (officeDocument 아님).
- drawing1.xml 은 `a:graphic > a:graphicData(lockedCanvas) > lc:lockedCanvas` 안에 `a:sp / a:pic / a:cxnSp` 를 나열. 순서가 z-순서.
- 그림은 `a:blip` 에 `r:embed` 없이 svgBlip 확장만 있어도 된다(PNG 대체 이미지 불필요).
- 연결선은 `a:stCxn/a:endCxn id=cNvPr id, idx=0 위 1 왼 2 아래 3 오른쪽`. COM 의 ConnectionSite 는 1부터.
- 세로로 꺾는 연결선은 bentConnector3 를 rot=5400000 으로 돌리고 상자 가로세로를 바꾼다. flipH = (dy<0), flipV = (dx>0).
- 아이콘 아래 라벨을 관통하지 않게, 아래 면으로 나가는 선은 라벨 글상자(`id#label`)에 붙인다.
- 텍스트는 `a:txSp > a:txBody ... a:useSpRect` (p:txBody 아님).

## 카드 모드 · 테마

그래프에 `mode: infra|card`, `theme: light|dark`. 카드 모드는 솔루션 구성도용: 노드 `type:'card'`(icon 선택, label=제목, body=설명, w/h, accent), 그룹 `kind:'section'`(+ 모든 그룹에 `color`/`line`/`fill` 덮어쓰기). 규칙 검사는 카드 모드에서 꺼지고 AI 검수는 "요건 커버리지" 관점으로 바뀜(`add_card` 패치 op). 이미지/PPT 내보내기 모두 테마·카드 반영(PPT 카드 = roundRect + 제목/설명 두 문단). 툴바 `[인프라|카드]`, `[라이트/다크]`. 템플릿 `08_solution_dark.json`.

## 둘러보기 (src/Tour.jsx)

처음 켰을 때 한 번(localStorage `arch-canvas:tour-done`) 화면 요소를 스포트라이트로 밝히며 12단계 설명. `?` 패널에서 다시 볼 수 있음. 대상은 CSS 선택자(`.tour-guide`, `.palette`, `.canvas`, `.settings`, `.tour-rules`, `.toolbar-ai`, `.tour-ai`, `.tour-export`, `.doctabs`, `.side`).

## 팔레트 추천 (data/suggest.json)

선택에 따라 팔레트 위에 "지금 넣을 만한 것"만 보여준다: 그룹 선택 → `inside[kind]`(그 안에 넣기, 클릭하면 빈 자리에), 아이콘 선택 → `nextTo`(정규식 매치, 클릭하면 오른쪽에 놓고 연결), 선택 없음 → `default`. 전체 목록은 [전체 목록 보기] 또는 검색. 항목은 icon key 또는 `group:<kind>`.

## 가이드 (src/guide/, data/guide.json)

빈 캔버스의 [가이드로 시작] 또는 상단 [가이드]. 순서: 뭘 만들지(웹/서버리스 API/정적/온프레미스) → 요건 체크(멀티 AZ·WAF·CDN·KMS·DR·예산) → 체크에 맞는 카드들(설명 + [넣기]/[건너뛰기], 각 카드는 미리 정의된 패치 명령을 적용) → 규칙 검사 → AI 검수(선택) → 내보내기. 단계·설명·명령은 `data/guide.json` 데이터라 카드 추가가 쉽다. 진행 상태는 localStorage 에 남아 닫았다 열어도 이어진다. 테스트 훅 `window.__arch.guide`.

## AI 검수 · 그리기 (src/ai/)

- `providers.js` 어댑터 하나(`ask({system,user}) → text`)에 세 경로: `claude-cli`(EXE 전용, 호스트가 `claude -p --output-format json` 실행, 사용자 구독), `claude-api`(Anthropic 공식 SDK 브라우저 모드, 기본 `claude-opus-5-5`, 안전 분류기 거부 시 서버 폴백 `fallbacks:"default"`), `openai-api`(Chat Completions). 숨은 `mock`(localStorage `arch-canvas:ai-mock=1`)은 네트워크 없이 UI 확인용.
- `connection.js` 설정(localStorage) + 키 저장(EXE: DPAPI `data\secrets\*.bin`, 브라우저: localStorage) + `verifyConnection`: 고정 문장("연결 확인용입니다…")에 실제 응답이 와야 "확인됨". 로그인/키 저장만으로는 성공 처리 안 함.
- `prompts.js` 제안서 컨텍스트(제목·요건서 MD·제약) + 그래프 요약(그룹 트리/노드/연결) + 자동 규칙 결과를 같이 보냄. 검수는 `{summary, findings[{target,level,message,explain}]}` → `ai-*` 핀, 그리기는 `{summary, ops[]}` → 미리보기 후 `applyPatch`(규칙 검사 포함).
- `ui.jsx` 연결 모달(방식 선택 → 설정 → 연결 확인 → 완료 4단계, 실패는 쉬운 문구 + '상세 보기', 늦게 온 결과 무시, 완료 후 하던 동작 이어가기) + AI 패널.
- 호스트 브리지 `window.desktop.call(method, params)`: `cli.detect`, `ai.run`, `ai.cancel`, `secret.get`, `secret.set`. CLI 는 `CLAUDE*` 환경변수를 지우고 띄워서 Claude Code 안에서 실행돼도 겹치지 않음.
- 테스트: `node tools/e2e_ai.mjs` (EXE + CLI 로 연결 확인 → 검수 → 그리기, 구독 사용량 조금 씀. CLI 가 로그인 안 돼 있으면 그 사실만 출력하고 끝).

## 내보내기

- Ctrl+C / [PNG 복사]: 그래프에서 직접 SVG 를 그려 2배 PNG 로 래스터화해 클립보드에(`navigator.clipboard.write`). 선택이 있으면 선택 영역만. 클립보드가 막힌 환경이면 PNG 파일로 대신 저장.
- [내보내기 ▾]: PNG 저장(2배), SVG 저장, 배경 투명/흰색.
- EXE 에서만: Ctrl+Shift+C 로 PowerPoint 편집 가능 도형(GVML).

## 다음 단계

- 2단계(자연어 → 패치 명령, AI 검수, AI 대화)는 v0.3.0 에 들어갔다. 위 "AI 검수 · 그리기" 참고.
- 남은 것: 규칙 늘리기(보안 그룹, 멀티 AZ 권장, NAT 라우팅 등), 자동 레이아웃, 템플릿 "추가(병합)" 모드.

## 배포와 업데이트

- 배포본: `release\Arch_Canvas_v<버전>.zip` (EXE + 사용안내.txt). GitHub Releases 에 같은 이름으로 올린다 (`gh release create v<버전> release\Arch_Canvas_v<버전>.zip`).
- 앱 안 업데이트: EXE 가 하루 한 번 `https://api.github.com/repos/svalu/arch-canvas/releases/latest` 를 보고, 새 버전이면 상단에 [새 버전] 칩을 띄운다.
  [지금 업데이트]를 누르면 zip 의 `Arch Canvas.exe` 를 `data\update\` 에 받아 두고, 앱이 끝난 뒤 배치가 바꿔치기한 다음 다시 시작한다.
  저장소가 비공개인 동안은 환경변수 `ARCH_CANVAS_GH_TOKEN` 이 있어야 확인·내려받기가 된다.
- 검증: `node tools/e2e_update.mjs <옛 EXE 복사본> <기대 버전>` (옛 EXE 를 임시 폴더에 복사해서 돌린다).
