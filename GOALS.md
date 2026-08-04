# GOALS — Codex 장기 실행 계획

세팅은 끝났습니다. 이 문서는 Codex 가 며칠에 걸쳐 이어서 돌릴 작업 큐입니다.
작업 규칙과 스키마는 [AGENTS.md](AGENTS.md), 파이프라인 설명은 [README.md](README.md)에 있습니다.

## 시작 전 확인

```bash
npm run status      # 어디까지 됐는지
npm run verify      # 게이트 전량
```

`.env` 에 `SOURCE_ROOT` 가 있어야 합니다. `LLM_API_KEY` 는 비워 둡니다(G-A 항목 참고).

## 항상 지키는 것

1. **단계를 동시에 돌리지 마세요.** 429 가 몰려 양쪽 다 재시도 한도를 넘깁니다.
   동시성은 `.env` 의 `CONCURRENCY` 하나로만 조절합니다.
2. **모든 단계는 재개 가능합니다.** 중간에 죽으면 같은 명령을 다시 치세요.
   캐시가 있는 쪽은 건너뛰고 빠진 쪽만 채웁니다. `--force` 는 정말 다시 만들 때만.
3. **게이트를 맞추려고 데이터를 고치지 마세요.** 실패는 실패로 보고합니다.
4. **줄인 범위는 명시합니다.** 상한을 걸었거나 표본만 처리했으면 리포트에 적습니다.

## G-A. L1 전량 전사 (가장 큼, 6,086쪽 남음)

> **2026-08-04 실행 방식 변경.** 아래 유료 파이프라인은 막아뒀습니다.
> 에이전트가 렌더 PNG 를 직접 읽고 `l1/*.md` 를 쓰는 방식으로 바뀌었습니다.
> `npm run run:all` 을 치지 마세요. 킬스위치에서 $0.00 으로 멈춥니다.

### 지금 방식 — 에이전트가 직접 전사

렌더 캐시가 로컬에 전부 있습니다(빠진 문서 0개). 그 PNG 를 읽고 결과를 파일로 씁니다.
유료 API 를 거치지 않아서 Codex 구독으로 커버됩니다.

읽기: `render/{content_sha}/p-N.png` — 자리수가 문서마다 다릅니다(`p-1.png`, `p-01.png`).
      하드코딩하지 말고 실제 목록을 읽으세요.
쓰기: `l1/{content_sha}/p-NNNN.md` — 항상 4자리 0패딩.

프론트매터는 `scripts/g5-l1.mjs` 의 `frontMatter()` 와 키·순서가 같아야 합니다.
값은 `data/manifest.json` 의 해당 행에서 가져옵니다
(`content_sha`, `pages`, `source_key`, `subject_key`, `material_type`).
전사 규칙은 `lib/prompts.mjs` 의 `TRANSCRIBE_SYSTEM`·`TRANSCRIBE_PROMPT` 를 그대로 따릅니다.
이미 만든 2,473쪽과 문체·표 표기가 어긋나면 코퍼스가 망가집니다.

과목 단위로 진행하고 한 과목 끝날 때마다 커밋하세요.
진행 기록은 `reports/l1-manual.md`.

눕혀진 문서 33개 804쪽이 있습니다. 이미지가 누워서 읽기 어려우면 **내용을 지어내지 마세요.**
확인된 환각 사례가 있습니다. 그 쪽은 건너뛰고 `reports/l1-manual.md` 에
`content_sha` 와 `page` 를 남기세요. 판독 불가도 마찬가지입니다.

완료 조건: `npm run verify` 의 쪽수 정합 통과, quarantine 신규 0.

### 옛 방식 — 유료 파이프라인 (차단됨)

`npm run run:all -- --limit-usd 30` 이 20단계를 돌리는 구조였습니다.
`scripts/run-all.mjs` → `scripts/g5-l1.mjs` → `lib/llm.mjs` → `api.openai.com` 경로라
**Codex 가 실행해도 OpenAI API 키에 그대로 청구됩니다.** 구독과 별개입니다.

2026-08-04 에 이 경로로 66분간 723콜 $2.13 이 나갔습니다. 그래서 막았습니다.

- `.env` 의 `LLM_API_KEY` 를 비웠습니다
- `lib/llm.mjs` 의 `assertKey()` 가 `LLM_ENABLE=1` 없이는 무조건 throw 합니다

**키를 채우거나 가드를 지워서 우회하지 마세요.** 안전장치입니다.
정말 유료로 돌려야 하면 먼저 사용자에게 예상 비용을 숫자로 제시하고 승인을 받으세요.
남은 6,086쪽 추정 $23 (밀집 도해 비중에 따라 ±50%).

### 중간 점검 (G-A 진행 중 주기적으로)

```bash
npm run accuracy -- --n 60
```

토큰 재현율이 **중앙값 85% 아래로 떨어지면 멈추고** `reports/accuracy.md` 의
'재현율 낮은 표본'을 눈으로 확인하세요. 원인은 대개 셋 중 하나입니다.

- 회전 미감지 (텍스트 레이어 없는 스캔) → 해당 문서만 수동으로 각도 지정
- 밀집 도해 → `lib/prompts.mjs` 의 D 항목 보강
- 정답지(pdftotext) 자체가 다단에서 뒤섞임 → 지표 문제. 눈으로 확인 후 넘어감

## G-B. 환각 표본 검사 (G-A 끝난 뒤 필수)

전사가 끝나면 **사람이 볼 표본**을 만듭니다. 자동 게이트로는 환각을 못 잡습니다.

과목마다 무작위 3쪽을 골라 원본 PNG 와 L1 마크다운을 나란히 놓은 HTML 을 만들고,
`reports/spotcheck/` 에 저장합니다. 45쪽을 사람이 넘겨보면 됩니다.

이 스크립트는 아직 없습니다. 만들어야 합니다.

## G-C. 스프레드시트 11개

전부 확장자만 `.xlsx` 이고 실제로는 OLE2(구형 `.xls`)입니다.
`openpyxl` 은 "File is not a zip file" 로 죽습니다. `xlrd` 나 LibreOffice 변환을 쓰세요.

- 약물치료학 플래시카드 7개 — `l2/cards.jsonl` 에 합칩니다(중복 제거 필요, CSV 판과 겹칩니다)
- 실무실습 DUR 다빈도의약품 필터 1개
- 합성학 랜덤 문제 생성기 2개 — 출발물질↔완성물질 쌍이 들어 있습니다
- 예방약학 말만들기 1개

## G-D. L2 지식 객체 확장

L1 이 쌓인 뒤에 합니다. 근거 없이 만들지 말고 반드시 L1 쪽을 출처로 답니다.

- `syllabus.json` — 과목 → 단원 → 소단원 트리.
  `l2/guide.json` 의 `unit_priority` 와 주교재 목차에서 뽑습니다. 다른 산출물의 조인 키가 됩니다.
- `drugs.jsonl` — 약물 ↔ 계열 ↔ 기전 ↔ 적응증 ↔ 부작용 ↔ 상호작용.
  약물학·약물치료학 L1 에서 뽑습니다. 필드마다 `source_sha`+`source_page` 필수.
- `cards.jsonl` 확장 — 현재 542장은 약물치료학뿐입니다.
  기출 오답 선지와 D등급 자료에서 과목별로 늘립니다.

`questions.jsonl` 에 `unit` 을 붙이면 약점 분석이 단원 단위로 가능해집니다.
`syllabus.json` 이 먼저 있어야 합니다.

## G-E. 오디오 199개 (4.5시간)

우선순위 낮습니다. 가사 PDF 가 같은 폴더에 대부분 있어서, 전사보다 PDF 를 L1 에 넣고
오디오를 링크로 다는 쪽이 쌉니다. 그래도 하려면 Whisper 로 돌리고
`material_type: mnemonic` 으로 L1 에 넣습니다.

## G-F. 굿노트 zip 6개

protobuf 인덱스 + 이미지 첨부입니다. 손글씨 카드라 비용 대비 가치가 낮습니다. 마지막에.

## G-G. 공부 사이트 연결

공부 관리 앱(`pharmacist-exam-study-room`) 의 `materials.source_key` 와 이 저장소의
`source_key` 가 같은 형식(`<subjectKey>/<상대경로>`)입니다. 조인만 하면 붙습니다.

주의: 그 앱의 `db/schema.ts` 는 본문을 **일부러** 받지 않습니다
("materials deliberately stores metadata only"). L1·L2 를 앱 DB 에 넣는 건
그 설계를 바꾸는 결정이라 사람 승인을 받고 하세요.

## 손대지 말 것

- 원본 폴더(`$SOURCE_ROOT`)에 쓰기
- `l2/questions.jsonl` 손편집 — 2,450문항이 게이트를 전부 통과한 상태입니다.
  고칠 일이 있으면 해당 쪽 캐시를 지우고 `npm run g3` 를 다시 돌리세요
- `lib/config.mjs` 의 시험 배치 — 시행계획 PDF 와 안내문 15개로 검증된 값입니다
