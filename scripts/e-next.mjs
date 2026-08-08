/**
 * G-A2 — 강조 복원 작업 받기. **API 를 쓰지 않습니다.**
 *
 *   npm run e:next                       다음 5쪽
 *   npm run e:next -- --n 8
 *   npm run e:next -- --subject law
 *   npm run e:next -- --tier b           색 없는 쪽 표본
 *   npm run e:next -- --no-body          본문은 빼고 경로만
 *
 * 왜 전사를 다시 하지 않는가
 *   글자는 이미 다 옮겨져 있습니다. 빠진 건 강조뿐입니다. 본문을 다시 쓰게 하면
 *   6,210쪽을 또 쓰는 데다, 밀집 다단에서 용어가 조용히 바뀌는 사고가 다시 납니다
 *   (뇌교수초용해 → 말초신경염, 폐렴 → 폐암). 그래서 본문은 얼려 두고
 *   "어느 줄의 어느 글자에 어떤 강조가 있었는지"만 받습니다.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { loadManifest } from "../lib/manifest.mjs";
import { readJSONL, arg } from "../lib/jobs.mjs";
import { splitFrontMatter, stripMarks, makeInkMap, countMarks } from "../lib/emphasis.mjs";
import { EMPH_DIR, markPath, SAMPLE_PER_DOC, sampleIdx } from "../lib/emphasis-paths.mjs";
import { pageOf } from "../lib/pdf.mjs";

const N = Number(arg("n", 5));
const tier = String(arg("tier", "a")).toLowerCase();
const onlySubject = arg("subject");
const onlyType = arg("material-type");
const showBody = !arg("no-body");
const SCAN = path.join(DIR.data, "emphasis-scan.jsonl");

if (!existsSync(SCAN)) {
  console.error("data/emphasis-scan.jsonl 이 없습니다. `npm run e:prep` → `npm run e:scan` 순으로 돌리세요.");
  process.exit(1);
}

const bySha = new Map();
for (const r of loadManifest()) if (r.is_primary) bySha.set(r.content_sha, r);

const ORDER = ["study-guide", "d-grade-list", "textbook", "summary", "subtext",
  "workbook", "study-aid", "mnemonic", "past-paper", "past-paper-answer", "errata", "etc"];
const ord = (t) => { const i = ORDER.indexOf(t); return i === -1 ? ORDER.length : i; };

const scan = readJSONL(SCAN).filter((r) => !r.err);
const byDoc = new Map();
for (const r of scan) {
  if (!byDoc.has(r.sha)) byDoc.set(r.sha, []);
  byDoc.get(r.sha).push(r);
}

const todo = [];
let pending = 0;
const docs = [...byDoc.entries()].sort((a, b) => {
  const ra = bySha.get(a[0]), rb = bySha.get(b[0]);
  if (!ra || !rb) return 0;
  return ra.subject_key.localeCompare(rb.subject_key) ||
    ord(ra.material_type) - ord(rb.material_type) ||
    a[0].localeCompare(b[0]);
});

for (const [sha, pagesRaw] of docs) {
  const row = bySha.get(sha);
  if (!row) continue;
  if (onlySubject && row.subject_key !== onlySubject) continue;
  if (onlyType && row.material_type !== onlyType) continue;
  const pages = [...pagesRaw].sort((a, b) => a.page - b.page);
  const forcedAll = existsSync(path.join(EMPH_DIR, sha, ".all"));
  const colored = pages.filter((p) => p.level !== "없음");
  const plain = pages.filter((p) => p.level === "없음");
  const target = tier === "a" ? colored
    : tier === "b" ? (forcedAll ? plain : sampleIdx(plain, SAMPLE_PER_DOC))
      : (forcedAll ? pages : [...colored, ...sampleIdx(plain, SAMPLE_PER_DOC)]);

  for (const p of target) {
    if (existsSync(markPath(sha, p.page))) continue;
    const md = path.join(DIR.l1, sha, `p-${String(p.page).padStart(4, "0")}.md`);
    if (!existsSync(md)) continue;
    pending++;
    if (todo.length < N) todo.push({ row, scan: p, md });
  }
}

if (!todo.length) {
  console.log(`tier ${tier.toUpperCase()} 에 남은 쪽이 없습니다. \`npm run e:apply\` 와 \`npm run e:check\` 를 돌리세요.`);
  process.exit(0);
}

console.log(`# 강조 복원 ${todo.length}쪽 (tier ${tier.toUpperCase()} 남은 전체 ${pending.toLocaleString()}쪽)`);
console.log(`# 본문은 고정입니다. 글자를 고치지 말고 강조 위치만 적으세요.\n`);

for (const t of todo) {
  const { row, scan: s, md } = t;
  const sha = row.content_sha;
  const pngDir = path.join(DIR.render, sha);
  const png = existsSync(pngDir)
    ? readdirSync(pngDir).map((f) => [pageOf(f), f]).find(([p]) => p === s.page)?.[1]
    : null;
  const pngPath = png ? path.join(pngDir, png) : null;
  let ink = null;
  if (pngPath && s.level !== "없음") {
    try { ink = makeInkMap(pngPath, sha, s.page); } catch { ink = null; }
  }

  const raw = readFileSync(md, "utf8");
  const { body } = splitFrontMatter(raw);
  const base = stripMarks(body);
  const had = countMarks(body);

  console.log(`### ${row.subject_key} / ${row.material_type} — ${sha} ${s.page}/${row.pages}쪽  [${s.level}]`);
  if (ink) console.log(`잉크맵(먼저 보세요): ${ink}`);
  if (pngPath) console.log(`원본:               ${pngPath}`);
  console.log(`본문:               ${md}`);
  console.log(`쓰기:               ${markPath(sha, s.page)}`);
  console.log(`탐지: 색획 ${s.inkPx}px / 색덩이 ${s.nInk}개 ${JSON.stringify(s.hues ?? {})} · 형광 ${s.hlPx}px ${s.nHl}덩이 · 밑줄후보 ${s.nRule}`);
  if (had.color + had.hl + had.underline) {
    console.log(`이미 있는 마커: 색 ${had.color} · 형광 ${had.hl} · 밑줄 ${had.underline} → 벗겨낸 뒤 다시 지정합니다. 살릴 건 다시 적으세요`);
  }

  if (showBody) {
    console.log(`--- 본문 (줄번호는 이 목록 기준. 마커는 벗겨낸 상태) ---`);
    const lines = base.split("\n");
    for (let i = 0; i < lines.length; i++) {
      console.log(`${String(i + 1).padStart(3)}| ${lines[i]}`);
    }
    console.log(`--- 끝 (${lines.length}줄) ---`);
  }
  console.log("");
}

console.log(`## 쓰는 형식  emphasis/{sha}/p-NNNN.json`);
console.log("```json");
console.log(JSON.stringify({
  sha: "d2d44d029fbd51fa", page: 10,
  marks: [
    { line: 12, text: "출발", type: "color" },
    { line: 14, text: "리간드", type: "hl" },
    { line: 20, text: "T세포의 활성화를 종료", type: "underline" },
  ],
}, null, 1));
console.log("```");
console.log(`붙일 게 없으면 marks 를 비우고 none 에 이유를 적습니다. 파일은 건드리지 않습니다.`);
console.log(`  none: "no-emphasis"     강조가 정말 없는 쪽`);
console.log(`  none: "figure-only"     색이 그림·구조식 안에만 있고 본문 글자에는 없음`);
console.log(`  none: "header-only"     색이 표 머리행·제목 띠에만 있음 (강조가 아닙니다)`);
console.log(`  none: "whole-page-color" 본문 전체가 한 색인 자료 (그 자료의 본문 색입니다)`);
console.log(`  none: "not-in-text"     강조된 글자가 [FIGURE] 로 대체돼 본문에 없음`);
console.log(`  none: "already-marked"  이미 붙어 있는 마커가 맞아서 그대로 둠`);
console.log(`기존 마커를 전부 걷어내려면 marks 를 비우고 "clear": true 를 같이 줍니다.`);
console.log(`\n다 쓴 뒤: npm run e:apply  →  npm run e:check`);
