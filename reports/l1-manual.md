# L1 수동 전사

## 2026-08-04

| 과목 | 문서 | 처리 쪽 | 상태 |
|---|---|---:|---|
| pathophysiology | `8e8a006f6c7b78e9` | 1/1 | 완료 |

- 렌더 입력: `render/8e8a006f6c7b78e9/p-1.png`
- L1 출력: `l1/8e8a006f6c7b78e9/p-0001.md`
- 문서 방향: 정상 판독 가능
- 페이지 단위 판독 불가: 없음
- 워터마크로 일부 셀이 가려진 부분은 추측하지 않고 `[UNREADABLE]`로 남김
- 기존 vision 산출물 `l1/07d504ba2e316e3d/p-0001.md`와 프론트매터 키·순서, `C. 표` 분류, Markdown 표, `<br>` 셀 줄바꿈을 대조함

## 작업 큐

- `npm run l1:worklist`에서 기존 L1 파일이 없는 vision 페이지를 `(content_sha, page, subject_key)` JSONL로 출력함
- 2026-08-04 현재 미작성 목록: 5,448쪽
- pathophysiology 미작성 목록: 119쪽

## 레이아웃 라벨 정리

- `scripts/l1-strip-labels.mjs`의 기본 실행으로 대상 목록을 먼저 출력함
- 정확히 일치한 대상: 153건 (`C. 표` 74, `A. 흐르는 글 / 목록` 39, `B. 다단 조판` 38, 복합 라벨 2)
- `--apply` 실행 후 재검사: 첫 비어있지 않은 본문 줄의 대상 0건
- 본문 제목 `B. 공부방법 & TIP`은 대상 문자열이 아니므로 보존함

## 프론트매터 공백 정리

- `scripts/l1-normalize-blank.mjs --apply`로 프론트매터 직후 빈 줄 6건 제거
- 재검사 결과 대상 0건

## pathophysiology 진행

- 완료: `e7fa2477be5db8c4` 1쪽, `8e8a006f6c7b78e9` 1쪽, `21adb41fdbf303af` 12쪽, `28daf3d28a9376ce` 3쪽, `4c308ca701a62391` 26쪽
- `21adb41fdbf303af`는 정상 방향 문서이며 12쪽 전부 작성함. 일부 워터마크·소형 그림 안 판독 불가 부분만 `[UNREADABLE]`로 표시함.
- 현재 pathophysiology 미작성: 119쪽
