# audit-rotation

생성: 2026-08-04T05:02:16.243Z

## 요약

| 항목 | 값 |
|---|---:|
| 검사 문서 | 548 |
| 검사 쪽 | 7155 |
| 눕혀진 문서 | 33 |
| 눕혀진 쪽 | 804 |
| 렌더 캐시 삭제 | 11 |

## 왜 중요한가

- PDF 의 /Rotate 는 0 이고 내용만 눕혀져 있어 메타데이터로는 못 잡습니다.
- 눕힌 채 비전에 넣으면 모델이 읽기를 포기하고 **그럴듯한 내용을 지어냅니다.**
  확인된 사례: 실무실습 부교재 1쪽에서 목차·본문이 전부 창작됨(정답지와 3% 일치).
- 단어 상자의 세로/가로 비율로 감지합니다. 정상 0.02~0.17, 눕힌 쪽 0.9+.
- 텍스트 레이어가 없는 순수 스캔은 판정 불가라 프롬프트 지시가 받아냅니다.

## 과목별

| 과목 | 문서 | 쪽 |
|---|---:|---:|
| law | 15 | 388 |
| biochemistry | 5 | 178 |
| practice | 10 | 125 |
| preventive | 1 | 86 |
| pharmacology | 1 | 22 |
| pharmacognosy | 1 | 5 |

## 상위 문서

- 148쪽 · 270도 · biochemistry/workbook
- 135쪽 · 270도 · law/summary
- 86쪽 · 270도 · preventive/subtext
- 45쪽 · 270도 · law/summary
- 45쪽 · 270도 · law/summary
- 44쪽 · 270도 · law/summary
- 40쪽 · 270도 · practice/textbook
- 28쪽 · 270도 · law/summary
- 22쪽 · 270도 · pharmacology/subtext
- 19쪽 · 270도 · practice/textbook
- 19쪽 · 270도 · law/d-grade-list
- 19쪽 · 270도 · law/summary
- 19쪽 · 270도 · law/summary
- 17쪽 · 270도 · practice/subtext
- 15쪽 · 270도 · practice/subtext
- 14쪽 · 270도 · practice/subtext
- 13쪽 · 270도 · biochemistry/subtext
- 13쪽 · 270도 · law/summary
- 12쪽 · 270도 · biochemistry/subtext
- 9쪽 · 270도 · practice/subtext
