/**
 * 전량 실행 드라이버. 무인으로 며칠 돌리는 용도입니다.
 *
 *   node scripts/run-all.mjs                    처음부터 끝까지
 *   node scripts/run-all.mjs --limit-usd 25     비용 상한 (기본 30)
 *   node scripts/run-all.mjs --from g5-vision   특정 단계부터
 *   node scripts/run-all.mjs --dry              무엇을 돌릴지만 출력
 *
 * 설계
 *  - 단계를 **순차**로 돕니다. 동시에 돌리면 429 가 몰려 양쪽 다 죽습니다.
 *  - 모든 단계가 재개 가능합니다. 죽으면 같은 명령을 다시 치면 됩니다.
 *  - 단계 사이마다 비용을 확인하고 상한을 넘으면 **멈춥니다.**
 *  - 게이트 실패는 멈춤 사유입니다. 다음 단계로 넘어가지 않습니다.
 *  - 진행 상황은 reports/run-all.log 에 남습니다.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { DIR, SUBJECTS } from "../lib/config.mjs";
import { readJSONL, ensureDir, arg } from "../lib/jobs.mjs";

const LIMIT_USD = Number(arg("limit-usd", 30));
const FROM = arg("from");
const DRY = !!arg("dry");
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.20);
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 1.20);

ensureDir(DIR.reports);
const LOG = path.join(DIR.reports, "run-all.log");
function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  console.log(s);
  try { appendFileSync(LOG, s + "\n", "utf8"); } catch {}
}

function spentUSD() {
  const rows = readJSONL(path.join(DIR.reports, "usage.jsonl"));
  const cached = rows.reduce((n, r) => n + (r.cached ?? 0), 0);
  const i = rows.reduce((n, r) => n + (r.in ?? 0), 0) - cached;
  const o = rows.reduce((n, r) => n + (r.out ?? 0), 0);
  return (i / 1e6) * PRICE_IN + (o / 1e6) * PRICE_OUT;
}

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: "inherit", cwd: path.join(DIR.reports, "..") });
    p.on("close", (code) => resolve(code ?? 1));
  });
}

// 순서가 중요합니다. 회전 감사가 렌더보다 먼저여야 눕힌 페이지를 세워서 굽습니다.
const STAGES = [
  { id: "rotation", desc: "회전 감사 + 캐시 무효화", args: ["scripts/audit-rotation.mjs", "--purge"], gate: false },
  { id: "render",   desc: "렌더 캐시 6,210쪽 (LLM 없음)", args: ["scripts/g1-render.mjs"], gate: true },
  { id: "l1-text",  desc: "CLEAN 945쪽 전사 (LLM 없음)", args: ["scripts/g5-l1.mjs", "--route", "pdftotext"], gate: true },
  ...SUBJECTS.map((s) => ({
    id: `l1-${s.key}`,
    desc: `L1 비전 전사 — ${s.folder}`,
    args: ["scripts/g5-l1.mjs", "--route", "vision", "--subject", s.key],
    gate: true, costly: true,
  })),
  { id: "accuracy", desc: "전사 정확도 측정", args: ["scripts/accuracy.mjs", "--n", "60"], gate: false, costly: true },
  { id: "verify",   desc: "게이트 전량", args: ["scripts/verify.mjs"], gate: true },
];

let stages = STAGES;
if (FROM) {
  const i = STAGES.findIndex((s) => s.id === FROM);
  if (i === -1) { console.error(`--from ${FROM} 은 없는 단계입니다. 목록:\n  ${STAGES.map((s) => s.id).join("\n  ")}`); process.exit(1); }
  stages = STAGES.slice(i);
}

if (DRY) {
  console.log(`실행할 단계 ${stages.length}개 (비용 상한 $${LIMIT_USD})`);
  for (const s of stages) console.log(`  ${s.costly ? "$" : " "} ${s.id.padEnd(20)} ${s.desc}`);
  process.exit(0);
}

log(`시작 — 단계 ${stages.length}개, 비용 상한 $${LIMIT_USD}`);
for (const s of stages) {
  const before = spentUSD();
  if (s.costly && before >= LIMIT_USD) {
    log(`중단: 비용 상한 도달 ($${before.toFixed(2)} >= $${LIMIT_USD}). 남은 단계 건너뜀.`);
    log(`계속하려면: node scripts/run-all.mjs --from ${s.id} --limit-usd <더 큰 값>`);
    process.exit(2);
  }
  log(`▶ ${s.id} — ${s.desc}`);
  const code = await run(s.args);
  const after = spentUSD();
  log(`◀ ${s.id} 종료코드 ${code} · 이 단계 $${(after - before).toFixed(2)} · 누적 $${after.toFixed(2)}`);

  if (code !== 0 && s.gate) {
    log(`중단: ${s.id} 게이트 실패. reports/ 를 확인하고 고친 뒤 다시 돌리세요.`);
    log(`재개: node scripts/run-all.mjs --from ${s.id}`);
    process.exit(1);
  }
}
log(`완료 — 누적 $${spentUSD().toFixed(2)}`);
