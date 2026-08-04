/**
 * G3 — 기출 문항 추출. 코퍼스에서 가치 밀도가 가장 높은 단계입니다.
 *
 *   node scripts/g3-exams.mjs                  전량 (문제 354쪽 + 정답 101쪽)
 *   node scripts/g3-exams.mjs --round 77       한 회차만
 *   node scripts/g3-exams.mjs --dry            LLM 호출 없이 대상만 확인
 *
 * 산출: l2/questions.jsonl, reports/g3-exams.md
 * 쪽 단위 결과는 data/g3/ 에 캐시합니다. 중간에 죽어도 이어서 돕니다.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { DIR, CONCURRENCY, LLM, EXAM_ROUNDS, SESSION_TOTAL, SUBJECTS, subjectForQuestion, assertExamLayout } from "../lib/config.mjs";
import { select } from "../lib/manifest.mjs";
import { ensureRendered, pngBase64 } from "../lib/render.mjs";
import { vision, assertStrictSchema, usageReport } from "../lib/llm.mjs";
import { runJobs, ensureDir, writeJSON, readJSON, writeJSONL, writeReport, arg } from "../lib/jobs.mjs";
import { EXAM_SYSTEM, EXAM_PROMPT, ANSWER_SYSTEM, ANSWER_PROMPT } from "../lib/prompts.mjs";

assertExamLayout();
const Q_SCHEMA = readJSON(path.join(DIR.schema, "question.schema.json"));
const A_SCHEMA = readJSON(path.join(DIR.schema, "answer.schema.json"));
assertStrictSchema(Q_SCHEMA);
assertStrictSchema(A_SCHEMA);

const onlyRound = arg("round");
const dry = !!arg("dry");
const force = !!arg("force");
const CACHE = ensureDir(path.join(DIR.data, "g3"));

const roundOf = (f) => Number(f.match(/제(\d+)회/)?.[1] ?? 0);
const sessionOf = (f) => Number(f.match(/(\d)교시\s*전체\s*문제/)?.[1] ?? 0);

let papers = select({ type: "past-paper" }).map((r) => ({ ...r, round: roundOf(r.filename), session: sessionOf(r.filename) }));
let keys = select({ type: "past-paper-answer" }).map((r) => ({ ...r, round: roundOf(r.filename) }));
if (onlyRound) {
  papers = papers.filter((p) => p.round === Number(onlyRound));
  keys = keys.filter((k) => k.round === Number(onlyRound));
}

const badPaper = papers.filter((p) => !p.round || !p.session);
if (badPaper.length) {
  console.error("파일명에서 회차·교시를 못 읽었습니다:");
  for (const p of badPaper) console.error(`  ${p.path}`);
  process.exit(1);
}

console.log(`문제지 ${papers.length}개 / 정답지 ${keys.length}개`);
console.log(`문제 ${papers.reduce((n, p) => n + p.pages, 0)}쪽 + 정답 ${keys.reduce((n, p) => n + p.pages, 0)}쪽`);
if (dry) {
  for (const p of papers) console.log(`  제${p.round}회 ${p.session}교시  ${p.pages}쪽`);
  process.exit(0);
}

// --- 쪽 단위 추출 -----------------------------------------------------------
async function extractPages(rows, { schema, system, prompt, tag, maxTokens }) {
  const jobs = [];
  for (const row of rows) {
    for (let page = 1; page <= row.pages; page++) {
      const out = path.join(CACHE, `${tag}-${row.content_sha}-${String(page).padStart(3, "0")}.json`);
      jobs.push({
        key: `${row.filename}#${page}`,
        out,
        run: async () => {
          const pages = await ensureRendered(row);
          const png = pages.get(page);
          if (!png) throw new Error(`렌더 없음: p${page}`);
          const data = await vision({
            model: LLM.vision, system, prompt,
            imageBase64: pngBase64(png), schema,
            schemaName: tag, promptCacheKey: `yaksa-exam-${tag}-v1`, maxTokens,
          });
          writeJSON(out, { row: row.path, round: row.round, session: row.session, page, ...data });
          return true;
        },
      });
    }
  }
  return runJobs({ goal: `g3-${tag}`, jobs, concurrency: CONCURRENCY, force });
}

// 약물치료학 사례형은 지문·선지가 길어 한 쪽에서 출력이 12,000 토큰을 넘습니다.
// 잘리면 llm.mjs 가 던지므로 조용히 손실되지는 않지만, 넉넉히 잡아야 재실행이 없습니다.
// 실제 과금은 생성된 토큰만큼이라 상한을 올려도 비용은 늘지 않습니다.
console.log("\n[1/3] 문제지 전사");
const rq = await extractPages(papers, {
  schema: Q_SCHEMA, system: EXAM_SYSTEM, prompt: EXAM_PROMPT, tag: "q", maxTokens: 32000,
});

console.log("[2/3] 정답지 전사");
const ra = await extractPages(keys, {
  schema: A_SCHEMA, system: ANSWER_SYSTEM, prompt: ANSWER_PROMPT, tag: "a", maxTokens: 12000,
});

// --- 조립 -------------------------------------------------------------------
console.log("[3/3] 조립·정답 결합");
const answers = new Map();   // "round-session-number" -> { answer, area_label }
for (const k of keys) {
  for (let page = 1; page <= k.pages; page++) {
    const f = path.join(CACHE, `a-${k.content_sha}-${String(page).padStart(3, "0")}.json`);
    const d = readJSON(f);
    if (!d) continue;
    for (const a of d.answers ?? []) {
      answers.set(`${k.round}-${a.session}-${a.number}`, { answer: a.answer, area: a.area_label ?? null });
    }
  }
}

/**
 * 정답지의 과목 칸으로 구간 매핑을 교차검증합니다.
 * 국시원 표는 영역명(생명약학·산업약학·임상실무약학·법규)까지만 적으므로 영역 수준에서 봅니다.
 */
const AREA_OF_LABEL = (s = "") =>
  /생명/.test(s) ? 1 : /산업/.test(s) ? 2 : /법규|보건/.test(s) ? 4 : /임상|실무/.test(s) ? 3 : 0;

const questions = [];
const dupes = [];
const seen = new Set();
for (const p of papers) {
  const year = EXAM_ROUNDS.find((r) => r.round === p.round)?.year ?? null;
  for (let page = 1; page <= p.pages; page++) {
    const f = path.join(CACHE, `q-${p.content_sha}-${String(page).padStart(3, "0")}.json`);
    const d = readJSON(f);
    if (!d) continue;
    for (const q of d.page_questions ?? []) {
      const id = `${p.round}-${p.session}-${q.number}`;
      if (seen.has(id)) { dupes.push(id); continue; }
      seen.add(id);
      const key = subjectForQuestion(p.session, q.number);
      const ans = answers.get(id) ?? null;
      questions.push({
        id,
        exam_round: p.round, exam_year: year, session: p.session, number: q.number,
        subject_key: key,
        subject_source: "range",           // 번호 구간에서 유도. 안내문 15개와 대조 검증됨
        area: SUBJECTS.find((s) => s.key === key)?.area ?? null,
        area_label: ans?.area ?? null,     // 정답지가 적어 둔 영역명. 교차검증용
        stem: q.stem, stem_box: q.stem_box ?? null,
        options: q.options,
        answer: ans?.answer ?? null,
        figure_withheld: !!q.figure_withheld,
        has_figure: !!q.has_figure,
        source_sha: p.content_sha, source_page: page, source_key: p.source_key,
      });
    }
  }
}
questions.sort((a, b) => a.exam_round - b.exam_round || a.session - b.session || a.number - b.number);
ensureDir(DIR.l2);
writeJSONL(path.join(DIR.l2, "questions.jsonl"), questions);

// --- 검증 -------------------------------------------------------------------
const rounds = onlyRound ? [Number(onlyRound)] : EXAM_ROUNDS.map((r) => r.round);
const grid = [];
let gateFail = 0;
for (const round of rounds) {
  for (const s of [1, 2, 3, 4]) {
    const got = questions.filter((q) => q.exam_round === round && q.session === s);
    const want = SESSION_TOTAL[s];
    const ok = got.length === want;
    if (!ok) gateFail++;
    grid.push(`| 제${round}회 | ${s}교시 | ${got.length} | ${want} | ${ok ? "✅" : "❌"} |`);
  }
}
const badOpts = questions.filter((q) => (q.options?.length ?? 0) !== 5);
const noAnswer = questions.filter((q) => q.answer == null);
const withheld = questions.filter((q) => q.figure_withheld);
const noSubject = questions.filter((q) => !q.subject_key);
// 정답지 영역명 vs 번호구간에서 유도한 영역. 어긋나면 매핑이 틀어진 것입니다.
const areaClash = questions.filter(
  (q) => q.area_label && AREA_OF_LABEL(q.area_label) && AREA_OF_LABEL(q.area_label) !== q.area,
);

const u = usageReport();
writeReport("g3-exams", {
  "요약": {
    "문제지": papers.length, "정답지": keys.length,
    "추출 문항": questions.length,
    "기대 문항": rounds.length * 350,
    "정답 결합": questions.length - noAnswer.length,
    "그림 비공개": withheld.length,
    "LLM 호출": u.calls, "입력 토큰": u.promptTokens, "출력 토큰": u.completionTokens,
  },
  "회차·교시별 문항 수": ["| 회차 | 교시 | 추출 | 기대 | |", "|---|---|---:|---:|:--:|", ...grid],
  "게이트": [
    `| 검사 | 결과 |`, `|---|---|`,
    `| 회차·교시 문항 수 | ${gateFail ? `❌ ${gateFail}칸 불일치` : "✅ 전부 일치"} |`,
    `| 선지 5개 | ${badOpts.length ? `❌ ${badOpts.length}문항` : "✅"} |`,
    `| 정답 커버리지 | ${noAnswer.length ? `❌ ${noAnswer.length}문항 비어 있음` : "✅ 100%"} |`,
    `| 중복 id | ${dupes.length ? `❌ ${dupes.length}건` : "✅ 0"} |`,
    `| 과목 매핑 | ${noSubject.length ? `❌ ${noSubject.length}문항` : "✅"} |`,
    `| 영역 교차검증(정답지 과목칸) | ${areaClash.length ? `❌ ${areaClash.length}문항 불일치` : "✅"} |`,
  ],
  "실행": { "쪽 전사 완료": rq.done + ra.done, "건너뜀": rq.skipped + ra.skipped, "실패": rq.failed + ra.failed },
});

console.log(`\n문항 ${questions.length} / 기대 ${rounds.length * 350}`);
console.log(`정답 결합 ${questions.length - noAnswer.length} · 선지오류 ${badOpts.length} · 중복 ${dupes.length} · 그림비공개 ${withheld.length}`);
console.log(`영역 교차검증 불일치 ${areaClash.length}`);
console.log(`→ ${path.join(DIR.l2, "questions.jsonl")}`);
if (gateFail || badOpts.length || noAnswer.length || dupes.length || areaClash.length) {
  console.log("\n게이트 실패. reports/g3-exams.md 를 보고 해당 쪽만 --force 로 다시 돌리세요.");
  process.exit(1);
}
