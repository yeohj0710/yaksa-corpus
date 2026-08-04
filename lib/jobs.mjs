/**
 * 재개 가능한 작업 러너. 이 파일이 파이프라인의 핵심입니다.
 *
 * 규칙
 *  1. 산출물이 이미 있으면 건너뜁니다.
 *  2. 하나가 실패해도 전체를 멈추지 않습니다. quarantine 에 남기고 넘어갑니다.
 *  3. 두 번 돌려도 같은 결과가 나옵니다.
 */
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "./config.mjs";

export function ensureDir(d) {
  mkdirSync(d, { recursive: true });
  return d;
}

export function readJSON(f, fallback = null) {
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fallback; }
}

export function writeJSON(f, obj) {
  ensureDir(path.dirname(f));
  writeFileSync(f, JSON.stringify(obj, null, 1), "utf8");
}

export function writeJSONL(f, rows) {
  ensureDir(path.dirname(f));
  writeFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

export function readJSONL(f) {
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function quarantine(goal, entry) {
  ensureDir(DIR.reports);
  appendFileSync(path.join(DIR.reports, "quarantine.jsonl"),
    JSON.stringify({ goal, at: new Date().toISOString(), ...entry }) + "\n", "utf8");
}

/**
 * 작업 목록을 동시 실행합니다.
 *
 * @param {object} o
 * @param {string} o.goal                 리포트·quarantine 라벨
 * @param {Array}  o.jobs                 [{ key, out, run }]  out 이 있으면 존재 여부로 건너뜁니다
 * @param {number} o.concurrency
 * @param {boolean} o.force               true 면 건너뛰기 없이 다시 만듭니다
 * @returns {Promise<{done,skipped,failed,results}>}
 */
export async function runJobs({ goal, jobs, concurrency = 4, force = false, onProgress }) {
  const stat = { total: jobs.length, done: 0, skipped: 0, failed: 0 };
  const results = [];
  let cursor = 0;
  const started = Date.now();

  const tick = () => {
    const n = stat.done + stat.skipped + stat.failed;
    if (n % 10 === 0 || n === stat.total) {
      const el = (Date.now() - started) / 1000;
      const rate = n / Math.max(el, 0.001);
      const eta = rate > 0 ? Math.round((stat.total - n) / rate) : 0;
      process.stdout.write(
        `\r  ${goal}  ${n}/${stat.total}  완료 ${stat.done} 건너뜀 ${stat.skipped} 실패 ${stat.failed}  ETA ${eta}s   `,
      );
    }
    onProgress?.(stat);
  };

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!force && job.out && existsSync(job.out)) {
        stat.skipped++; results.push({ key: job.key, skipped: true }); tick(); continue;
      }
      try {
        const value = await job.run();
        results.push({ key: job.key, value });
        stat.done++;
      } catch (err) {
        if (err?.stopPipeline) throw err;
        stat.failed++;
        quarantine(goal, { key: job.key, error: String(err?.message ?? err).slice(0, 300) });
        results.push({ key: job.key, error: String(err?.message ?? err) });
      }
      tick();
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  process.stdout.write("\n");
  return { ...stat, results };
}

/** 리포트 저장. 수치와 상태만 남깁니다. 원문·파일명 본문은 넣지 않습니다. */
export function writeReport(goal, sections) {
  ensureDir(DIR.reports);
  const lines = [`# ${goal}`, "", `생성: ${new Date().toISOString()}`, ""];
  for (const [title, body] of Object.entries(sections)) {
    lines.push(`## ${title}`, "");
    if (Array.isArray(body)) lines.push(...body.map(String));
    else if (typeof body === "object" && body) {
      lines.push("| 항목 | 값 |", "|---|---:|");
      for (const [k, v] of Object.entries(body)) lines.push(`| ${k} | ${v} |`);
    } else lines.push(String(body));
    lines.push("");
  }
  const f = path.join(DIR.reports, `${goal}.md`);
  writeFileSync(f, lines.join("\n"), "utf8");
  console.log(`  리포트: ${path.relative(process.cwd(), f)}`);
  return f;
}

export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}
