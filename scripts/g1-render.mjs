/**
 * G1 — 렌더 캐시. vision 경로 문서를 쪽 단위 PNG 로 굽습니다.
 *
 *   node scripts/g1-render.mjs                     전체 (5,383쪽)
 *   node scripts/g1-render.mjs --type past-paper   기출만 (354쪽)
 *   node scripts/g1-render.mjs --limit 5 --force
 *
 * 산출: render/{content_sha}/p-NN.png  +  render/{content_sha}/.done
 * LLM 을 쓰지 않습니다. CPU 만 씁니다.
 */
import { existsSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DIR, RENDER_DPI, CONCURRENCY } from "../lib/config.mjs";
import { select, absPath, totalPages } from "../lib/manifest.mjs";
import { pdfToPngAll } from "../lib/pdf.mjs";
import { runJobs, ensureDir, writeReport, arg } from "../lib/jobs.mjs";

const type = arg("type");
const limit = arg("limit");
const force = !!arg("force");

let rows = select({ route: "vision", ...(type ? { type } : {}) });
if (limit) rows = rows.slice(0, Number(limit));

console.log(`대상 ${rows.length}개 문서 / ${totalPages(rows).toLocaleString()}쪽  @ ${RENDER_DPI}dpi`);
if (!rows.length) { console.log("대상이 없습니다."); process.exit(0); }

ensureDir(DIR.render);

const res = await runJobs({
  goal: "g1-render",
  concurrency: Math.max(2, CONCURRENCY),
  force,
  jobs: rows.map((r) => {
    const outDir = path.join(DIR.render, r.content_sha);
    return {
      key: r.path,
      out: path.join(outDir, ".done"),
      run: async () => {
        if (force && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
        ensureDir(outDir);
        await pdfToPngAll(absPath(r), outDir, { dpi: RENDER_DPI });
        const got = readdirSync(outDir).filter((f) => f.endsWith(".png")).length;
        if (r.pages && got !== r.pages) {
          throw new Error(`쪽수 불일치: 렌더 ${got} vs manifest ${r.pages}`);
        }
        writeFileSync(path.join(outDir, ".done"), String(got), "utf8");
        return got;
      },
    };
  }),
});

// 실제로 구워진 쪽 수 집계
let pngs = 0, dirs = 0;
for (const d of readdirSync(DIR.render)) {
  const p = path.join(DIR.render, d);
  if (!existsSync(path.join(p, ".done"))) continue;
  dirs++;
  pngs += readdirSync(p).filter((f) => f.endsWith(".png")).length;
}

writeReport("g1-render", {
  "요약": {
    "대상 문서": rows.length, "새로 렌더": res.done, "건너뜀": res.skipped, "실패": res.failed,
    "캐시 문서 총계": dirs, "캐시 쪽 총계": pngs, "해상도": `${RENDER_DPI}dpi`,
  },
  "검증": [
    `- 쪽수 정합: 문서마다 렌더 PNG 수 == manifest pages. 불일치는 quarantine 으로 보냈습니다.`,
    `- 실패 ${res.failed}건.`,
  ],
});
console.log(`캐시: ${dirs}문서 / ${pngs.toLocaleString()}쪽`);
