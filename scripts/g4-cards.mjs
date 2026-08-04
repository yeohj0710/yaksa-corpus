/**
 * G4 — 플래시카드. 이미 만들어진 CSV 를 파싱만 합니다. LLM 을 쓰지 않습니다.
 *
 *   node scripts/g4-cards.mjs
 *
 * 산출: l2/cards.jsonl
 * 따옴표 안에 줄바꿈이 들어 있어서 split("\n") 으로 자르면 조용히 깨집니다.
 * lib/csv.mjs 의 상태기계를 씁니다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { select, absPath } from "../lib/manifest.mjs";
import { parseCSV } from "../lib/csv.mjs";
import { writeJSONL, writeReport, ensureDir } from "../lib/jobs.mjs";

const rows = select({ type: "flashcard-csv" });
console.log(`CSV ${rows.length}개`);

const cards = [];
const perFile = [];
let dropped = 0;

for (const r of rows) {
  // 01to08_약치심혈관 플래시카드 굿노트용.csv → chapters 01-08, 단원 "심혈관"
  const m = r.filename.match(/^(\d+)to(\d+)_(?:약치)?([^_\s]+)/);
  const chapter = m ? m[3] : path.parse(r.filename).name;
  const chapterFrom = m ? Number(m[1]) : null;
  const chapterTo = m ? Number(m[2]) : null;

  const parsed = parseCSV(readFileSync(absPath(r), "utf8"));
  let kept = 0;
  for (const [front, back] of parsed) {
    const f = (front ?? "").trim();
    const b = (back ?? "").trim();
    if (!f || !b) { dropped++; continue; }
    cards.push({
      id: `${r.subject_key}-${String(cards.length + 1).padStart(5, "0")}`,
      subject_key: r.subject_key,
      chapter, chapter_from: chapterFrom, chapter_to: chapterTo,
      front: f, back: b,
      source: "csv", source_key: r.source_key, source_sha: r.content_sha,
    });
    kept++;
  }
  perFile.push(`| ${chapter} | ${parsed.length} | ${kept} |`);
}

ensureDir(DIR.l2);
writeJSONL(path.join(DIR.l2, "cards.jsonl"), cards);

const empty = cards.filter((c) => !c.front || !c.back).length;
writeReport("g4-cards", {
  "요약": { "CSV 파일": rows.length, "카드": cards.length, "빈 행 제외": dropped, "빈 front/back": empty },
  "파일별": ["| 단원 | 원본 행 | 카드 |", "|---|---:|---:|", ...perFile],
  "게이트": [`| 검사 | 결과 |`, `|---|---|`,
    `| 빈 front/back | ${empty ? `❌ ${empty}` : "✅ 0"} |`,
    `| 카드 수 | ${cards.length} |`],
});

console.log(`카드 ${cards.length}장 (빈 행 ${dropped} 제외)`);
console.log(`→ ${path.join(DIR.l2, "cards.jsonl")}`);
if (empty) process.exit(1);
