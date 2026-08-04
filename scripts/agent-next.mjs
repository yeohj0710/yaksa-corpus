/**
 * 에이전트 전사 — 할 일 받기. **API 를 쓰지 않습니다.**
 *
 *   node scripts/agent-next.mjs                 다음 10쪽
 *   node scripts/agent-next.mjs --n 25
 *   node scripts/agent-next.mjs --subject law
 *
 * 왜 이 방식인가
 *   파이프라인이 LLM_API_KEY 로 직접 호출하면 에이전트가 돌릴 때마다 과금됩니다.
 *   대신 여기서는 "어떤 PNG 를 읽고 어디에 쓸지"만 알려줍니다.
 *   에이전트(Codex)가 자기 눈으로 이미지를 읽고 마크다운을 직접 씁니다. 구독으로 커버됩니다.
 *
 * 에이전트가 할 일
 *   1. 아래 목록의 png 를 읽는다
 *   2. 전사 규칙(아래 출력됨)대로 마크다운을 만든다
 *   3. 지정된 out 경로에 프론트매터를 붙여 저장한다
 *   4. `node scripts/agent-check.mjs` 로 검증한다
 *   5. 남은 게 있으면 1번으로 돌아간다
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { select } from "../lib/manifest.mjs";
import { ensureRendered } from "../lib/render.mjs";
import { arg } from "../lib/jobs.mjs";
import { TRANSCRIBE_SYSTEM } from "../lib/prompts.mjs";

const N = Number(arg("n", 10));
const subject = arg("subject");
const showRules = !arg("no-rules");

let rows = select({ route: "vision", ...(subject ? { subject } : {}) });

// 아직 L1 이 없는 쪽만 고릅니다. 순서: 가이드 → 주교재 → 요약 → 나머지
const ORDER = ["study-guide", "d-grade-list", "textbook", "summary", "subtext", "workbook", "study-aid", "mnemonic", "etc"];
rows.sort((a, b) => (ORDER.indexOf(a.material_type) + 99) % 99 - (ORDER.indexOf(b.material_type) + 99) % 99);

const todo = [];
let pendingTotal = 0;
for (const r of rows) {
  const dir = path.join(DIR.l1, r.content_sha);
  for (let p = 1; p <= (r.pages || 0); p++) {
    const out = path.join(dir, `p-${String(p).padStart(4, "0")}.md`);
    if (existsSync(out)) continue;
    pendingTotal++;
    if (todo.length < N) todo.push({ r, page: p, out });
  }
}

if (!todo.length) {
  console.log("남은 쪽이 없습니다. `node scripts/agent-check.mjs` 로 확인하세요.");
  process.exit(0);
}

// 이번 배치에 필요한 PNG 만 굽습니다(회전 보정 포함). LLM 호출 없음.
const packets = [];
for (const t of todo) {
  const pages = await ensureRendered(t.r);
  const png = pages.get(t.page);
  packets.push({ ...t, png });
}

console.log(`# 전사 작업 ${packets.length}쪽 (남은 전체 ${pendingTotal.toLocaleString()}쪽)`);
console.log(`# API 를 쓰지 않습니다. 에이전트가 직접 이미지를 읽고 파일을 쓰세요.\n`);

if (showRules) {
  console.log("## 전사 규칙\n");
  console.log(TRANSCRIBE_SYSTEM);
  console.log("\n## 각 파일 맨 앞에 붙일 프론트매터\n");
  console.log("```yaml");
  console.log("---\nsha: <sha>\npage: <page>\npages_total: <total>\nsource_key: <source_key>\nsubject_key: <subject_key>\nmaterial_type: <material_type>\nextract_route: agent\n---");
  console.log("```\n");
}

console.log("## 할 일\n");
for (const p of packets) {
  console.log(`### ${p.r.subject_key} / ${p.r.material_type} — ${p.page}/${p.r.pages}쪽`);
  console.log(`읽기: ${p.png}`);
  console.log(`쓰기: ${p.out}`);
  console.log(`프론트매터: sha=${p.r.content_sha} page=${p.page} pages_total=${p.r.pages} source_key=${p.r.source_key} subject_key=${p.r.subject_key} material_type=${p.r.material_type}`);
  console.log("");
}
console.log(`전부 쓴 뒤: node scripts/agent-check.mjs`);
