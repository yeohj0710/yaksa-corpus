/**
 * G-B — 표본 육안 검사. 원본 PNG 와 전사 결과를 나란히 놓습니다.
 *
 *   node scripts/spotcheck.mjs                    과목마다 3쪽
 *   node scripts/spotcheck.mjs --n 5
 *   node scripts/spotcheck.mjs --subject law --n 10
 *   node scripts/spotcheck.mjs --dense            밀집 다단·회전 문서 위주로
 *
 * 왜 필요한가
 *   형식 검사(agent-check)는 프론트매터와 빈 파일만 잡습니다.
 *   내용이 바뀐 건 못 잡습니다. 실제로 확인된 사례:
 *     뇌교수초용해 → 말초신경염,  폐렴 → 폐암,  갑상선질환 → 암성질환
 *   구조가 맞아도 항목이 바뀌면 국시 자료로 못 씁니다. 사람 눈이 유일한 방법입니다.
 *
 * 산출: reports/samples/spotcheck.html  (gitignore 대상 — 원문이 들어갑니다)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { select } from "../lib/manifest.mjs";
import { ensureDir, readJSON, arg } from "../lib/jobs.mjs";

const N = Number(arg("n", 3));
const onlySubject = arg("subject");
const denseOnly = !!arg("dense");

// 회전 문서 목록이 있으면 밀집·위험 문서 판단에 씁니다.
const rotated = new Set((readJSON(path.join(DIR.data, "rotated.json"), []) ?? []).map((r) => r.sha));

let rows = select({ route: "vision", ...(onlySubject ? { subject: onlySubject } : {}) });
if (denseOnly) {
  rows = rows.filter((r) => rotated.has(r.content_sha) ||
    ["textbook", "summary", "subtext"].includes(r.material_type));
}

/** 결정적 의사난수 — 같은 인자로 돌리면 같은 표본이 나옵니다. */
function pick(arr, n, seed) {
  const out = [];
  let s = seed;
  const pool = [...arr];
  while (out.length < n && pool.length) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}

const bySubject = new Map();
for (const r of rows) {
  const dir = path.join(DIR.l1, r.content_sha);
  if (!existsSync(dir)) continue;
  for (let p = 1; p <= (r.pages || 0); p++) {
    const md = path.join(dir, `p-${String(p).padStart(4, "0")}.md`);
    if (!existsSync(md)) continue;
    if (!bySubject.has(r.subject_key)) bySubject.set(r.subject_key, []);
    bySubject.get(r.subject_key).push({ r, page: p, md });
  }
}

const samples = [];
let seed = 20260804;
for (const [key, list] of bySubject) samples.push(...pick(list, N, seed += 7));
if (!samples.length) { console.log("전사된 쪽이 없습니다."); process.exit(0); }

function pngFor(r, page) {
  const dir = path.join(DIR.render, r.content_sha);
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => {
    const m = f.match(/-(\d+)\.png$/);
    return m && Number(m[1]) === page;
  });
  return hit ? path.join(dir, hit) : null;
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const cards = samples.map((s, i) => {
  const png = pngFor(s.r, s.page);
  const txt = readFileSync(s.md, "utf8");
  const body = txt.replace(/^---[\s\S]*?---\n/, "");
  const flag = rotated.has(s.r.content_sha) ? '<span class="flag">회전 보정본</span>' : "";
  return `
<section id="s${i}">
  <h2>${i + 1}. ${esc(s.r.subject_key)} · ${esc(s.r.material_type)} · ${s.page}/${s.r.pages}쪽 ${flag}</h2>
  <div class="meta">${esc(s.r.source_key)}</div>
  <div class="pair">
    <div class="img">${png ? `<img src="file:///${png.replace(/\\/g, "/")}" loading="lazy">` : "<p>렌더 없음</p>"}</div>
    <div class="txt"><pre>${esc(body)}</pre></div>
  </div>
</section>`;
}).join("\n");

const html = `<!doctype html><meta charset="utf-8"><title>전사 표본 검사</title>
<style>
 body{font:14px/1.6 system-ui,'Malgun Gothic',sans-serif;margin:0;background:#f6f6f7;color:#111}
 header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px 20px;z-index:9}
 h1{font-size:16px;margin:0 0 4px}
 .hint{color:#666;font-size:13px}
 section{background:#fff;margin:16px;border:1px solid #e2e2e5;border-radius:8px;overflow:hidden}
 h2{font-size:14px;margin:0;padding:10px 14px;background:#fafafa;border-bottom:1px solid #eee}
 .meta{font-size:12px;color:#777;padding:6px 14px}
 .flag{background:#fde68a;color:#78350f;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:6px}
 .pair{display:grid;grid-template-columns:1fr 1fr;gap:0}
 .img{border-right:1px solid #eee;padding:10px;background:#fff}
 .img img{width:100%;height:auto;border:1px solid #eee}
 .txt{padding:10px;overflow:auto;max-height:90vh}
 pre{white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,Consolas,monospace;margin:0}
 @media (max-width:1100px){.pair{grid-template-columns:1fr}.img{border-right:0;border-bottom:1px solid #eee}}
</style>
<header>
  <h1>전사 표본 검사 — ${samples.length}쪽</h1>
  <div class="hint">
    왼쪽 원본과 오른쪽 전사를 비교하세요. <b>고유명사·질환명·약물명·숫자</b>만 봅니다.
    구조가 맞아도 항목이 바뀌면 못 씁니다. 확인된 치환: 뇌교수초용해→말초신경염, 폐렴→폐암.
    틀린 쪽은 해당 <code>.md</code> 를 지우고 다시 전사하세요.
  </div>
</header>
${cards}`;

const out = path.join(DIR.reports, "samples", "spotcheck.html");
ensureDir(path.dirname(out));
writeFileSync(out, html, "utf8");

const byS = new Map();
for (const s of samples) byS.set(s.r.subject_key, (byS.get(s.r.subject_key) ?? 0) + 1);
console.log(`표본 ${samples.length}쪽`);
for (const [k, n] of [...byS].sort()) console.log(`  ${k.padEnd(16)} ${n}쪽`);
console.log(`\n열기: ${out}`);
console.log(`회전 보정본 표본: ${samples.filter((s) => rotated.has(s.r.content_sha)).length}쪽`);
