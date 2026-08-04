/**
 * 회전 감사. 눕혀진 문서를 전수 조사합니다. LLM 을 쓰지 않습니다.
 *
 *   node scripts/audit-rotation.mjs
 *
 * 눕힌 채로 비전에 넣으면 모델이 글자를 못 읽고 **내용을 지어냅니다.**
 * 실제로 확인된 사례가 있어 전량 추출 전에 반드시 돌려야 합니다.
 * 감지된 문서는 렌더 캐시를 지워 다음 g1/g5 때 세워서 다시 굽게 합니다.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DIR, CONCURRENCY } from "../lib/config.mjs";
import { select, absPath, totalPages } from "../lib/manifest.mjs";
import { detectDocRotation } from "../lib/rotation.mjs";
import { runJobs, writeReport, writeJSON, arg } from "../lib/jobs.mjs";

const purge = !!arg("purge");
const rows = select({ routes: ["vision", "pdftotext"] }).filter((r) => (r.pages ?? 0) > 0);
console.log(`문서 ${rows.length}개 / ${totalPages(rows).toLocaleString()}쪽 검사`);

const found = [];
await runJobs({
  goal: "audit-rotation", concurrency: CONCURRENCY * 2,
  jobs: rows.map((r) => ({
    key: r.path,
    run: async () => {
      const deg = await detectDocRotation(absPath(r), r.pages);
      if (deg !== 0) found.push({ ...r, deg });
    },
  })),
});

found.sort((a, b) => b.pages - a.pages);
const pages = found.reduce((n, r) => n + r.pages, 0);
console.log(`\n눕혀진 문서 ${found.length}개 / ${pages.toLocaleString()}쪽`);

let purged = 0;
if (purge) {
  for (const r of found) {
    const d = path.join(DIR.render, r.content_sha);
    if (existsSync(d)) { rmSync(d, { recursive: true, force: true }); purged++; }
  }
  console.log(`렌더 캐시 ${purged}개 삭제 — 다음 실행 때 세워서 다시 굽습니다`);
}

writeJSON(path.join(DIR.data, "rotated.json"),
  found.map((r) => ({ source_key: r.source_key, sha: r.content_sha, pages: r.pages, deg: r.deg })));

const bySubj = new Map();
for (const r of found) {
  const v = bySubj.get(r.subject_key) ?? [0, 0];
  bySubj.set(r.subject_key, [v[0] + 1, v[1] + r.pages]);
}

writeReport("audit-rotation", {
  "요약": {
    "검사 문서": rows.length, "검사 쪽": totalPages(rows),
    "눕혀진 문서": found.length, "눕혀진 쪽": pages,
    "렌더 캐시 삭제": purged,
  },
  "왜 중요한가": [
    "- PDF 의 /Rotate 는 0 이고 내용만 눕혀져 있어 메타데이터로는 못 잡습니다.",
    "- 눕힌 채 비전에 넣으면 모델이 읽기를 포기하고 **그럴듯한 내용을 지어냅니다.**",
    "  확인된 사례: 실무실습 부교재 1쪽에서 목차·본문이 전부 창작됨(정답지와 3% 일치).",
    "- 단어 상자의 세로/가로 비율로 감지합니다. 정상 0.02~0.17, 눕힌 쪽 0.9+.",
    "- 텍스트 레이어가 없는 순수 스캔은 판정 불가라 프롬프트 지시가 받아냅니다.",
  ],
  "과목별": bySubj.size
    ? ["| 과목 | 문서 | 쪽 |", "|---|---:|---:|",
       ...[...bySubj].sort((a, b) => b[1][1] - a[1][1]).map(([k, [n, p]]) => `| ${k} | ${n} | ${p} |`)]
    : ["없음"],
  "상위 문서": found.slice(0, 20).map((r) => `- ${r.pages}쪽 · ${r.deg}도 · ${r.subject_key}/${r.material_type}`),
});
console.log(`목록: data/rotated.json`);
