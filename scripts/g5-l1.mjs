/**
 * G5 — L1 원문 전사. 쪽 하나당 마크다운 하나.
 *
 *   node scripts/g5-l1.mjs --type textbook          주교재만
 *   node scripts/g5-l1.mjs --subject pharmacology
 *   node scripts/g5-l1.mjs --limit 3                맛보기
 *   node scripts/g5-l1.mjs --route pdftotext        LLM 없이 CLEAN 만 (무료)
 *
 * 산출: l1/{content_sha}/p-NNNN.md
 * 기본은 전량이 아니라 --type/--subject 로 잘라서 돌리는 쪽을 권합니다.
 * 순서: study-guide → past-paper → textbook → summary → 나머지
 */
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DIR, CONCURRENCY, LLM } from "../lib/config.mjs";
import { select, absPath } from "../lib/manifest.mjs";
import { ensureRendered, pngBase64 } from "../lib/render.mjs";
import { pdfToText } from "../lib/pdf.mjs";
import { vision, usageReport } from "../lib/llm.mjs";
import { runJobs, ensureDir, writeReport, arg } from "../lib/jobs.mjs";
import { TRANSCRIBE_SYSTEM, TRANSCRIBE_PROMPT } from "../lib/prompts.mjs";

const type = arg("type"), subject = arg("subject"), limit = arg("limit");
const routeArg = arg("route"), force = !!arg("force");

let rows = select({
  routes: routeArg ? [routeArg] : ["vision", "pdftotext"],
  ...(type ? { type } : {}), ...(subject ? { subject } : {}),
});
if (limit) rows = rows.slice(0, Number(limit));

const pages = rows.reduce((n, r) => n + (r.pages || 0), 0);
const visionPages = rows.filter((r) => r.extract_route === "vision").reduce((n, r) => n + (r.pages || 0), 0);
console.log(`문서 ${rows.length}개 / ${pages.toLocaleString()}쪽  (vision ${visionPages.toLocaleString()}쪽, pdftotext ${(pages - visionPages).toLocaleString()}쪽)`);
if (!rows.length) { console.log("대상이 없습니다."); process.exit(0); }

function frontMatter(r, page) {
  return [
    "---",
    `sha: ${r.content_sha}`,
    `page: ${page}`,
    `pages_total: ${r.pages}`,
    `source_key: ${r.source_key}`,
    `subject_key: ${r.subject_key}`,
    `material_type: ${r.material_type}`,
    `extract_route: ${r.extract_route}`,
    "---",
    "",
  ].join("\n");
}

const jobs = [];
for (const r of rows) {
  const dir = path.join(DIR.l1, r.content_sha);
  for (let page = 1; page <= (r.pages || 0); page++) {
    const out = path.join(dir, `p-${String(page).padStart(4, "0")}.md`);
    jobs.push({
      key: `${r.filename}#${page}`,
      out,
      run: async () => {
        let body;
        if (r.extract_route === "pdftotext") {
          body = (await pdfToText(absPath(r), page, { layout: true })).trimEnd();
        } else {
          const pngs = await ensureRendered(r);
          const png = pngs.get(page);
          if (!png) throw new Error(`렌더 없음: p${page}`);
          body = await vision({
            model: LLM.vision, system: TRANSCRIBE_SYSTEM, prompt: TRANSCRIBE_PROMPT,
            imageBase64: pngBase64(png), maxTokens: 8000,
          });
        }
        ensureDir(dir);
        writeFileSync(out, frontMatter(r, page) + body + "\n", "utf8");
        return body.length;
      },
    });
  }
}

const res = await runJobs({ goal: "g5-l1", jobs, concurrency: CONCURRENCY, force });

// 쪽수 정합 확인
let complete = 0, partial = [];
for (const r of rows) {
  const dir = path.join(DIR.l1, r.content_sha);
  let got = 0;
  for (let p = 1; p <= (r.pages || 0); p++) {
    if (existsSync(path.join(dir, `p-${String(p).padStart(4, "0")}.md`))) got++;
  }
  if (got === r.pages) complete++;
  else partial.push(`${r.subject_key} ${r.material_type}: ${got}/${r.pages}`);
}

const u = usageReport();
writeReport("g5-l1", {
  "요약": { "문서": rows.length, "쪽": pages, "새로 전사": res.done, "건너뜀": res.skipped, "실패": res.failed,
            "LLM 호출": u.calls, "입력 토큰": u.promptTokens, "출력 토큰": u.completionTokens },
  "게이트": [`| 검사 | 결과 |`, `|---|---|`,
    `| 쪽수 정합 | ${partial.length ? `❌ 미완 ${partial.length}문서` : "✅ 전 문서 일치"} |`,
    `| 완결 문서 | ${complete}/${rows.length} |`],
  "미완 문서": partial.length ? partial.slice(0, 30) : ["없음"],
});

console.log(`완결 ${complete}/${rows.length} 문서`);
if (partial.length) process.exit(1);
