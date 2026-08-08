/**
 * G-A2 0단계 — 준비. **API 를 쓰지 않습니다.**
 *
 *   npm run e:prep              렌더 없는 문서를 굽고, 스캔에 없는 쪽을 채웁니다
 *   npm run e:prep -- --ink     여기에 더해 잉크맵을 미리 만들어 둡니다(느립니다)
 *   npm run e:prep -- --clean-ink   잉크맵 캐시를 지웁니다
 *
 * 하는 일
 *   1. L1 은 있는데 render/{sha} 가 없는 문서를 굽습니다. pdftotext 로 뽑은 945쪽이
 *      여기 걸립니다. 텍스트 레이어에는 색·굵기가 안 남아서 그림을 봐야 합니다.
 *   2. 새로 구운 쪽을 강조 스캔에 반영합니다.
 *
 * 잉크맵(render-ink/)
 *   유채색만 남기고 검은 글씨는 옅게 깐 사본입니다. 어느 글자에 색이 칠해졌는지
 *   한눈에 보라고 만듭니다. gitignore 대상이고 언제든 다시 만들 수 있습니다.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DIR, CONCURRENCY } from "../lib/config.mjs";
import { loadManifest } from "../lib/manifest.mjs";
import { ensureRendered } from "../lib/render.mjs";
import { INK_DIR, inkPath, makeInkMap } from "../lib/emphasis.mjs";
import { runJobs, writeReport, arg } from "../lib/jobs.mjs";
import { pageOf } from "../lib/pdf.mjs";

const doInk = !!arg("ink");
const cleanInk = !!arg("clean-ink");

if (cleanInk) {
  if (existsSync(INK_DIR)) rmSync(INK_DIR, { recursive: true, force: true });
  console.log("잉크맵 캐시를 지웠습니다.");
  process.exit(0);
}

const bySha = new Map();
for (const r of loadManifest()) if (r.is_primary) bySha.set(r.content_sha, r);

// --- 1. 렌더가 없는 L1 문서 굽기 --------------------------------------------
const needRender = [];
for (const sha of readdirSync(DIR.l1)) {
  const r = bySha.get(sha);
  if (!r || !r.pages) continue;
  if (r.ext !== ".pdf") continue;
  if (existsSync(path.join(DIR.render, sha, ".done"))) continue;
  needRender.push(r);
}

console.log(`렌더가 없는 문서 ${needRender.length}개 (${needRender.reduce((a, b) => a + (b.pages || 0), 0)}쪽)`);
let rendered = 0;
if (needRender.length) {
  const res = await runJobs({
    goal: "e-prep-render",
    concurrency: Math.max(1, Math.min(CONCURRENCY, 4)),
    jobs: needRender.map((r) => ({
      key: r.content_sha,
      run: async () => { await ensureRendered(r); rendered += r.pages || 0; },
    })),
  });
  console.log(`  구움 ${res.done} 문서 · 실패 ${res.failed}`);
}

// --- 2. 잉크맵 (선택) --------------------------------------------------------
let inkMade = 0;
if (doInk) {
  const jobs = [];
  for (const sha of readdirSync(DIR.render)) {
    const dir = path.join(DIR.render, sha);
    if (!bySha.has(sha)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".png")) continue;
      const page = pageOf(f);
      if (page == null) continue;
      const out = inkPath(sha, page);
      jobs.push({ key: `${sha}-${page}`, out, run: async () => { makeInkMap(path.join(dir, f), sha, page); inkMade++; } });
    }
  }
  const res = await runJobs({ goal: "e-prep-ink", concurrency: Math.max(1, CONCURRENCY), jobs });
  console.log(`  잉크맵 ${res.done} 장 · 건너뜀 ${res.skipped} · 실패 ${res.failed}`);
}

writeReport("e-prep", {
  "요약": {
    "렌더 없던 문서": needRender.length, "새로 구운 쪽": rendered,
    "잉크맵 새로 만든 장": inkMade,
  },
  "다음": ["- `npm run e:scan` 으로 새로 구운 쪽을 스캔에 반영하세요.",
    "- 그 다음 `npm run e:next -- --n 10`."],
});
