/**
 * 현재 진행 상황. 어느 단계까지 됐는지 한 눈에 봅니다.
 *   node scripts/status.mjs
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DIR, EXAM_ROUNDS, SESSION_TOTAL, SUBJECTS, assertExamLayout, sessionRanges } from "../lib/config.mjs";
import { select, totalPages, loadManifest } from "../lib/manifest.mjs";
import { readJSONL, readJSON } from "../lib/jobs.mjs";

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log("── 시험 배치 ────────────────────────────────────");
try {
  assertExamLayout();
  for (const s of [1, 2, 3, 4]) {
    const r = sessionRanges(s);
    console.log(`  ${s}교시 ${num(SESSION_TOTAL[s], 3)}문항  ${r.map((x) => `${x.key}(${x.from}-${x.to})`).join(" ")}`);
  }
  console.log("  ✅ 합계 350 확인");
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}

console.log("\n── L0 인벤토리 ──────────────────────────────────");
let rows;
try { rows = loadManifest(); } catch (e) { console.log(`  ❌ ${e.message}`); process.exit(0); }
const prim = rows.filter((r) => r.is_primary);
console.log(`  자산 ${rows.length} → 중복제거 ${prim.length}`);
console.log(`  쪽   ${totalPages(rows).toLocaleString()} → 중복제거 ${totalPages(prim).toLocaleString()}`);

console.log("\n── 기출 세트 (가장 중요) ────────────────────────");
const papers = select({ type: "past-paper" });
const keys = select({ type: "past-paper-answer" });
console.log(`  문제지 ${papers.length}개 / 정답지 ${keys.length}개  (기대: 28 / 7)`);
const grid = new Map();
for (const p of papers) {
  const m = p.filename.match(/제(\d+)회\s*(\d)교시/);
  if (m) grid.set(`${m[1]}-${m[2]}`, p.pages);
}
for (const { round, year } of EXAM_ROUNDS) {
  const cells = [1, 2, 3, 4].map((s) => {
    const v = grid.get(`${round}-${s}`);
    return v ? num(`${s}교시:${v}p`, 10) : num(`${s}교시:없음`, 10);
  });
  console.log(`  ${year} 제${round}회  ${cells.join(" ")}`);
}
console.log(`  문제지 총 ${totalPages(papers)}쪽 + 정답지 ${totalPages(keys)}쪽`);

console.log("\n── 단계별 산출물 ────────────────────────────────");
const stages = [
  ["G1 렌더",   () => existsSync(DIR.render) ? readdirSync(DIR.render).length : 0, "문서",
   () => select({ route: "vision" }).length],
  ["G2 가이드", () => (readJSON(path.join(DIR.l2, "guide.json"), []) ?? []).length, "과목", () => 15],
  ["G3 기출",   () => readJSONL(path.join(DIR.l2, "questions.jsonl")).length, "문항", () => 2450],
  ["G4 카드",   () => readJSONL(path.join(DIR.l2, "cards.jsonl")).length, "카드", () => 542],
  ["G5 L1",     () => existsSync(DIR.l1) ? readdirSync(DIR.l1).length : 0, "문서",
   () => select({ routes: ["vision", "pdftotext"] }).length],
];
for (const [name, got, unit, want] of stages) {
  let g = 0, w = 0;
  try { g = got(); w = want(); } catch {}
  const mark = g === 0 ? "⬜" : g >= w ? "✅" : "🟨";
  console.log(`  ${mark} ${pad(name, 10)} ${num(g, 6)} / ${num(w, 6)} ${unit}`);
}

const q = path.join(DIR.reports, "quarantine.jsonl");
const qn = readJSONL(q).length;
console.log(`\n  quarantine: ${qn}건${qn ? `  (${path.relative(process.cwd(), q)})` : ""}`);
