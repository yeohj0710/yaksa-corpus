/**
 * G-A2 1단계 — 강조 흔적 스캔. **API 를 쓰지 않습니다.**
 *
 *   npm run e:scan              캐시에 없는 쪽만 스캔
 *   npm run e:scan -- --force   전부 다시
 *
 * 렌더 PNG 를 열어 색 잉크·형광펜 픽셀을 셉니다. 결과는 data/emphasis-scan.jsonl 에
 * 쌓이고, 이 파일이 이후 모든 단계의 대상 목록이자 게이트의 근거가 됩니다.
 *
 * 왜 사람 눈이 아니라 픽셀인가
 *   "강조를 옮겼습니다"는 말로는 검증이 안 됩니다. 색이 있는 쪽인데 마커가 0개면
 *   기계가 바로 잡아냅니다. G-A 에서 게이트가 전부 초록인 채로 강조가 통째로
 *   빠졌던 게 이 장치가 없어서였습니다.
 */
import { existsSync, readdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { loadManifest } from "../lib/manifest.mjs";
import { readPNG } from "../lib/png.mjs";
import { detectEmphasis } from "../lib/emphasis.mjs";
import { ensureDir, readJSONL, writeReport, arg } from "../lib/jobs.mjs";
import { pageOf } from "../lib/pdf.mjs";

const force = !!arg("force");
const onlySubject = arg("subject");
const SCAN = path.join(DIR.data, "emphasis-scan.jsonl");

const bySha = new Map();
for (const r of loadManifest()) if (r.is_primary) bySha.set(r.content_sha, r);

const done = new Map();
if (!force) for (const r of readJSONL(SCAN)) done.set(`${r.sha}-${r.page}`, r);

ensureDir(DIR.data);
if (force && existsSync(SCAN)) writeFileSync(SCAN, "", "utf8");

const rows = [];
let scanned = 0, skipped = 0, failed = 0;

for (const sha of readdirSync(DIR.render)) {
  const dir = path.join(DIR.render, sha);
  const r = bySha.get(sha);
  if (!r) continue;
  if (onlySubject && r.subject_key !== onlySubject) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".png")) continue;
    const page = pageOf(f);
    if (page == null) continue;
    const key = `${sha}-${page}`;
    if (done.has(key)) { rows.push(done.get(key)); skipped++; continue; }
    let rec;
    try {
      const d = detectEmphasis(readPNG(path.join(dir, f)));
      rec = {
        sha, page, png: f,
        subject: r.subject_key, mt: r.material_type, route: r.extract_route,
        inkPx: d.inkPx, hlPx: d.hlPx, darkPx: d.darkPx,
        nInk: d.inkBoxes.length, nHl: d.hlBoxes.length, nRule: d.ruleHints.length,
        textInk: d.textInk, textHl: d.textHl,
        hues: d.inkBoxes.slice(0, 40).reduce((a, b) => (a[b.hue] = (a[b.hue] || 0) + b.px, a), {}),
        level: d.level,
      };
    } catch (e) {
      rec = { sha, page, png: f, subject: r.subject_key, mt: r.material_type, err: String(e.message).slice(0, 120), level: "오류" };
      failed++;
    }
    appendFileSync(SCAN, JSON.stringify(rec) + "\n", "utf8");
    rows.push(rec);
    if (++scanned % 200 === 0) process.stdout.write(`\r  스캔 ${scanned}쪽   `);
  }
}
process.stdout.write(`\r  스캔 ${scanned}쪽 · 캐시 ${skipped}쪽 · 오류 ${failed}\n`);

// --- 집계 -------------------------------------------------------------------
const byLevel = {};
for (const r of rows) byLevel[r.level] = (byLevel[r.level] || 0) + 1;

let missing = 0, both = 0, markedNoColor = 0, noL1 = 0;
const bySubject = new Map();
for (const r of rows) {
  const md = path.join(DIR.l1, r.sha, `p-${String(r.page).padStart(4, "0")}.md`);
  if (!existsSync(md)) { noL1++; continue; }
  const hasMark = /\*\*[^*\n]+\*\*|<mark>|<u>/.test(readFileSync(md, "utf8"));
  const colored = r.level === "강" || r.level === "약";
  if (colored && !hasMark) {
    missing++;
    const k = `${r.subject}/${r.mt}`;
    bySubject.set(k, (bySubject.get(k) || 0) + 1);
  } else if (colored && hasMark) both++;
  else if (!colored && hasMark) markedNoColor++;
}

console.log(`\n등급별  ${Object.entries(byLevel).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`색강조 O + L1 마커 X (복원 대상) ${missing.toLocaleString()}쪽`);
console.log(`색강조 O + L1 마커 O             ${both.toLocaleString()}쪽`);
console.log(`색강조 X + L1 마커 O             ${markedNoColor.toLocaleString()}쪽`);
if (noL1) console.log(`L1 없는 렌더 쪽                  ${noL1}쪽`);

writeReport("e-scan", {
  "요약": {
    "스캔한 쪽": rows.length, "이번에 새로": scanned, "오류": failed,
    "강": byLevel["강"] ?? 0, "약": byLevel["약"] ?? 0, "없음": byLevel["없음"] ?? 0,
    "복원 대상(색 O·마커 X)": missing, "이미 마커 O": both,
  },
  "복원 대상 상위 25": ["| 과목/자료유형 | 쪽 |", "|---|---:|",
    ...[...bySubject].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `| ${k} | ${v} |`)],
});
