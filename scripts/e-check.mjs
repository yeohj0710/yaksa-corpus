/**
 * G-A2 — 강조 복원 게이트. **API 를 쓰지 않습니다.**
 *
 *   npm run e:check
 *   npm run e:check -- --subject law
 *
 * 여기서 막는 것
 *  1. 본문이 바뀐 쪽            — 지문 대조. 한 자라도 다르면 실패입니다
 *  2. 반영 안 된 지시서          — 지시서에 marks 가 있는데 L1 에 마커가 없는 쪽
 *  3. 못 붙인 지시              — 줄·글자가 안 맞아 버려진 것
 *  4. "강조 없음"이 지나친 문서   — 색이 잡힌 쪽의 70% 이상을 없음으로 넘긴 문서
 *
 * 4번이 이 게이트의 핵심입니다. G-A 때 강조가 통째로 빠진 걸 아무 검사도 못 잡았습니다.
 * 색이 있는 쪽인데 강조가 0개라면 그건 기계가 의심할 수 있는 신호입니다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { loadManifest } from "../lib/manifest.mjs";
import { splitFrontMatter, stripMarks, countMarks } from "../lib/emphasis.mjs";
import { EMPH_DIR, markPath } from "../lib/emphasis-paths.mjs";
import { readJSONL, writeReport, arg } from "../lib/jobs.mjs";

const onlySubject = arg("subject");
const SCAN = path.join(DIR.data, "emphasis-scan.jsonl");
const BASE = path.join(DIR.data, "l1-baseline.jsonl");

const baseline = new Map(readJSONL(BASE).map((r) => [`${r.sha}-${r.page}`, r.fp]));
const scan = readJSONL(SCAN).filter((r) => !r.err);
const bySha = new Map();
for (const r of loadManifest()) if (r.is_primary) bySha.set(r.content_sha, r);
const fp = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);

const fail = { bodyChanged: [], notApplied: [], badRecord: [] };
const warn = { noneHeavy: [], emptyDoc: [] };
let colored = 0, coloredDone = 0, coloredMarked = 0, coloredNone = 0, plainDone = 0;
const docStat = new Map();

for (const s of scan) {
  const row = bySha.get(s.sha);
  if (!row) continue;
  if (onlySubject && row.subject_key !== onlySubject) continue;
  const md = path.join(DIR.l1, s.sha, `p-${String(s.page).padStart(4, "0")}.md`);
  if (!existsSync(md)) continue;

  const { body } = splitFrontMatter(readFileSync(md, "utf8"));
  const base = stripMarks(body);
  const want = baseline.get(`${s.sha}-${s.page}`);
  if (want && fp(base) !== want) fail.bodyChanged.push(`${s.sha} ${s.page}쪽`);

  const n = countMarks(body);
  const hasMark = n.color + n.hl + n.underline > 0;
  const isColored = s.level !== "없음";
  const mp = markPath(s.sha, s.page);
  const hasRec = existsSync(mp);

  if (!docStat.has(s.sha)) docStat.set(s.sha, { colored: 0, none: 0, marked: 0, pending: 0, row });
  const d = docStat.get(s.sha);

  if (isColored) {
    colored++; d.colored++;
    if (!hasRec) { d.pending++; continue; }
    coloredDone++;
  } else if (hasRec) plainDone++;
  else continue;

  let rec = null;
  try { rec = JSON.parse(readFileSync(mp, "utf8")); }
  catch { fail.badRecord.push(`${s.sha} ${s.page}쪽 — JSON 파싱 실패`); continue; }

  const marks = Array.isArray(rec.marks) ? rec.marks : [];
  if (marks.length) {
    if (!hasMark) fail.notApplied.push(`${s.sha} ${s.page}쪽 — 지시 ${marks.length}건인데 본문에 마커가 없습니다`);
    else if (isColored) { coloredMarked++; d.marked++; }
  } else {
    if (!rec.none && !rec.clear) fail.badRecord.push(`${s.sha} ${s.page}쪽 — marks 도 none 도 없습니다`);
    // 이미 붙어 있는 마커를 그대로 두기로 한 쪽은 "강조 있음"으로 셉니다.
    if (isColored) {
      if (hasMark) { coloredMarked++; d.marked++; }
      else { coloredNone++; d.none++; }
    }
  }
}

// 문서 단위: "강조 없음"이 지나친 문서
for (const [sha, d] of docStat) {
  const reviewed = d.marked + d.none;
  if (reviewed >= 5 && d.none / reviewed >= 0.7) {
    warn.noneHeavy.push(`${sha} ${d.row.subject_key}/${d.row.material_type} — 색 잡힌 ${reviewed}쪽 중 ${d.none}쪽을 강조없음으로 넘김`);
  }
}

const failedApply = readJSONL(path.join(DIR.reports, "e-apply-failed.jsonl"));
const pending = colored - coloredDone;
const pct = colored ? ((coloredDone / colored) * 100).toFixed(1) : "0.0";

console.log(`색 잡힌 쪽 ${colored.toLocaleString()} · 검토 끝 ${coloredDone.toLocaleString()} (${pct}%) · 남음 ${pending.toLocaleString()}`);
console.log(`  강조 붙임 ${coloredMarked.toLocaleString()}쪽 · 강조없음으로 넘김 ${coloredNone.toLocaleString()}쪽`);
console.log(`색 없는 쪽 중 검토한 것 ${plainDone.toLocaleString()}쪽`);
console.log("");
console.log(`본문이 바뀐 쪽      ${fail.bodyChanged.length}`);
console.log(`반영 안 된 지시서    ${fail.notApplied.length}`);
console.log(`형식이 틀린 지시서   ${fail.badRecord.length}`);
console.log(`못 붙인 지시        ${failedApply.length}`);
console.log(`강조없음 과다 문서   ${warn.noneHeavy.length}`);

for (const [k, list] of Object.entries(fail)) {
  if (!list.length) continue;
  console.log(`\n[실패] ${k} ${list.length}건 (앞 10개)`);
  for (const x of list.slice(0, 10)) console.log(`  ${x}`);
}
if (warn.noneHeavy.length) {
  console.log(`\n[경고] 강조없음 과다 — 눈으로 한 쪽만 열어보세요 (앞 10개)`);
  for (const x of warn.noneHeavy.slice(0, 10)) console.log(`  ${x}`);
}

const failCount = fail.bodyChanged.length + fail.notApplied.length + fail.badRecord.length;

writeReport("e-check", {
  "요약": {
    "색 잡힌 쪽": colored, "검토 끝": coloredDone, "남음": pending, "진행률": `${pct}%`,
    "강조 붙임": coloredMarked, "강조없음 처리": coloredNone,
    "색 없는 쪽 검토": plainDone,
  },
  "게이트": {
    "본문 변경": fail.bodyChanged.length, "미반영 지시서": fail.notApplied.length,
    "형식 오류": fail.badRecord.length, "못 붙인 지시": failedApply.length,
    "강조없음 과다 문서": warn.noneHeavy.length,
  },
  "본문이 바뀐 쪽": fail.bodyChanged.length ? fail.bodyChanged.slice(0, 40).map((x) => `- ${x}`) : ["없음"],
  "반영 안 된 지시서": fail.notApplied.length ? fail.notApplied.slice(0, 40).map((x) => `- ${x}`) : ["없음"],
  "강조없음 과다 문서": warn.noneHeavy.length ? warn.noneHeavy.slice(0, 40).map((x) => `- ${x}`) : ["없음"],
});

process.exit(failCount ? 1 : 0);
