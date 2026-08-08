# AGENTS.md — yaksa-corpus

약사 국가고시 자료를 AI가 쓸 수 있는 구조로 전처리하는 저장소입니다.
에이전트는 작업 전에 이 문서를 전부 읽습니다. 이 문서가 스키마와 금지사항의 유일한 기준입니다.

## 비용 원칙 (제일 먼저)

**에이전트는 API 키로 과금하지 않습니다.** 유료 호출은 기본 차단입니다.

전사는 에이전트가 직접 합니다. 스크립트는 할 일 목록과 검증만 맡습니다.

```bash
npm run agent:next -- --n 20   # 읽을 PNG·쓸 경로·전사 규칙을 받는다
npm run agent:check            # 쓴 것을 검증한다

npm run e:next -- --n 5        # 강조 복원(G-A2). 잉크맵·줄번호 본문을 받는다
npm run e:apply                # 지시서를 L1 에 반영한다
npm run e:check                # 강조 게이트
```

`lib/llm.mjs` 를 거치는 단계(g2·g3·g5·accuracy)는 `LLM_ENABLE=1` 없이는 즉시 멈춥니다.
**이 차단을 에이전트가 스스로 풀지 마세요.** 사람이 켭니다.

## 경계

| 대상 | 규칙 |
|---|---|
| `$SOURCE_ROOT` (.env 에 지정) | 원본. **읽기 전용.** 쓰기·이동·이름변경 전부 금지 |
| 저장소 루트 | 산출물. 여기에만 씁니다 |
| git 원격 | **코드만 공개.** 자료·추출물은 절대 커밋 금지 |

원본은 각 대학 정리본·국시원 기출입니다. 전부 저작물이라 재배포하지 않습니다.
원문 텍스트·이미지·추출 결과를 커밋하거나 지정된 모델 API 외부로 보내지 마세요.

`data/`, `render/`, `l1/`, `l2/`는 `.gitignore`에 넣고 스키마·스크립트·리포트만 추적합니다.
자료 폴더 경로도 코드에 넣지 않습니다. `.env`의 `SOURCE_ROOT`로만 받습니다.

커밋 전에 반드시 돌립니다.

```bash
npm run privacy-check
```

추적 파일에서 로컬 절대경로·개인정보·자격증명·학습자료 확장자·추출물 디렉터리를 검사합니다.

## 디렉터리

```
yaksa-corpus/
  AGENTS.md
  schema/            *.schema.json          커밋함
  scripts/           파이프라인              커밋함
  reports/           검증 리포트             커밋함
  data/manifest.json L0                     ignore
  data/emphasis-scan.jsonl 강조 픽셀 스캔    ignore
  data/l1-baseline.jsonl   본문 지문         ignore
  render/{sha}/{page}.png                   ignore
  render-ink/{sha}/p-NNNN.png 잉크맵         ignore
  l1/{sha}/{page}.md                        ignore
  emphasis/{sha}/p-NNNN.json 강조 지시서     ignore
  l2/questions.jsonl cards.jsonl guide.json ignore
```

## 재개 규칙 (제일 중요)

모든 단위 작업의 키는 `{content_sha}-{page:04d}`입니다.

1. 산출물 파일이 있고 `content_sha`가 manifest와 같으면 **건너뜁니다.**
2. 작업 하나가 실패하면 `reports/quarantine.jsonl`에 기록하고 다음으로 넘어갑니다. 전체를 멈추지 마세요.
3. 어떤 스크립트든 두 번 돌려서 같은 결과가 나와야 합니다.

이거 없이 5,383쪽을 돌리면 안 됩니다.

**단계를 동시에 돌리지 마세요.** G2 와 G3 를 같이 띄우면 429 가 몰려서 양쪽 다 재시도
한도를 넘깁니다. 한 번에 하나씩 돌리고, 끝나면 다음 단계로 넘어갑니다.
동시 실행 수는 `.env` 의 `CONCURRENCY` 하나로만 조절합니다.

## 추출 라우팅

manifest의 `extract_route`를 그대로 따릅니다. 임의로 바꾸지 마세요.

| route | 처리 |
|---|---|
| `pdftotext` | `pdftotext -enc UTF-8 -f N -l N` |
| `vision` | `pdftoppm -png -r 150` → 비전 모델 전사 |
| `direct-csv` | UTF-8 BOM, 멀티라인 따옴표 필드 있음 |
| `xls-ole2` | **OLE2입니다. `openpyxl` 쓰지 마세요.** `xlrd` 또는 LibreOffice 변환 |
| `audio-defer` | 지금 하지 않음 |
| `goodnotes-defer` | 지금 하지 않음 |

`is_primary == false`인 행은 처리하지 않습니다. 기출 PDF가 15개 과목 폴더에 중복 복사돼 있습니다.

## L1 전사 규칙

비전 모델에 주는 지시입니다.

**하는 것**
- 페이지에 보이는 내용을 그대로 마크다운으로 옮깁니다
- 표는 마크다운 표로
- 수식은 `$...$` LaTeX로
- 화학 구조식·그림·그래프는 `[FIGURE: 무엇이 그려져 있는지 한 줄]`로
- 강조는 아래 **L1 강조 표기** 대로 살립니다. 자료 만든 사람이 중요하다고 표시한 부분입니다
- 판독 불가는 `[UNREADABLE]`

**하지 않는 것**
- 요약, 압축, 문장 다듬기
- 틀려 보이는 내용 고치기 — 원문이 틀렸으면 틀린 채로 옮깁니다
- 안 보이는 내용 채우기
- 워터마크·페이지번호·머리말·꼬리말 옮기기

출력 앞에 프론트매터를 답니다.

```yaml
---
sha: a1b2c3d4e5f6a7b8
page: 12
source_key: pharmacology/1-3. 약물학/1. 주교재/1. 주교재_붙은껌 약물학(8037).pdf
subject_key: pharmacology
material_type: textbook
---
```

## L1 강조 표기

**이 코퍼스에서 제일 값어치 있는 층입니다.** 자료 만든 사람이 빨간 글씨·형광펜·밑줄로
칠해 둔 자리가 곧 "외울 것"입니다. 글자만 옮기고 강조를 버리면 평범한 텍스트 덤프가 됩니다.

| 표기 | 원본에서 |
|---|---|
| `**글자**` | 빨강·파랑·초록 같은 색 글씨, 굵은 글씨 |
| `<mark>글자</mark>` | 형광펜 |
| `<u>글자</u>` | 밑줄 |

겹쳐 씁니다: `<mark>**핵심**</mark>`.

`==글자==` 는 **쓰지 마세요.** 원문에 `[A] + [R] ========= [AR]` 처럼 등호가 그대로 들어간
쪽이 31쪽 있어서, 마커로 쓰면 본문과 구분이 안 됩니다.

강조를 어디까지 잡느냐는 이렇게 봅니다.

- **잡습니다** — 색 글씨, 형광펜, 밑줄, 굵은 글씨, 색 네모로 두른 낱말
- **안 잡습니다** — 제목·머리글이라서 원래 굵은 것, 표 머리행, 본문 전체가 같은 색인 자료,
  그림·구조식 안의 색(본문 글자가 아닙니다), 색 구분선과 배경 띠

한 쪽이 통째로 파란 글씨면 그건 강조가 아니라 그 자료의 본문 색입니다. 다 칠하지 마세요.

### 이미 전사한 쪽에 강조를 얹을 때 (G-A2)

**본문을 다시 쓰지 않습니다.** 지시서만 씁니다. 자세한 절차는 `GOALS.md` 의 G-A2 를 보세요.

```bash
npm run e:next -- --n 5   # 잉크맵·원본 PNG·줄번호 붙은 본문·쓸 경로
npm run e:apply           # 지시서를 L1 에 반영
npm run e:check           # 게이트
```

`data/l1-baseline.jsonl` 에 쪽마다 **마커를 벗겨낸 본문의 SHA-256** 이 박혀 있습니다.
강조를 붙이고 떼는 건 이 값을 안 바꾸고, 글자를 한 자라도 고치면 바뀝니다.
`e:apply` 가 매번 대조해서 다르면 그 쪽을 거부합니다. 지문을 다시 잡는 건 사람이 합니다.

## L2 스키마

### questions.jsonl

```json
{
  "id": "77-1-11",
  "exam_round": 77,
  "exam_year": 2026,
  "session": 1,
  "number": 11,
  "subject_key": "biochemistry",
  "stem": "아데닐산(adenylate) 생합성 과정의 일부이다. X는?",
  "stem_box": null,
  "options": [
    {"n": 1, "text": "글리신(glycine)"},
    {"n": 2, "text": "푸마르산(fumarate)"},
    {"n": 3, "text": "아스파르트산(aspartate)"},
    {"n": 4, "text": "글루탐산(glutamate)"},
    {"n": 5, "text": "글루타민(glutamine)"}
  ],
  "answer": 3,
  "figure_withheld": true,
  "source_sha": "…",
  "source_page": 3
}
```

- `options`는 **반드시 5개**입니다. 4개나 6개가 나오면 그 문항은 quarantine으로 보냅니다.
- `stem_box`는 지문에 네모 박스가 있을 때만 채웁니다.
- `figure_withheld`: 페이지에 `<자료(비공개)>`가 있으면 `true`. **그림을 추측해서 만들지 마세요.**
- `answer`는 전사에서 얻지 않습니다. `최종답안 (1~4교시).pdf`에서 따로 뽑아 조인합니다.

### cards.jsonl

```json
{"id":"pharmacotherapy-00001","subject_key":"pharmacotherapy","chapter":"심혈관","chapter_from":1,"chapter_to":8,"front":"고혈압 1차치료제","back":"Thiazide 이뇨제\nACEI or ARB\nCCB\n(BB는 JNC-8에서 제외)","source":"csv","source_key":"…","source_sha":"…"}
```

원본 CSV 는 따옴표 안에 줄바꿈이 들어 있습니다. `split("\n")` 으로 자르면 조용히 깨집니다.
`lib/csv.mjs` 의 상태기계를 쓰세요. 물리 줄 2,652개가 실제로는 레코드 542개입니다.

### guide.json

```json
{
  "subject_key": "pharmacology",
  "exam_questions": 20,
  "study_order": ["주교재(붙은껌)", "뽀로로로 보충", "부교재", "문제집"],
  "unit_priority": [
    {"unit":"자율신경계","rank":1},
    {"unit":"중추신경계","rank":2},
    {"unit":"순환기","rank":3},
    {"unit":"당뇨","rank":4},
    {"unit":"말초","rank":5}
  ],
  "notes": ["상위 5개 분야가 전체 출제의 60% 이상", "총론 아주 중요", "각 약물의 mechanism of action 필수"],
  "source_sha": "…"
}
```

## 검증

`scripts/verify.mjs`가 전부 통과해야 단계가 끝납니다. 통과 못 하면 리포트만 쓰고 종료합니다. 숫자를 맞추려고 데이터를 고치지 마세요.

| 검사 | 기준 |
|---|---|
| 문항 수 | 연도별 정확히 350, 합계 2,450. 교시별 100/90/77/83 |
| 선지 수 | 전 문항 정확히 5 |
| 정답 커버리지 | 100%. 하나라도 비면 실패 |
| 중복 문항 id | 0 |
| 과목 구간 | 원본 `00. 기출문제 안내.md` 15개와 일치 |
| 영역 교차검증 | 정답지 과목 칸에서 유도한 영역 == 번호 구간에서 유도한 영역 |
| 쪽수 정합 | L1 산출 쪽수 == manifest `pages` |
| 카드 수 | 542장. CSV 물리 줄 수(2,652)와 레코드 수는 다릅니다 |
| 전사 오차 | CLEAN 표본을 vision으로도 돌려 pdftotext와 문자 단위 비교. 리포트에 오차율 기록 |

마지막 항목이 핵심입니다. CLEAN 1,772쪽에는 정답지가 공짜로 있습니다. 여기서 나온 오차율이 나머지 5,383쪽의 신뢰도 추정치입니다. **이 수치 없이 "추출 완료"라고 보고하지 마세요.**

## 보고

단계가 끝나면 `reports/{goal}.md`에 씁니다.

- 처리한 파일·쪽 수
- 건너뛴 수와 이유
- quarantine 건수와 대표 사례 3개
- 검증 결과 표
- **줄인 범위**: 상한을 걸었거나 표본만 처리했으면 명시합니다. 조용히 자르지 마세요

## 금지

- 원본 폴더에 쓰기
- 공개 저장소 생성·푸시
- 원문 텍스트를 외부 서비스로 전송(지정된 모델 API 제외)
- 검증 실패를 통과로 보고
- `is_primary == false` 처리
- 그림·수치 창작
