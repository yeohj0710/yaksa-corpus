/**
 * 프론트매터와 본문 사이의 빈 줄을 없앱니다. 외부 API를 호출하지 않습니다.
 *
 * scripts/g5-l1.mjs 의 frontMatter() 는 `---\n` 으로 끝나고 그 뒤에 본문을 바로 붙입니다.
 * 그래서 정상 파일은 `---` 다음 줄부터 본문입니다(빈 줄 0개).
 *
 * l1-strip-labels.mjs 가 레이아웃 라벨 줄만 빼면서 그 앞뒤 빈 줄이 남았습니다.
 * 이 스크립트가 그 잔여 빈 줄을 걷어내 나머지 파일과 모양을 맞춥니다.
 *
 *   node scripts/l1-normalize-blank.mjs           대상만 출력(기본)
 *   node scripts/l1-normalize-blank.mjs --apply   실제로 수정
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";

const apply = process.argv.includes("--apply");

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** 프론트매터가 닫힌 줄 번호. 프론트매터가 없으면 null. */
function frontMatterEnd(lines) {
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  return end < 0 ? null : end;
}

const targets = [];
for (const file of mdFiles(DIR.l1).sort()) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const end = frontMatterEnd(lines);
  if (end === null) continue;
  let blanks = 0;
  while (lines[end + 1 + blanks] === "") blanks++;
  // 본문이 아예 없는 파일은 건드리지 않습니다.
  if (blanks > 0 && lines[end + 1 + blanks] !== undefined) targets.push({ file, end, blanks });
}

console.log(`대상 ${targets.length}건`);
const byCount = new Map();
for (const t of targets) byCount.set(t.blanks, (byCount.get(t.blanks) || 0) + 1);
for (const [k, v] of [...byCount].sort()) console.log(`  빈 줄 ${k}개 → 0개 : ${v} 파일`);

if (!apply) {
  console.log("실제 수정 없음: --apply 를 붙이세요.");
  process.exit(0);
}

const backup = path.join(DIR.reports, "l1-normalize-blank-backup");
mkdirSync(backup, { recursive: true });

for (const t of targets) {
  copyFileSync(t.file, path.join(backup, path.relative(DIR.l1, t.file).replace(/[\\/]/g, "__")));
  const lines = readFileSync(t.file, "utf8").split(/\r?\n/);
  lines.splice(t.end + 1, t.blanks);
  writeFileSync(t.file, lines.join("\n"), "utf8");
}

console.log(`정리 완료 ${targets.length}건`);
console.log(`원본 백업: ${path.relative(process.cwd(), backup)}`);
