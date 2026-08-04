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
 * 한계: 비전은 마크다운, pdftotext 는 평문이라 서식 차이를 정규화한 뒤 비교합니다.
 *       표·2단 조판은 읽는 순서가 달라 실제보다 오차가 크게 잡힐 수 있습니다.
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
          imageBase64: pngBase64(png), maxTokens: 8000,
        });
        const a = normalize(truth), b = normalize(got);
        writeJSON(out, {
          sha: r.content_sha, page, subject: r.subject_key, type: r.material_type,
          truthLen: a.length, gotLen: b.length,
          distance: a.length || b.length ? levenshtein(a, b) : 0,
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

const usable = results.filter((d) => d.truthLen >= 100);
const cer = usable.map((d) => d.distance / Math.max(d.truthLen, 1));
const mean = cer.length ? cer.reduce((a, b) => a + b, 0) / cer.length : 0;
const sorted = [...cer].sort((a, b) => a - b);
const med = sorted.length ? sorted[sorted.length >> 1] : 0;
const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0;
const worst = [...usable].sort((a, b) => b.distance / b.truthLen - a.distance / a.truthLen).slice(0, 5);

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const u = usageReport();
writeReport("accuracy", {
  "요약": {
    "표본 쪽": results.length, "유효 표본(정답 100자 이상)": usable.length,
    "평균 문자오차율(CER)": pct(mean), "중앙값": pct(med), "90분위": pct(p90),
    "추정 정확도": pct(1 - mean),
    "LLM 호출": u.calls, "출력 토큰": u.completionTokens,
  },
  "해석": [
    `- 이 오차율은 정답지가 없는 vision 5,383쪽에 대한 신뢰도 추정치입니다.`,
    `- CER 5% 이상이면 프롬프트나 해상도(RENDER_DPI)를 손봐야 합니다.`,
    `- 표·2단 조판은 읽는 순서 차이로 실제보다 나쁘게 잡힙니다. 아래 최악 표본을 눈으로 확인하세요.`,
  ],
  "최악 표본": worst.length
    ? ["| 과목 | 종류 | 쪽 | 정답 길이 | CER |", "|---|---|---:|---:|---:|",
       ...worst.map((d) => `| ${d.subject} | ${d.type} | ${d.page} | ${d.truthLen} | ${pct(d.distance / d.truthLen)} |`)]
    : ["없음"],
});

console.log(`\n평균 CER ${pct(mean)} · 중앙값 ${pct(med)} · 90분위 ${pct(p90)}`);
console.log(`추정 전사 정확도 ${pct(1 - mean)}`);
