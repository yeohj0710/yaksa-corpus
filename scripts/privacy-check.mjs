/**
 * 유출 검사. 저장소는 공개이고 자료는 비공개이므로, 추적 파일에
 * 자료 경로·개인정보·자격증명·추출물이 섞였는지 확인합니다.
 *
 *   node scripts/privacy-check.mjs            추적 파일 + staged diff
 *   node scripts/privacy-check.mjs --history  전체 커밋 이력
 *
 * 위반 종류와 파일 경로만 출력합니다. 일치한 원문은 출력하지 않습니다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const history = process.argv.includes("--history");

const RULES = [
  { id: "local-path",   re: /[A-Za-z]:\\(?:Users|dev)\\/,               desc: "로컬 절대 경로" },
  { id: "drive-path",   re: /[A-Za-z]:\\내 드라이브|\/내 드라이브\//,      desc: "드라이브 자료 경로" },
  { id: "korean-name",  re: /여형준|hjyeo/i,                            desc: "개인 식별 정보" },
  { id: "api-key",      re: /\b(?:sk-[A-Za-z0-9_-]{20,}|gho_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})/, desc: "자격증명" },
  { id: "drive-id",     re: /\b[A-Za-z0-9_-]{28,44}\b(?=.*(?:driveFileId|drive_file_id|fileId))/, desc: "드라이브 파일 ID" },
  { id: "study-ext",    re: /\.(?:pdf|mp3|m4a|xlsx|goodnotes)\b/i,      desc: "학습자료 파일", pathOnly: true },
  { id: "output-dir",   re: /^(?:data|render|l1|l2)\//,                 desc: "추출물 디렉터리", pathOnly: true },
];

const ALLOW = [
  ".env.example",       // 빈 값만 들어 있음
  "scripts/privacy-check.mjs", // 이 파일이 패턴 자체를 담고 있음
];

function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
}

const violations = [];
function scan(file, text, where) {
  if (ALLOW.includes(file)) return;
  for (const r of RULES) {
    const target = r.pathOnly ? file : text;
    if (r.re.test(target)) violations.push({ rule: r.id, desc: r.desc, file, where });
  }
}

// 1) 추적 파일
const tracked = git(["ls-files"]).split("\n").filter(Boolean);
for (const f of tracked) {
  const p = path.join(REPO, f);
  if (!existsSync(p)) continue;
  let text = "";
  try { text = readFileSync(p, "utf8"); } catch { continue; }
  scan(f, text, "tracked");
}

// 2) staged diff
try {
  const staged = git(["diff", "--cached", "--unified=0"]);
  if (staged.trim()) scan("(staged diff)", staged, "staged");
} catch {}

// 3) 전체 이력
if (history) {
  const files = new Set(git(["log", "--all", "--pretty=format:", "--name-only"]).split("\n").filter(Boolean));
  for (const f of files) {
    for (const r of RULES.filter((x) => x.pathOnly)) {
      if (r.re.test(f)) violations.push({ rule: r.id, desc: r.desc, file: f, where: "history" });
    }
  }
  const blob = git(["log", "--all", "-p", "--unified=0"]);
  for (const r of RULES.filter((x) => !x.pathOnly)) {
    if (r.re.test(blob)) violations.push({ rule: r.id, desc: r.desc, file: "(이력 어딘가)", where: "history" });
  }
}

console.log(`추적 파일 ${tracked.length}개 검사${history ? " + 전체 이력" : ""}`);
if (!violations.length) {
  console.log("✅ 위반 없음");
  process.exit(0);
}
const seen = new Set();
console.log(`❌ 위반 ${violations.length}건`);
for (const v of violations) {
  const k = `${v.rule}|${v.file}`;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`  [${v.rule}] ${v.desc} — ${v.file} (${v.where})`);
}
process.exit(1);
