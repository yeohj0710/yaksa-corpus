/**
 * G-A2 — 강조 표본 육안 검사. **API 를 쓰지 않습니다.**
 *
 *   npm run e:spotcheck                      과목마다 3쪽
 *   npm run e:spotcheck -- --n 5
 *   npm run e:spotcheck -- --subject law
 *   npm run e:spotcheck -- --none            "강조없음"으로 넘긴 쪽만 봅니다
 *
 * 기계는 "색이 있는데 마커가 0개"까지만 잡습니다. 색이 있는 자리와 마커가 붙은 자리가
 * 같은지는 못 봅니다. 그건 눈으로 봐야 합니다. 잉크맵에서 색이 칠해진 낱말과
 * 오른쪽 본문에서 굵게·형광·밑줄이 붙은 낱말이 같은지 확인하세요.
 *
 * 산출: reports/samples/e-spotcheck.html  (gitignore 대상 — 원문이 들어갑니다)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { loadManifest } from "../lib/manifest.mjs";
import { splitFrontMatter, countMarks, makeInkMap, inkPath } from "../lib/emphasis.mjs";
import { markPath } from "../lib/emphasis-paths.mjs";
import { ensureDir, readJSONL, arg } from "../lib/jobs.mjs";
import { pageOf } from "../lib/pdf.mjs";

const N = Number(arg("n", 3));
const onlySubject = arg("subject");
const onlyNone = !!arg("none");
const SCAN = path.join(DIR.data, "emphasis-scan.jsonl");

const bySha = new Map();
for (const r of loadManifest()) if (r.is_primary) bySha.set(r.content_sha, r);

const pool = new Map();
for (const s of readJSONL(SCAN)) {
  if (s.err || s.level === "없음") continue;
  const row = bySha.get(s.sha);
  if (!row) continue;
  if (onlySubject && row.subject_key !== onlySubject) continue;
  const mp = markPath(s.sha, s.page);
  if (!existsSync(mp)) continue;
  let rec; try { rec = JSON.parse(readFileSync(mp, "utf8")); } catch { continue; }
  const empty = !Array.isArray(rec.marks) || !rec.marks.length;
  if (onlyNone !== empty) continue;
  const md = path.join(DIR.l1, s.sha, `p-${String(s.page).padStart(4, "0")}.md`);
  if (!existsSync(md)) continue;
  if (!pool.has(row.subject_key)) pool.set(row.subject_key, []);
  pool.get(row.subject_key).push({ row, s, md, rec });
}

/** 결정적 표본. 같은 인자면 같은 쪽이 나옵니다. */
function pick(arr, n, seed) {
  const out = [];
  let x = seed;
  const p = [...arr];
  while (out.length < n && p.length) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out.push(p.splice(x % p.length, 1)[0]);
  }
  return out;
}

const samples = [];
let seed = 20260808;
for (const [, list] of pool) samples.push(...pick(list, N, seed += 7));
if (!samples.length) {
  console.log(onlyNone ? "강조없음으로 넘긴 쪽이 없습니다." : "검토가 끝난 쪽이 없습니다. `npm run e:next` 부터 하세요.");
  process.exit(0);
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/** 마커를 HTML 로 바꿔 눈에 띄게 보여줍니다. */
function render(body) {
  return esc(body)
    .replace(/&lt;mark&gt;([\s\S]*?)&lt;\/mark&gt;/g, '<em class="hl">$1</em>')
    .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<em class="ul">$1</em>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<em class="bo">$1</em>');
}

const cards = samples.map((x, i) => {
  const { row, s, md, rec } = x;
  const dir = path.join(DIR.render, s.sha);
  const png = existsSync(dir) ? readdirSync(dir).find((f) => pageOf(f) === s.page) : null;
  const src = png ? path.join(dir, png) : null;
  let ink = null;
  if (src) { try { ink = makeInkMap(src, s.sha, s.page); } catch { ink = inkPath(s.sha, s.page); } }
  const { body } = splitFrontMatter(readFileSync(md, "utf8"));
  const c = countMarks(body);
  const none = !Array.isArray(rec.marks) || !rec.marks.length;
  const url = (p) => `file:///${String(p).replace(/\\/g, "/")}`;
  return `
<section>
  <h2>${i + 1}. ${esc(row.subject_key)} · ${esc(row.material_type)} · ${s.page}/${row.pages}쪽
    <span class="tag">${esc(s.level)}</span>
    ${none ? `<span class="tag warn">강조없음: ${esc(rec.none || "이유 없음")}</span>`
      : `<span class="tag ok">색 ${c.color} · 형광 ${c.hl} · 밑줄 ${c.underline}</span>`}
    <span class="tag">탐지 글자꼴 색 ${s.textInk ?? "?"} · 형광 ${s.textHl ?? "?"}</span>
  </h2>
  <div class="meta">${esc(s.sha)} — ${esc(row.source_key)}</div>
  <div class="pair">
    <div class="img">
      ${ink && existsSync(ink) ? `<img src="${url(ink)}" loading="lazy" title="잉크맵">` : "<p>잉크맵 없음</p>"}
      ${src ? `<details><summary>원본 보기</summary><img src="${url(src)}" loading="lazy"></details>` : ""}
    </div>
    <div class="txt"><pre>${render(body)}</pre></div>
  </div>
</section>`;
}).join("\n");

const html = `<!doctype html><meta charset="utf-8"><title>강조 표본 검사</title>
<style>
 body{font:14px/1.6 system-ui,'Malgun Gothic',sans-serif;margin:0;background:#f6f6f7;color:#111}
 header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px 20px;z-index:9}
 h1{font-size:16px;margin:0 0 4px}
 .hint{color:#666;font-size:13px}
 section{background:#fff;margin:16px;border:1px solid #e2e2e5;border-radius:8px;overflow:hidden}
 h2{font-size:14px;margin:0;padding:10px 14px;background:#fafafa;border-bottom:1px solid #eee}
 .meta{font-size:12px;color:#777;padding:6px 14px}
 .tag{font-size:11px;padding:2px 6px;border-radius:4px;background:#eef;color:#334;margin-left:6px;font-weight:400}
 .tag.ok{background:#dcfce7;color:#14532d}
 .tag.warn{background:#fde68a;color:#78350f}
 .pair{display:grid;grid-template-columns:1fr 1fr}
 .img{border-right:1px solid #eee;padding:10px}
 .img img{width:100%;height:auto;border:1px solid #eee}
 details{margin-top:8px} summary{cursor:pointer;font-size:12px;color:#555}
 .txt{padding:10px;overflow:auto;max-height:92vh}
 pre{white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,Consolas,monospace;margin:0}
 em{font-style:normal}
 em.bo{font-weight:700;color:#b91c1c}
 em.hl{background:#fde68a;border-radius:2px}
 em.ul{text-decoration:underline;text-decoration-thickness:2px}
</style>
<header>
  <h1>강조 표본 검사 — ${samples.length}쪽${onlyNone ? " (강조없음으로 넘긴 쪽)" : ""}</h1>
  <div class="hint">
    왼쪽 <b>잉크맵</b>에서 색이 칠해진 낱말과, 오른쪽 본문에서 <em class="bo">굵게</em>·<em class="hl">형광</em>·<em class="ul">밑줄</em>이
    붙은 낱말이 같은지 봅니다. 본문 글자 자체는 이 단계에서 바뀌지 않습니다(지문으로 잠겨 있습니다).
    틀린 쪽은 <code>emphasis/{sha}/p-NNNN.json</code> 을 고치고 <code>npm run e:apply</code> 를 다시 돌리세요.
  </div>
</header>
${cards}`;

const out = path.join(DIR.reports, "samples", onlyNone ? "e-spotcheck-none.html" : "e-spotcheck.html");
ensureDir(path.dirname(out));
writeFileSync(out, html, "utf8");

const agg = new Map();
for (const x of samples) agg.set(x.row.subject_key, (agg.get(x.row.subject_key) ?? 0) + 1);
console.log(`표본 ${samples.length}쪽`);
for (const [k, n] of [...agg].sort()) console.log(`  ${k.padEnd(16)} ${n}쪽`);
console.log(`\n열기: ${out}`);
