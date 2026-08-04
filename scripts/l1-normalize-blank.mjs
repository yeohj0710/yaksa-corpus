/**
 * L1 프론트매터와 본문 사이의 불필요한 첫 빈 줄을 제거합니다.
 * 기본 실행은 대상 목록만 출력하고, --apply에서만 파일을 수정합니다.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";

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

function hasBlankAfterFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return false;
  const end = lines.indexOf("---", 1);
  return end >= 0 && lines[end + 1] === "";
}

const apply = process.argv.includes("--apply");
const targets = mdFiles(DIR.l1)
  .sort()
  .filter((file) => hasBlankAfterFrontMatter(readFileSync(file, "utf8")));

console.log(`대상 ${targets.length}건`);
for (const file of targets) console.log(path.relative(DIR.l1, file));

if (!apply) {
  console.log("실제 수정 없음: 목록을 확인한 뒤 --apply를 사용하세요.");
  process.exit(0);
}

for (const file of targets) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  lines.splice(end + 1, 1);
  writeFileSync(file, lines.join("\n"), "utf8");
}
console.log(`정규화 완료 ${targets.length}건`);
