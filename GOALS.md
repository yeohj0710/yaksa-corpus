# GOALS — Codex 장기 실행 계획

세팅은 끝났습니다. 이 문서는 Codex 가 며칠에 걸쳐 이어서 돌릴 작업 큐입니다.
작업 규칙과 스키마는 [AGENTS.md](AGENTS.md), 파이프라인 설명은 [README.md](README.md)에 있습니다.

## 시작 전 확인

```bash
npm run status      # 어디까지 됐는지
npm run verify      # 게이트 전량
```

`.env` 에 `LLM_API_KEY`, `SOURCE_ROOT` 가 있어야 합니다.

## 항상 지키는 것

1. **단계를 동시에 돌리지 마세요.** 429 가 몰려 양쪽 다 재시도 한도를 넘깁니다.
   동시성은 `.env` 의 `CONCURRENCY` 하나로만 조절합니다.
2. **모든 단계는 재개 가능합니다.** 중간에 죽으면 같은 명령을 다시 치세요.
   캐시가 있는 쪽은 건너뛰고 빠진 쪽만 채웁니다. `--force` 는 정말 다시 만들 때만.
3. **게이트를 맞추려고 데이터를 고치지 마세요.** 실패는 실패로 보고합니다.
4. **줄인 범위는 명시합니다.** 상한을 걸었거나 표본만 처리했으면 리포트에 적습니다.

## G-A. L1 전량 전사 (가장 큼, 6,210쪽)

가장 오래 걸리는 작업입니다. 며칠 잡으세요.

```bash
node scripts/audit-rotation.mjs --purge
npm run g1
npm run g5
```

`audit-rotation` 을 **반드시 먼저** 돌립니다. 눕혀진 문서 33개 804쪽이 있고,
눕힌 채로 넣으면 모델이 글자를 못 읽고 **내용을 지어냅니다**(확인된 사례 있음).

과목 단위로 잘라서 돌리면 진행 상황을 보기 쉽습니다.

```bash
npm run g5 -- --subject law
npm run g5 -- --subject pharmacotherapy
```

완료 조건: `npm run verify` 의 쪽수 정합 통과, quarantine 신규 0.

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

`C:\dev\pharmacist-exam-study-room` 의 `materials.source_key` 와 이 저장소의
`source_key` 가 같은 형식(`<subjectKey>/<상대경로>`)입니다. 조인만 하면 붙습니다.

주의: 그 앱의 `db/schema.ts` 는 본문을 **일부러** 받지 않습니다
("materials deliberately stores metadata only"). L1·L2 를 앱 DB 에 넣는 건
그 설계를 바꾸는 결정이라 사람 승인을 받고 하세요.

## 손대지 말 것

- 원본 폴더(`$SOURCE_ROOT`)에 쓰기
- `l2/questions.jsonl` 손편집 — 2,450문항이 게이트를 전부 통과한 상태입니다.
  고칠 일이 있으면 해당 쪽 캐시를 지우고 `npm run g3` 를 다시 돌리세요
- `lib/config.mjs` 의 시험 배치 — 시행계획 PDF 와 안내문 15개로 검증된 값입니다
