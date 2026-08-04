/**
 * 사용량·비용 집계. reports/usage.jsonl 을 읽습니다.
 *
 *   node scripts/cost.mjs               누적 전체
 *   node scripts/cost.mjs --today       오늘만
 *   node scripts/cost.mjs --project     남은 전량 실행 비용 추정
 *
 * 단가는 .env 의 PRICE_IN / PRICE_OUT (백만 토큰당 USD) 로 덮어쓸 수 있습니다.
 * 기본값은 gpt-5.6-luna 기준입니다 (2026-07-30 인하 반영).
 */
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { select, totalPages } from "../lib/manifest.mjs";
import { readJSONL, arg } from "../lib/jobs.mjs";

const PRICE_IN = Number(process.env.PRICE_IN ?? 0.20);   // USD / 1M input
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 1.20); // USD / 1M output
const PRICE_CACHED = Number(process.env.PRICE_CACHED ?? 0.02);

const rows = readJSONL(path.join(DIR.reports, "usage.jsonl"));
const today = new Date().toISOString().slice(0, 10);
const scope = arg("today") ? rows.filter((r) => r.t?.startsWith(today)) : rows;

const usd = (n) => `$${n.toFixed(2)}`;
const m = (n) => (n / 1e6).toFixed(2) + "M";

function cost(rs) {
  const cached = rs.reduce((n, r) => n + (r.cached ?? 0), 0);
  const inTok = rs.reduce((n, r) => n + (r.in ?? 0), 0) - cached;
  const outTok = rs.reduce((n, r) => n + (r.out ?? 0), 0);
  return {
    calls: rs.length, inTok, outTok, cached,
    usd: (inTok / 1e6) * PRICE_IN + (outTok / 1e6) * PRICE_OUT + (cached / 1e6) * PRICE_CACHED,
  };
}

if (!rows.length) {
  console.log("reports/usage.jsonl 이 없습니다.");
  console.log("이 로그는 지금부터 쌓입니다. 이전 실행분은 기록되지 않았습니다.");
} else {
  const all = cost(scope);
  console.log(`── 사용량 ${arg("today") ? "(오늘)" : "(누적)"} ───────────────`);
  console.log(`  호출 ${all.calls.toLocaleString()}회`);
  console.log(`  입력 ${m(all.inTok)} (캐시 ${m(all.cached)}) · 출력 ${m(all.outTok)}`);
  console.log(`  비용 ${usd(all.usd)}   @ 입력 $${PRICE_IN}/M · 출력 $${PRICE_OUT}/M`);

  const byTag = new Map();
  for (const r of scope) {
    const k = r.tag ?? "text";
    if (!byTag.has(k)) byTag.set(k, []);
    byTag.get(k).push(r);
  }
  console.log(`\n  단계별`);
  for (const [k, rs] of [...byTag].sort((a, b) => cost(b[1]).usd - cost(a[1]).usd)) {
    const c = cost(rs);
    console.log(`    ${k.padEnd(10)} ${String(c.calls).padStart(6)}회  ${usd(c.usd).padStart(8)}`);
  }
}

if (arg("project")) {
  // 아직 L1 이 없는 vision 쪽 기준
  const visionPages = totalPages(select({ route: "vision" }));
  const done = readJSONL(path.join(DIR.reports, "usage.jsonl")).filter((r) => r.tag === "text").length;
  const remain = Math.max(0, visionPages - done);
  // 실측 평균: 입력 3,400 / 출력 2,500 (밀집 도해는 5,500 이상)
  const inT = remain * 3400, outT = remain * 2500;
  const est = (inT / 1e6) * PRICE_IN + (outT / 1e6) * PRICE_OUT;
  console.log(`\n── 남은 전량 실행 추정 ─────────────────`);
  console.log(`  vision 총 ${visionPages.toLocaleString()}쪽 · 남은 ${remain.toLocaleString()}쪽`);
  console.log(`  입력 ${m(inT)} · 출력 ${m(outT)}`);
  console.log(`  추정 ${usd(est)}  (밀집 도해 비중에 따라 ±50%)`);
  console.log(`\n  ⚠ 이 비용은 OpenAI API 키에 청구됩니다.`);
  console.log(`    Codex 구독 무제한과 별개입니다. Codex 가 npm run g5 를 실행해도`);
  console.log(`    스크립트가 LLM_API_KEY 로 직접 호출하므로 그대로 과금됩니다.`);
}
