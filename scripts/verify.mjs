/**
 * 검증 게이트 전량. 통과 못 하면 0 이 아닌 코드로 끝납니다.
 *
 *   node scripts/verify.mjs
 *
 * 숫자를 맞추려고 데이터를 고치지 마세요. 실패는 실패로 보고합니다.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DIR, SOURCE_ROOT, SUBJECTS, SESSION_TOTAL, EXAM_ROUNDS, sessionRanges, assertExamLayout } from "../lib/config.mjs";
import { select, loadManifest, totalPages } from "../lib/manifest.mjs";
import { readJSONL, readJSON, writeReport } from "../lib/jobs.mjs";

const checks = [];
const add = (name, ok, detail = "") => {
  checks.push({ name, ok: ok === true ? "pass" : ok === null ? "skip" : "fail", detail });
  const mark = ok === true ? "✅" : ok === null ? "⬜" : "❌";
  console.log(`  ${mark} ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log("── 설정 ─────────────────────────────────────────");
try { assertExamLayout(); add("시험 배치 합계 350", true); }
catch (e) { add("시험 배치 합계 350", false, e.message.replace(/\n/g, " ")); }

// 과목별 문항 구간을 원본 안내문과 대조합니다. 추측이 아니라 근거로 고정합니다.
{
  let bad = [];
  for (const s of SUBJECTS) {
    const f = path.join(SOURCE_ROOT, s.folder, "00. 국시 기출문제 (2020-2026)", "00. 기출문제 안내.md");
    if (!existsSync(f)) { bad.push(`${s.key}:안내문없음`); continue; }
    const txt = readFileSync(f, "utf8");
    const sess = Number(txt.match(/시험지:\s*(\d)교시/)?.[1]);
    const m = txt.match(/문항 범위:\s*(\d+)\s*~\s*(\d+)\s*번/);
    const want = sessionRanges(s.session).find((r) => r.key === s.key);
    if (sess !== s.session || !m || Number(m[1]) !== want.from || Number(m[2]) !== want.to) bad.push(s.key);
  }
  add("과목 문항 구간 == 원본 안내문", bad.length === 0, bad.length ? bad.join(", ") : "15과목 일치");
}

console.log("\n── L0 인벤토리 ──────────────────────────────────");
let rows = null;
try { rows = loadManifest(); } catch (e) { add("manifest 존재", false, e.message.split("\n")[0]); }
if (rows) {
  const prim = rows.filter((r) => r.is_primary);
  add("manifest 존재", true, `${rows.length}행`);
  add("모든 행에 extract_route", rows.every((r) => r.extract_route), "");
  add("모든 행에 content_sha", rows.every((r) => r.content_sha), "");
  const shaDup = new Set();
  const seen = new Map();
  for (const r of prim) {
    if (seen.has(r.content_sha)) shaDup.add(r.content_sha);
    seen.set(r.content_sha, r);
  }
  add("primary 안에 동일 SHA 없음", shaDup.size === 0, shaDup.size ? `${shaDup.size}건` : "");
  add("기출 문제지 28개", select({ type: "past-paper" }).length === 28, `${select({ type: "past-paper" }).length}개`);
  add("기출 정답지 7개", select({ type: "past-paper-answer" }).length === 7, `${select({ type: "past-paper-answer" }).length}개`);
  console.log(`     쪽: 전체 ${totalPages(rows).toLocaleString()} / 중복제거 ${totalPages(prim).toLocaleString()}`);
}

console.log("\n── G1 렌더 ──────────────────────────────────────");
if (!existsSync(DIR.render) || !readdirSync(DIR.render).length) add("렌더 캐시", null, "미실행");
else {
  let mismatch = [];
  for (const r of select({ route: "vision" })) {
    const d = path.join(DIR.render, r.content_sha);
    if (!existsSync(path.join(d, ".done"))) continue;
    const n = readdirSync(d).filter((f) => f.endsWith(".png")).length;
    if (n !== r.pages) mismatch.push(`${r.subject_key}:${n}/${r.pages}`);
  }
  add("렌더 쪽수 == manifest", mismatch.length === 0, mismatch.slice(0, 5).join(" "));
}

console.log("\n── G3 기출 ──────────────────────────────────────");
const qFile = path.join(DIR.l2, "questions.jsonl");
if (!existsSync(qFile)) add("questions.jsonl", null, "미실행");
else {
  const qs = readJSONL(qFile);
  add("questions.jsonl", true, `${qs.length}문항`);

  const gridBad = [];
  for (const { round } of EXAM_ROUNDS) {
    for (const s of [1, 2, 3, 4]) {
      const n = qs.filter((q) => q.exam_round === round && q.session === s).length;
      if (n !== SESSION_TOTAL[s]) gridBad.push(`${round}회${s}교시:${n}/${SESSION_TOTAL[s]}`);
    }
  }
  add("회차·교시별 문항 수", gridBad.length === 0, gridBad.slice(0, 6).join(" "));
  add("총 문항 2,450", qs.length === 2450, `${qs.length}`);

  const badOpt = qs.filter((q) => (q.options?.length ?? 0) !== 5);
  add("선지 정확히 5개", badOpt.length === 0, badOpt.length ? `${badOpt.length}문항` : "");

  const noAns = qs.filter((q) => q.answer == null);
  add("정답 커버리지 100%", noAns.length === 0, noAns.length ? `${noAns.length}문항 비어 있음` : "");

  const badAns = qs.filter((q) => q.answer != null && (q.answer < 0 || q.answer > 5));
  add("정답 값 0~5", badAns.length === 0, badAns.length ? `${badAns.length}문항` : "");

  const ids = new Set();
  const dup = qs.filter((q) => (ids.has(q.id) ? true : (ids.add(q.id), false)));
  add("중복 id 없음", dup.length === 0, dup.length ? `${dup.length}건` : "");

  const noSubj = qs.filter((q) => !q.subject_key);
  add("과목 매핑 완료", noSubj.length === 0, noSubj.length ? `${noSubj.length}문항` : "");

  const emptyStem = qs.filter((q) => !q.stem || q.stem.trim().length < 3);
  add("빈 발문 없음", emptyStem.length === 0, emptyStem.length ? `${emptyStem.length}문항` : "");

  const withheld = qs.filter((q) => q.figure_withheld).length;
  console.log(`     참고: 그림 비공개 문항 ${withheld}개 (정상. 국시원이 자료를 뺀 문항입니다)`);
}

console.log("\n── G4 카드 ──────────────────────────────────────");
const cFile = path.join(DIR.l2, "cards.jsonl");
if (!existsSync(cFile)) add("cards.jsonl", null, "미실행");
else {
  const cs = readJSONL(cFile);
  add("cards.jsonl", true, `${cs.length}장`);
  add("빈 front/back 없음", cs.every((c) => c.front?.trim() && c.back?.trim()), "");
  // 원본 CSV 는 따옴표 안 줄바꿈이 많아 물리 줄 수(2,652)와 레코드 수(542)가 다릅니다.
  add("카드 542장", cs.length === 542, `${cs.length}`);
}

console.log("\n── G2 가이드 ────────────────────────────────────");
const gFile = path.join(DIR.l2, "guide.json");
if (!existsSync(gFile)) add("guide.json", null, "미실행");
else {
  const gs = readJSON(gFile, []);
  add("guide.json 15과목", gs.length === 15, `${gs.length}과목`);
  const noUnit = gs.filter((g) => !g.unit_priority?.length).map((g) => g.subject_key);
  add("단원 순위 1개 이상", noUnit.length === 0, noUnit.length ? `없는 과목: ${noUnit.join(",")}` : "");
}

console.log("\n── 정확도 ───────────────────────────────────────");
const accFile = path.join(DIR.reports, "accuracy.md");
add("전사 정확도 측정", existsSync(accFile) ? true : null,
    existsSync(accFile) ? "reports/accuracy.md" : "미실행 — npm run accuracy");

console.log("\n── quarantine ───────────────────────────────────");
const qn = readJSONL(path.join(DIR.reports, "quarantine.jsonl")).length;
add("quarantine 비어 있음", qn === 0, qn ? `${qn}건 — reports/quarantine.jsonl` : "");

// ---------------------------------------------------------------------------
const fail = checks.filter((c) => c.ok === "fail");
const skip = checks.filter((c) => c.ok === "skip");
writeReport("verify", {
  "요약": { "검사": checks.length, "통과": checks.filter((c) => c.ok === "pass").length,
            "실패": fail.length, "미실행": skip.length },
  "결과": ["| 검사 | 결과 | 비고 |", "|---|:--:|---|",
    ...checks.map((c) => `| ${c.name} | ${c.ok === "pass" ? "✅" : c.ok === "skip" ? "⬜" : "❌"} | ${c.detail || ""} |`)],
});

console.log(`\n통과 ${checks.length - fail.length - skip.length} · 실패 ${fail.length} · 미실행 ${skip.length}`);
if (fail.length) { console.log("\n실패:"); for (const c of fail) console.log(`  - ${c.name}: ${c.detail}`); }
process.exit(fail.length ? 1 : 0);
