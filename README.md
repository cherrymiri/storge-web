# STORGE — 가족의 사랑 · When Love Responds

졸업작품 〈When Love Responds, 사랑의 응답〉의 네 번째 사랑 **STORGE** 인터랙티브 3D 웹입니다.
현재는 **01 시작 장면**만 구현되어 있습니다(1단계 테스트 버전).

## 실행 방법

```bash
npm install
npm run dev        # 개발 서버 → http://localhost:5173
npm run build      # 배포용 빌드 → dist/
npm run preview    # 빌드 결과 확인 → http://localhost:4173
```

같은 와이파이에 있는 휴대폰에서 확인하려면 `npm run dev` 실행 후 터미널에 나오는
`Network: http://192.168.x.x:5173` 주소로 접속하세요.

## 배포 (GitHub → Vercel)

1. 이 폴더를 GitHub 저장소로 올립니다 (`node_modules`, `dist`는 .gitignore로 제외됨).
2. Vercel에서 저장소를 Import하면 Vite 프로젝트로 자동 인식됩니다.
   - Build Command: `npm run build` / Output Directory: `dist`

## 조작

- **PC**: 3D 화면 위에서 **마우스 휠을 아래로 굴리면** 태엽이 감깁니다. 휠을 굴린 양만큼 왼쪽 크랭크가 부드럽게 돌고, 멈추면 자연스럽게 섭니다.
  - 휠을 반대로 굴려도 진행도는 늘지 않습니다(작은 유격만큼 뒤로 갔다가 돌아옴). 뒤로 굴린 양은 최대 90°까지 기억해, 앞뒤로 흔들어 진행도를 올릴 수 없습니다.
  - 휠로는 페이지가 스크롤되거나 화면이 확대되지 않습니다. Ctrl+휠·트랙패드 확대 제스처는 태엽을 감지 않습니다. 음량 조절 위에서 굴린 휠도 태엽을 감지 않습니다.
  - 마우스 왼쪽 버튼 드래그로 돌리는 방식은 없앴습니다.
- **모바일**: 3D 화면을 손가락으로 **위로 밀면** 태엽이 감깁니다. 민 거리에 비례해 돌고, 손을 떼면 멈춥니다.
- **키보드**: `→` 또는 `D` 키 (접근성·전시용)
- **소리**: 브라우저 정책상 소리는 클릭·키·터치 같은 동작이 한 번 있어야 켜집니다(휠만으로는 켜지지 않음).
  휠만 쓰는 관람객에게는 스피커 버튼 옆에 "화면을 한 번 클릭하면 소리가 함께 들려요"가 조용히 나타납니다.
  전시용 PC에서는 크롬을 `--autoplay-policy=no-user-gesture-required` 옵션으로 실행하면 처음부터 소리가 납니다.

## 02–04 장면 (사랑의 확장 · 애증과 충돌 · 서툰 회복)

상태: `INTRO → LOVE_EXPANDING → TENSION → BROKEN → REPAIRING → REPAIRED` (`src/scenes/SceneStorge.js`)

| 상태 | 화면 문구 | 가능한 조작 |
|---|---|---|
| INTRO | 태엽을 감아 가족의 사랑을 들려주세요. | 휠 / 위로 밀기 |
| LOVE_EXPANDING | 사랑이 가득 차오르고 있어요. | 휠 / 위로 밀기 |
| TENSION (선율 완성 후) | 사랑이 가득 차오르고 있어요. | 휠 / 위로 밀기 — 실이 팽팽해지고 미세하게 떨림 |
| BROKEN | 사랑과 미움이 뒤엉켜, 선율이 깨졌어요. | 없음 (음악 정지, 정적) |
| REPAIRING | 깨진 선율을 다시 이어주세요. | 조각 드래그만 (태엽 비활성) |
| REPAIRED | (잠시 후 문구가 사라짐) | 없음 — 각진 새 선율 유지 |
| CHANGED (05) | 멜로디가 바뀐 나, 가족들은 날 기억할까요? → (하단) 태엽을 다시 감아보세요. | 휠 / 위로 밀기 — 달라진 멜로디를 한 음씩 직접 연주 |
| ANSWERED (06) | 그럼, 다시 외우면 되지. / Then I'll learn it again. | 다시 감기 버튼 |

- 선율 완성 후 `story.tensionTurns`(2.5)바퀴를 더 감으면 깨집니다. 감을수록 곡선이 최대 60% 펴지고(`story.tautMax`), 떨림이 커지고 빨라지며(`tremorMax`, `tremorHzMax`), 한계에서 0.35초 멈칫한 뒤(`snapHoldSec`) 깨집니다.
- 조각은 깨지는 순간의 곡선을 그대로 잘라 만든 5개(첫 조각은 오르골에 고정)이며, 두께·끝막음·빛은 원래 선율과 같습니다.
- 2→5번 순서대로만 붙습니다. 순서가 아닌 조각을 열린 끝에 놓으면 원래 자리로 돌아갑니다.
- 붙은 조각은 이음새에서 각(`story.kinkDeg`)이 생기고, 이음새부터 서서히 각진 형태(`story.jitter`)로 바뀝니다.
- 관련 파일: `src/objects/MelodyFragments.js`(조각·파편·스냅·변형), `src/interaction/FragmentDrag.js`(드래그), `src/audio/AudioEngine.js`(`stopMusic`, `playShatter`)
- 테스트: `tests/e2e-story.mjs`(02–04, 64개), `tests/e2e-v3.mjs`(01, 44개)

## 05–06 장면 (달라진 나 · 사랑의 응답) — 끝까지 직접 연주

상태: `… → REPAIRED → CHANGED(05) → ANSWERED(06)`. **자동 재생 없음, 연주를 멈추게 하는 타이머 없음.**

| 시점 (이야기 시계) | 일어나는 일 |
|---|---|
| 마지막 조각을 놓음 | 0.36초에 붙고, 0.9초 동안 각지게 변형(마지막 조각만 1.5초 → 0.9초) |
| 각진 선율 완성 +0.4초 | 질문 "멜로디가 바뀐 나, 가족들은 날 기억할까요?" (복원 안내 자리를 이어받음, 0.8초 페이드인) |
| 질문 +0.3초 | 하단 "태엽을 다시 감아보세요." — 바로 감을 수 있음. 질문은 그대로 유지 |
| 감는 동안 | 감은 만큼만 달라진 멜로디가 한 음씩(1바퀴 = 4박). 12음(12박)을 다 치면 처음부터 반복 — 마지막 2분음표는 2박을 다 채운 뒤 반복. 멈추면 멈춤 |
| 15번째 음(한 악구 + 다음 반복의 "미 솔 도") | 질문이 0.4초에 사라지고, 0.15초 뒤 작은 빛이 각진 선율을 따라 한 번 흐름(0.9초). 그 빛에서 금빛·살구빛 입자가 풀려나와 바람에 실려 모이며 **06** "그럼, 다시 외우면 되지."를 이룸(1.4초) — 연주는 계속됨 |
| 문장 완성 +0.4초 / +1.6초 | 영어 문장 / "다시 감기" 버튼 |
| 06 이후 | 계속 감아 연주 가능(악보·선율 위 빛도 계속 따라감), 응답은 유지 |

- 06 응답 글씨: Pretendard Medium(500), `#F4BDA9` 살구빛·로즈 샴페인, 글자 글로우 없음, 안내 문구의 1.32배(PC 34px / 휴대폰 21px). 영어는 절반 크기 Light 베이지. 구별은 입자 등장·색·자리·타이밍으로.
- 입자: `src/ui/AnswerParticles.js` — 2D 캔버스 1장(입력 통과), 실제 문장 글자 모양에서 목표점을 뽑아 PC 950개 / 휴대폰 520개. 마지막엔 선명한 HTML 글자만 남고 캔버스는 비워짐. 움직임 줄이기 설정이면 입자 없이 0.6초 페이드인.
- 응답 위치: 선율·빛 번짐·오르골·타이틀·악보·버튼·볼륨을 피한 빈 공간 중 화면 가운데에 가까운 곳. 자리가 없으면 먼저 "그럼," 뒤에서 줄바꿈하고, 그래도 없을 때만 글씨를 줄이되 안내 문구의 1.2배(최소 21px) 아래로는 줄이지 않음.
- 시점·빛 세기·연주 속도·응답 시점(15번째 음): `src/config.js`의 `ending`
- 크랭크 연주: `src/audio/CrankMelody.js` (타이머 없음, 박 위치 → 지난 음만 한 번씩 순서대로, 12박마다 반복)
- 04 연결음: 조각 2·3·4·5가 붙을 때 솔·라·시·도(마지막은 화음) — `story.connectTones`. 이음새가 짧게 빛남.

## 하단 악보 (`src/ui/Score.js`)

- 재생과 같은 데이터(`noteEvents`, `src/audio/melodyTools.js`)로 그립니다. 음 높이 → 오선 위 위치, 길이 → 음표 종류(4분·8분·빔·점4분·2분·4분쉼표)와 가로 간격(박에 비례).
- 멜로디(윗선율)만 표기하고, 오르골 악보 관례대로 실제 소리보다 한 옥타브 낮게 적었습니다(오선 안에 들어오도록). 레퍼런스처럼 음자리표는 생략.
- 01~02: 원래 곡 4마디씩(1~4 / 5~8마디). 울린 음은 금빛, 지금 음은 은은한 빛, 아직 안 울린 음은 어둡게.
- 03: 하이라이트가 서서히 사라지고 악보가 살짝 흐려짐. 04: 조용히 유지.
- 05~06: 같은 오선에 원래 1~4마디(회색·베이지, 기둥 아래)와 달라진 악구(금빛, 기둥 위). 같은 음은 겹치고, 다른 음은 높이가, 다른 리듬은 위치·음표 종류가 달라집니다. 반복할 때마다 하이라이트가 첫 음으로 돌아가고, 지난 반복의 음표는 은은한 금빛으로 남습니다(음표를 새로 만들지 않음).
- 터치·클릭을 받지 않음(`pointer-events: none`) — 악보 위에서 밀어도 태엽이 감깁니다.

## "다시 감기"

태엽·진행도·선율·긴장·조각·연결·각진 선율·두 멜로디의 진행·악보 하이라이트·문구·엔딩·입력·빛을 모두 처음으로 되돌립니다(새로고침 없음).

## 테스트

- `tests/e2e-score.mjs` — 01~06 전체(악보 포함), PC·모바일 세로·모바일 가로, 실제 휠·스와이프·드래그·버튼
- `tests/e2e-story.mjs`(02–04), `tests/e2e-v3.mjs`(01) — 이전 단계 상세 테스트
- `tests/e2e-full.mjs` — 이전 자동 재생 엔딩용(현재 구조와 맞지 않아 사용 안 함)

## 폴더 구조

```
public/models/STORGE_MusicBox.glb   검증 완료된 오르골 모델 (수정하지 않음)
src/
  config.js                         모든 수치(구도, 감는 바퀴 수, 선율 색/두께 …)
  main.js                           부팅, 렌더 루프, 디버그 훅
  core/EventBus.js                  모듈 간 이벤트
  stage/Stage.js                    렌더러 · RoomEnvironment · AgX · 따뜻한 조명
  stage/CameraRig.js                화면 크기에 맞춘 자동 구도 (글자와 겹치지 않게)
  stage/Floor.js                    은은한 바닥 반사
  objects/MusicBox.js               GLB 로드, Crank_RotationPivot 회전
  objects/MelodyLine.js             3D 선율 (TubeGeometry + 둥근 끝 마감)
  interaction/CrankInteraction.js   드래그/터치 → 크랭크 회전, 역방향 방지(래칫)
  audio/AudioEngine.js              Web Audio 오르골 음색 신디사이저
  audio/melodies/storgeTheme.js     ★ 멜로디 데이터 (여기만 고치면 곡이 바뀜)
  audio/melodyTools.js              음정 변환/변주용 도구
  scenes/SceneManager.js            6개 장면 전환 구조
  scenes/Scene01Start.js            01 시작 장면
  ui/Overlay.js, ui/styles.css      문구, 안내, 소리 버튼
tests/e2e-v3.mjs                    실제 크롬에서 휠·터치 자동 테스트 (44개 항목)
```

## 자주 바꿀 값 (`src/config.js`)

| 값 | 의미 |
|---|---|
| `winding.turnsToFull` | 선율이 끝까지 그려지는 데 필요한 바퀴 수 (기본 6) |
| `winding.backlashDeg` | 손잡이를 뒤로 당길 수 있는 여유 각도 |
| `winding.wheelRadPerPx` | 휠 감도 (휠 한 칸 ≈ 100px ≈ 34°) |
| `winding.touchRadPerPx` | 모바일 스와이프 감도 (≈ 350px당 한 바퀴) |
| `winding.inputSmoothing` | 회전 보간 속도 (클수록 즉각적, 작을수록 부드러움) |
| `melody.curveAmplitude` | 선율 물결 높이 배율 (현재 1.35) |
| `melody.radius` | 선율 굵기 (빛 번짐과 무관하게 이 굵기가 유지됨) |
| `melody.emissiveIntensity` | 선율 실 자체의 밝기 |
| `melody.bloomColor` | 실 주변으로 퍼지는 빛의 색 (기본: 주황) |
| `melody.reflectionGain` | 바닥에 비친 선율의 밝기 (낮을수록 두 줄처럼 보이지 않음) |
| `glow.strength` | 빛 번짐 세기 (0이면 번짐 없음) |
| `glow.levels` | 번짐 퍼짐 정도 — 앞쪽 값은 실 가까이, 뒤쪽 값은 넓게 퍼지는 빛 |
| `glow.enabled` | 빛 번짐 켜기/끄기 |
| `camera.azimuthDeg` | 오르골을 바라보는 각도 |

## 선율의 빛 (선택적 Bloom)

`src/stage/Stage.js`에서 선율에만 Three.js `UnrealBloomPass`를 적용합니다.

1. 선율만 남기고(나머지는 검게) 블룸용 화면을 따로 그려 번짐을 계산합니다.
2. 실제 화면은 **바닥·반사 → 빛 번짐 → 오르골·선율** 순서로 그립니다.

그래서 빛은 실 **주변**에만 퍼지고, 실 자체의 굵기와 노란 앰버색, 오르골의 색·재질은 번짐 전과 똑같이 유지됩니다.
선율 곡선은 `src/objects/MelodyLine.js`의 `MelodyPaths`(PC: `horizontal`, 모바일 세로: `vertical`)에서 바꿀 수 있습니다.

## 멜로디 수정

`src/audio/melodies/storgeTheme.js`의 `steps` 배열을 바꾸면 됩니다.
손잡이를 한 바퀴 돌릴 때 `notesPerTurn`개 음이 연주되며, 관람객이 돌리는 속도가 곧 템포입니다.
`note: null`은 쉼표, `bass`는 함께 울리는 낮은 음입니다. 테스트용으로 새로 만든 곡입니다.

## 다음 단계를 위한 연결 지점

- `progress:full` 이벤트 (`Scene01Start.js`) — 과하게 감아 선율이 깨지는 연출을 붙일 곳
- `MelodyPaths` (`MelodyLine.js`) — 각진 선율 등 새로운 경로 추가
- `melodyTools.js`의 `transposeTheme`, `mapSteps` — 달라진 멜로디
- `SceneManager.register('02', …)` — 다음 장면 추가

## 디버그

주소 뒤에 `?debug`를 붙이면 `window.__storge`로 상태를 볼 수 있고,
콘솔에서 `__storge.orbit()`을 실행하면 카메라를 돌려 선율의 입체감을 확인할 수 있습니다.

## 배포와 업데이트 (GitHub → Vercel)

- 저장소: `cherrymiri/storge-web` · Vercel 프로젝트가 이 저장소에 연결되어 있으면 자동 배포됩니다.
- Vercel 설정은 `vercel.json`에 고정: Framework Vite, Build `npm run build`, Output `dist`.
- **Production**(공개 주소 그대로 유지): `main` 브랜치에 반영되면 자동으로 갱신.
- **Preview**(먼저 확인): `main`이 아닌 브랜치(예: `update-ending`)에 올리면 그 브랜치만의 미리보기 주소가 생깁니다. 확인 후 `main`에 합치면 Production에 반영.
- Claude에게 부탁할 때: "STORGE 고쳐서 미리보기 브랜치로 올려줘" → 확인 → "main에 반영해줘".
