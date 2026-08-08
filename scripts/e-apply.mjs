/**
 * G-A2 — 강조 지시서를 L1 에 반영. **API 를 쓰지 않습니다.**
 *
 *   npm run e:apply                    emphasis/ 전부 반영
 *   npm run e:apply -- --subject law
 *   npm run e:apply -- --dry           쓰지 않고 결과만
 *
 * 안전장치
 *  - 마커를 벗겨낸 본문이 반영 전후로 같아야 씁니다. 다르면 그 쪽은 건너뜁니다.
 *  - 두 번 돌려도 결과가 같습니다(먼저 벗기고 다시 붙입니다).
 *  - marks 가 비어 있고 none 만 있으면 파일을 건드리지 않습니다.
 *    `"clear": true` 를 같이 준 경우에만 기존 마커를 걷어냅니다.
 *  - 못 붙인 지시는 reports/e-apply-failed.jsonl 에 남습니다. 지시서는 그대로 두니
 *    고쳐서 다시 돌리면 됩니다.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { loadManifest } from "../lib/manifest.mjs";
import { splitFrontMatter, stripMarks, applyMarks, countMarks, normalizeType } from "../lib/emphasis.mjs";
import { EMPH_DIR } from "../lib/emphasis-paths.mjs";
import { readJSONL, writeJSONL, writeReport, arg } from "../lib/jobs.mjs";

const onlySubject = arg("subject");
const dry = !!arg("dry");
const BASE = path.join(DIR.data, "l1-baseline.jsonl");

const baseline = new Map(readJSONL(BASE).map((r) => [`${r.sha}-${r.page}`, r.fp]));
if (!baseline.size) {
  console.error("data/l1-baseline.jsonl 이 없습니다. 먼저 `npm run e:baseline` 을 돌리세요.");
  process.exit(1);
}

const bySha = new Map();
for (const r of loadManifest()) if (r.is_primary) bySha.set(r.content_sha, r);

const fp = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);

let seen = 0, wrote = 0, unchanged = 0, noneKept = 0, badMark = 0, skipped = 0;
const failedRows = [];
const problems = [];
const stat = { color: 0, hl: 0, underline: 0 };
const noneReason = {};

if (!existsSync(EMPH_DIR)) {
  console.log("emphasis/ 가 아직 없습니다. `npm run e:next` 부터 하세요.");
  process.exit(0);
}

for (const sha of readdirSync(EMPH_DIR)) {
  const dir = path.join(EMPH_DIR, sha);
  const row = bySha.get(sha);
  if (onlySubject && row?.subject_key !== onlySubject) continue;
  let files;
  try { files = readdirSync(dir); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const page = Number(f.match(/p-(\d+)\.json$/)?.[1]);
    if (!Number.isFinite(page)) { problems.push(`${sha}/${f} — 파일명이 p-NNNN.json 이 아닙니다`); continue; }
    seen++;

    let rec;
    try { rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")); }
    catch (e) { problems.push(`${sha}/${f} — JSON 파싱 실패: ${String(e.message).slice(0, 80)}`); skipped++; continue; }

    if (rec.sha && rec.sha !== sha) { problems.push(`${sha}/${f} — sha 불일치(${rec.sha})`); skipped++; continue; }
    if (rec.page != null && Number(rec.page) !== page) { problems.push(`${sha}/${f} — page 불일치(${rec.page})`); skipped++; continue; }

    const md = path.join(DIR.l1, sha, `p-${String(page).padStart(4, "0")}.md`);
    if (!existsSync(md)) { problems.push(`${sha}/${f} — L1 이 없습니다`); skipped++; continue; }

    const marks = Array.isArray(rec.marks) ? rec.marks : [];
    if (!marks.length) {
      if (rec.clear) {
        const raw = readFileSync(md, "utf8");
        const { head, body } = splitFrontMatter(raw);
        const out = head + stripMarks(body);
        if (out !== raw && !dry) writeFileSync(md, out, "utf8");
        if (out !== raw) wrote++; else unchanged++;
      } else {
        noneKept++;
        const why = rec.none || "(이유 없음)";
        noneReason[why] = (noneReason[why] || 0) + 1;
        if (!rec.none) problems.push(`${sha}/${f} — marks 도 none 도 없습니다`);
      }
      continue;
    }

    for (const m of marks) {
      if (!normalizeType(m.type)) {
        problems.push(`${sha}/${f} — 모르는 type "${m.type}" (color/hl/underline)`);
      }
    }

    const raw = readFileSync(md, "utf8");
    const { head, body } = splitFrontMatter(raw);
    const before = stripMarks(body);

    let res;
    try { res = applyMarks(body, marks); }
    catch (e) { problems.push(`${sha}/${f} — ${String(e.message).slice(0, 120)}`); skipped++; continue; }

    if (stripMarks(res.body) !== before) { problems.push(`${sha}/${f} — 본문이 달라져 건너뜁니다`); skipped++; continue; }

    const want = baseline.get(`${sha}-${page}`);
    if (want && fp(before) !== want) {
      problems.push(`${sha}/${f} — 이 쪽 본문이 기준과 다릅니다. 강조 작업 밖에서 글자가 바뀌었습니다`);
      skipped++; continue;
    }

    if (res.failed.length) {
      badMark += res.failed.length;
      for (const bad of res.failed) {
        failedRows.push({ sha, page, line: bad.line, text: String(bad.text).slice(0, 60), type: bad.type, why: bad.why });
      }
    }

    const out = head + res.body;
    if (out === raw) { unchanged++; }
    else { if (!dry) writeFileSync(md, out, "utf8"); wrote++; }

    const c = countMarks(res.body);
    stat.color += c.color; stat.hl += c.hl; stat.underline += c.underline;
  }
}

writeJSONL(path.join(DIR.reports, "e-apply-failed.jsonl"), failedRows);

console.log(`지시서 ${seen.toLocaleString()}건 · 반영 ${wrote.toLocaleString()}쪽 · 이미 같음 ${unchanged.toLocaleString()} · 강조없음 유지 ${noneKept.toLocaleString()} · 건너뜀 ${skipped}`);
console.log(`붙은 강조  색 ${stat.color.toLocaleString()} · 형광 ${stat.hl.toLocaleString()} · 밑줄 ${stat.underline.toLocaleString()}`);
if (badMark) console.log(`못 붙인 지시 ${badMark}건 → reports/e-apply-failed.jsonl (지시서는 그대로 두었습니다. 고쳐서 다시 돌리세요)`);
if (dry) console.log("--dry 라 파일은 쓰지 않았습니다.");
if (problems.length) {
  console.log(`\n문제 ${problems.length}건 (앞 15개)`);
  for (const p of problems.slice(0, 15)) console.log(`  ${p}`);
}

writeReport("e-apply", {
  "요약": {
    "지시서": seen, "반영한 쪽": wrote, "이미 같음": unchanged, "강조없음 유지": noneKept,
    "건너뜀": skipped, "못 붙인 지시": badMark,
    "색 강조": stat.color, "형광": stat.hl, "밑줄": stat.underline,
  },
  "강조 없음 사유": Object.keys(noneReason).length ? noneReason : { "없음": 0 },
  "문제": problems.length ? problems.slice(0, 60).map((p) => `- ${p}`) : ["없음"],
});

process.exit(problems.length ? 1 : 0);
