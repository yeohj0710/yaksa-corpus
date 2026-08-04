/**
 * 전사 정확도 측정. 이 파이프라인에서 품질을 숫자로 말할 수 있는 유일한 지점입니다.
 *
 * CLEAN 페이지(1,772쪽)에는 pdftotext 라는 공짜 정답지가 있습니다.
 * 같은 쪽을 비전 모델로도 전사해서 문자 단위로 비교합니다.
 * 여기서 나온 오차율이 나머지 5,383쪽(정답지가 없는 쪽)의 신뢰도 추정치입니다.
 *
 *   node scripts/accuracy.mjs --n 40
 *
 * 산출: reports/accuracy.md
 *
 * 지표를 두 가지로 봅니다.
 *
 *  - token_recall  : 정답지 토큰 중 비전 출력에 남은 비율. **이게 주 지표입니다.**
 *                    읽는 순서와 무관해서 표·2단 조판에서도 내용 보존을 제대로 잽니다.
 *  - token_precision: 비전 출력 토큰 중 정답지에 있는 비율. 없는 말을 지어냈는지 봅니다.
 *                    표 골격(`|`, 머리행)이나 [FIGURE] 설명이 붙으면 자연히 내려갑니다.
 *  - cer           : 문자 편집거리. 참고용으로만 둡니다.
 *                    pdftotext -layout 은 표 셀을 뒤섞어 읽어서, 비전이 표를 **정확히**
 *                    복원해도 CER 이 50%를 넘습니다. 이 지표로 품질을 판단하면 안 됩니다.
 */
import path from "node:path";
import { DIR, CONCURRENCY, LLM } from "../lib/config.mjs";
import { select, absPath } from "../lib/manifest.mjs";
import { ensureRendered, pngBase64 } from "../lib/render.mjs";
import { pdfToText } from "../lib/pdf.mjs";
import { vision, usageReport } from "../lib/llm.mjs";
import { runJobs, writeReport, arg, ensureDir, writeJSON, readJSON } from "../lib/jobs.mjs";
import { TRANSCRIBE_SYSTEM, TRANSCRIBE_PROMPT } from "../lib/prompts.mjs";

const N = Number(arg("n", 40));
const CACHE = ensureDir(path.join(DIR.data, "accuracy"));

/** 서식·공백·figure 자리표시자를 걷어내고 내용 문자만 남깁니다. */
function normalize(s) {
  return s
    .replace(/\[FIGURE:[^\]]*\]/g, "")
    .replace(/\[UNREADABLE\]/g, "")
    .replace(/[*#`|>_~\-–—\[\]()]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * 내용 토큰. 한글 2자 이상 덩어리와 영숫자 2자 이상을 뽑습니다.
 * 순서에 좌우되지 않으므로 표를 어느 방향으로 읽든 같은 집합이 나옵니다.
 */
function tokens(s) {
  // 공백까지 지운 뒤 문자 3-gram 을 씁니다.
  // 단어 단위로 자르면 pdftotext -layout 이 단 경계에서 넣는 공백 때문에
  // 같은 내용이 다른 토큰으로 쪼개져 실제보다 나쁘게 잡힙니다.
  const cleaned = s
    .replace(/\[FIGURE:[^\]]*\]/g, " ")
    .replace(/\[UNREADABLE\]/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/[|*#`>_~\-–—\[\]()]/g, " ")
    .replace(/\s+/g, "")
    .toLowerCase();
  const g = new Set();
  for (let i = 0; i + 3 <= cleaned.length; i++) g.add(cleaned.slice(i, i + 3));
  return g;
}

function overlap(truth, got) {
  if (!truth.size) return { recall: 1, precision: got.size ? 0 : 1 };
  let hit = 0;
  for (const t of truth) if (got.has(t)) hit++;
  let back = 0;
  for (const g of got) if (truth.has(g)) back++;
  return { recall: hit / truth.size, precision: got.size ? back / got.size : 0 };
}

/** 편집거리. 행 하나만 굴려서 메모리를 아낍니다. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur.slice();
  }
  return prev[b.length];
}

// CLEAN 문서에서 쪽을 고르게 뽑습니다(결정적 — 같은 표본이 반복 재현됩니다).
const clean = select({ route: "pdftotext" }).filter((r) => (r.pages ?? 0) > 0);
const picks = [];
for (let i = 0; picks.length < N && i < clean.length * 5; i++) {
  const r = clean[i % clean.length];
  const page = ((Math.floor(i / clean.length) * 7 + 1) % r.pages) + 1;
  if (!picks.some((p) => p.r.content_sha === r.content_sha && p.page === page)) picks.push({ r, page });
}
console.log(`CLEAN 문서 ${clean.length}개에서 ${picks.length}쪽 표본 추출`);

const results = [];
await runJobs({
  goal: "accuracy", concurrency: CONCURRENCY,
  jobs: picks.map(({ r, page }) => {
    const out = path.join(CACHE, `${r.content_sha}-${page}.json`);
    return {
      key: `${r.filename}#${page}`, out,
      run: async () => {
        const truth = await pdfToText(absPath(r), page, { layout: true });
        const pngs = await ensureRendered(r);
        const png = pngs.get(page);
        if (!png) throw new Error(`렌더 없음 p${page}`);
        const got = await vision({
          model: LLM.vision, system: TRANSCRIBE_SYSTEM, prompt: TRANSCRIBE_PROMPT,
          imageBase64: pngBase64(png), tag: "accuracy", maxTokens: 24000,
        });
        const a = normalize(truth), b = normalize(got);
        const tt = tokens(truth), tg = tokens(got);
        const { recall, precision } = overlap(tt, tg);
        // 정답지에 있는데 비전이 놓친 토큰. 실제 오독을 눈으로 보는 용도입니다.
        const missed = [...tt].filter((t) => !tg.has(t)).slice(0, 12);
        writeJSON(out, {
          sha: r.content_sha, page, subject: r.subject_key, type: r.material_type,
          truthLen: a.length, gotLen: b.length,
          distance: a.length || b.length ? levenshtein(a, b) : 0,
          truthTokens: tt.size, gotTokens: tg.size,
          recall: +recall.toFixed(4), precision: +precision.toFixed(4),
          missed,
        });
        return true;
      },
    };
  }),
});

for (const { r, page } of picks) {
  const d = readJSON(path.join(CACHE, `${r.content_sha}-${page}.json`));
  if (d) results.push(d);
}

const usable = results.filter((d) => d.truthLen >= 100 && d.recall != null);
const stat = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return {
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0,
    med: s.length ? s[s.length >> 1] : 0,
    p10: s.length ? s[Math.floor(s.length * 0.1)] : 0,
  };
};
const R = stat(usable.map((d) => d.recall));
const P = stat(usable.map((d) => d.precision));
const C = stat(usable.map((d) => d.distance / Math.max(d.truthLen, 1)));
const worst = [...usable].sort((a, b) => a.recall - b.recall).slice(0, 6);

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const u = usageReport();
writeReport("accuracy", {
  "요약": {
    "표본 쪽": results.length, "유효 표본": usable.length,
    "토큰 재현율 평균 (주 지표)": pct(R.mean), "중앙값": pct(R.med), "하위10%": pct(R.p10),
    "토큰 정밀도 평균": pct(P.mean),
    "문자오차율 CER 평균 (참고용)": pct(C.mean),
    "LLM 호출": u.calls, "출력 토큰": u.completionTokens,
  },
  "지표 읽는 법": [
    "- **토큰 재현율**이 주 지표입니다. 정답지 토큰이 비전 출력에 얼마나 남았는지를 봅니다.",
    "  읽는 순서와 무관해서 표·2단 조판에서도 내용 보존을 제대로 잽니다.",
    "  이 값이 정답지 없는 vision 5,383쪽의 신뢰도 추정치입니다.",
    "- **정밀도**는 비전이 없는 말을 붙였는지 봅니다. 표 골격이나 [FIGURE] 설명 때문에",
    "  자연히 100%가 되지 않습니다. 급격히 낮으면 환각을 의심합니다.",
    "- **CER 은 품질 판단에 쓰지 마세요.** `pdftotext -layout` 이 표 셀을 뒤섞어 읽기 때문에,",
    "  비전이 표를 정확히 복원해도 50%를 넘깁니다. 정답지 쪽이 틀린 경우입니다.",
    "- 아래 '놓친 토큰'을 눈으로 보세요. 실제 오독은 여기서 드러납니다.",
  ],
  "재현율 낮은 표본": worst.length
    ? ["| 과목 | 종류 | 쪽 | 재현율 | 정밀도 | 놓친 토큰 |", "|---|---|---:|---:|---:|---|",
       ...worst.map((d) => `| ${d.subject} | ${d.type} | ${d.page} | ${pct(d.recall)} | ${pct(d.precision)} | ${(d.missed ?? []).slice(0, 6).join(", ")} |`)]
    : ["없음"],
});

console.log(`\n토큰 재현율  평균 ${pct(R.mean)} · 중앙값 ${pct(R.med)} · 하위10% ${pct(R.p10)}`);
console.log(`토큰 정밀도  평균 ${pct(P.mean)}`);
console.log(`CER(참고)    평균 ${pct(C.mean)}  ← 표 읽는 순서 때문에 과대평가됩니다`);
