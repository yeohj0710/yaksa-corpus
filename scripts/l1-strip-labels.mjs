/**
 * L1 본문 첫 줄에 잘못 누출된 레이아웃 판별 라벨을 제거합니다.
 * 기본 실행은 대상 목록만 출력합니다. 확인 후 --apply로 실제 파일을 수정합니다.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";

const LABELS = new Set([
  "C. 표",
  "A. 흐르는 글 / 목록",
  "B. 다단 조판",
  "D. 도해·회로도 + C. 표 + A. 흐르는 글/목록",
  "B. 다단 조판 + C. 표",
]);
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

function firstBodyLine(lines) {
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  for (let i = end + 1; i < lines.length; i++) {
    if (lines[i] !== "") return { index: i, value: lines[i] };
  }
  return null;
}

const targets = [];
for (const file of mdFiles(DIR.l1).sort()) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const line = firstBodyLine(lines);
  if (line && LABELS.has(line.value)) targets.push({ file, line: line.value, index: line.index });
}

console.log(`대상 ${targets.length}건`);
for (const target of targets) console.log(`${path.relative(DIR.l1, target.file)}\t${target.line}`);

if (!apply) {
  console.log("실제 수정 없음: 목록을 확인한 뒤 --apply를 사용하세요.");
  process.exit(0);
}
if (targets.length !== 153) {
  throw new Error(`기대 대상 153건, 실제 ${targets.length}건. 수정하지 않습니다.`);
}

for (const target of targets) {
  const lines = readFileSync(target.file, "utf8").split(/\r?\n/);
  lines.splice(target.index, 1);
  writeFileSync(target.file, lines.join("\n"), "utf8");
}
console.log(`제거 완료 ${targets.length}건`);
