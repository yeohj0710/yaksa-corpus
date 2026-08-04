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
  { id: "output-dir",   re: /^(?:data|render|l1|l2|backups|logs)\//,    desc: "추출물 디렉터리", pathOnly: true },
  // 디렉터리 이름을 열거하는 방식은 새 폴더가 생기면 뚫립니다(backups/ 로 실제로 뚫렸음).
  // L1 프론트매터는 어느 경로에 있든 이 서명을 갖고 있으므로 내용으로 잡습니다.
  { id: "l1-content",   re: /^---\r?\n(?:[a-z_]+:.*\r?\n)*?sha:\s*[0-9a-f]{16}\r?\n/m,
                        desc: "L1 전사 원문(프론트매터 서명)" },
  { id: "source-key",   re: /source_key:\s*\S+\/\d-\d\./,               desc: "원본 자료 경로" },
];

/** 추적 목록에 마크다운·JSONL 이 대량으로 들어오면 산출물이 섞였을 가능성이 큽니다. */
const BULK_LIMIT = 60;

const ALLOW = [
  ".env.example",       // 빈 값만 들어 있음
  "scripts/privacy-check.mjs", // 이 파일이 패턴 자체를 담고 있음
];

/**
 * 규칙별 예외. 문서에는 프론트매터·source_key 예시가 들어갈 수밖에 없습니다.
 * 경로 규칙(output-dir 등)은 예외 없이 적용합니다.
 */
const ALLOW_BY_RULE = {
  "l1-content": ["AGENTS.md", "GOALS.md", "README.md", "scripts/agent-next.mjs", "scripts/g5-l1.mjs"],
  "source-key": ["AGENTS.md", "GOALS.md", "README.md", "scripts/agent-next.mjs"],
};

function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
}

const violations = [];
function scan(file, text, where) {
  if (ALLOW.includes(file)) return;
  for (const r of RULES) {
    if (ALLOW_BY_RULE[r.id]?.includes(file)) continue;
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

// 개별 규칙을 다 통과해도, 추적 파일이 갑자기 불어나면 산출물이 섞인 것입니다.
const bulk = tracked.filter((f) => /\.(md|jsonl|json)$/i.test(f) && !/^(schema|reports|docs)\//.test(f) && f !== "README.md" && f !== "AGENTS.md" && f !== "GOALS.md");
if (bulk.length > BULK_LIMIT) {
  violations.push({ rule: "bulk-tracked", desc: `문서 파일 ${bulk.length}개가 추적됨 (상한 ${BULK_LIMIT})`, file: bulk[0], where: "tracked" });
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
