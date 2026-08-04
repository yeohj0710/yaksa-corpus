/**
 * 에이전트 전사 — 검증. **API 를 쓰지 않습니다.**
 *
 *   node scripts/agent-check.mjs
 *   node scripts/agent-check.mjs --subject law
 *
 * 에이전트가 쓴 L1 파일이 규칙을 지켰는지 기계적으로 봅니다.
 * 내용의 정확도는 여기서 못 잡습니다. 그건 사람이 표본으로 봐야 합니다.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { select, totalPages } from "../lib/manifest.mjs";
import { writeReport, arg } from "../lib/jobs.mjs";

const subject = arg("subject");
const rows = select({ route: "vision", ...(subject ? { subject } : {}) });

const REQUIRED = ["sha", "page", "source_key", "subject_key"];
const problems = [];
let done = 0, pending = 0, bytes = 0;
const bySubject = new Map();

for (const r of rows) {
  const dir = path.join(DIR.l1, r.content_sha);
  let ok = 0;
  for (let p = 1; p <= (r.pages || 0); p++) {
    const f = path.join(dir, `p-${String(p).padStart(4, "0")}.md`);
    if (!existsSync(f)) { pending++; continue; }
    const txt = readFileSync(f, "utf8");
    bytes += statSync(f).size;

    const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) { problems.push({ f, why: "프론트매터 없음" }); continue; }
    const miss = REQUIRED.filter((k) => !new RegExp(`^${k}:`, "m").test(fm[1]));
    if (miss.length) { problems.push({ f, why: `프론트매터 누락: ${miss.join(",")}` }); continue; }
    if (!new RegExp(`^sha:\\s*${r.content_sha}\\s*$`, "m").test(fm[1])) {
      problems.push({ f, why: "sha 불일치" }); continue;
    }
    if (!new RegExp(`^page:\\s*${p}\\s*$`, "m").test(fm[1])) {
      problems.push({ f, why: "page 불일치" }); continue;
    }
    const body = txt.slice(fm[0].length).trim();
    // 빈 파일이 조용히 통과하면 그 쪽은 영영 비어 있게 됩니다.
    if (body.length < 40) { problems.push({ f, why: `본문 ${body.length}자 — 사실상 빔` }); continue; }
    // 모델이 "죄송합니다" 류를 쓴 경우
    if (/^(죄송|미안|I'm sorry|I cannot|Sorry)/i.test(body)) {
      problems.push({ f, why: "거부 응답이 저장됨" }); continue;
    }
    ok++; done++;
  }
  const v = bySubject.get(r.subject_key) ?? [0, 0];
  bySubject.set(r.subject_key, [v[0] + ok, v[1] + (r.pages || 0)]);
}

const total = totalPages(rows);
const pct = total ? ((done / total) * 100).toFixed(1) : "0.0";
console.log(`진행 ${done.toLocaleString()}/${total.toLocaleString()}쪽 (${pct}%) · 남음 ${pending.toLocaleString()} · 문제 ${problems.length}`);
console.log(`평균 길이 ${done ? Math.round(bytes / done).toLocaleString() : 0}바이트/쪽`);

console.log(`\n과목별`);
for (const [k, [ok, tot]] of [...bySubject].sort((a, b) => b[1][1] - a[1][1])) {
  const bar = "█".repeat(Math.round((ok / Math.max(tot, 1)) * 20)).padEnd(20, "·");
  console.log(`  ${k.padEnd(16)} ${bar} ${String(ok).padStart(5)}/${String(tot).padEnd(5)}`);
}

if (problems.length) {
  console.log(`\n문제 ${problems.length}건 (앞 10개)`);
  for (const p of problems.slice(0, 10)) console.log(`  ${p.why} — ${path.relative(DIR.l1, p.f)}`);
}

writeReport("agent-check", {
  "요약": { "대상 쪽": total, "완료": done, "남음": pending, "문제": problems.length,
            "진행률": `${pct}%`, "평균 길이": done ? `${Math.round(bytes / done)}B` : "0B" },
  "과목별": ["| 과목 | 완료 | 전체 |", "|---|---:|---:|",
    ...[...bySubject].sort((a, b) => b[1][1] - a[1][1]).map(([k, [o, t]]) => `| ${k} | ${o} | ${t} |`)],
  "문제": problems.length ? problems.slice(0, 40).map((p) => `- ${p.why} — ${path.relative(DIR.l1, p.f)}`) : ["없음"],
});

process.exit(problems.length ? 1 : 0);
