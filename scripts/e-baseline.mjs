/**
 * G-A2 — 본문 지문(fingerprint) 고정. **API 를 쓰지 않습니다.**
 *
 *   npm run e:baseline            없으면 만듭니다. 있으면 아무것도 안 합니다
 *   npm run e:baseline -- --verify   지금 L1 이 기준과 같은지만 봅니다
 *   npm run e:baseline -- --rebase   기준을 다시 잡습니다 (사람이 판단할 때만)
 *
 * 무엇을 고정하나
 *   각 L1 쪽에서 강조 마커를 벗겨낸 본문의 SHA-256 입니다.
 *   강조를 붙이고 떼는 건 이 값을 바꾸지 않습니다. 글자를 한 자라도 고치면 바뀝니다.
 *
 * 왜 필요한가
 *   G-A 에서 밀집 다단 쪽의 용어가 조용히 바뀐 사고가 있었습니다.
 *   뇌교수초용해 → 말초신경염,  폐렴 → 폐암,  갑상선질환 → 암성질환.
 *   강조를 붙이는 작업이 전사를 다시 건드리면 같은 사고가 또 납니다.
 *   이 지문이 있으면 "본문은 안 건드렸다"를 말이 아니라 해시로 증명합니다.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { splitFrontMatter, stripMarks } from "../lib/emphasis.mjs";
import { readJSONL, writeJSONL, writeReport, arg } from "../lib/jobs.mjs";

const BASE = path.join(DIR.data, "l1-baseline.jsonl");
const verify = !!arg("verify");
const rebase = !!arg("rebase");

function fingerprint(file) {
  const { body } = splitFrontMatter(readFileSync(file, "utf8"));
  return createHash("sha256").update(stripMarks(body), "utf8").digest("hex").slice(0, 32);
}

const now = [];
for (const sha of readdirSync(DIR.l1)) {
  const dir = path.join(DIR.l1, sha);
  let files;
  try { files = readdirSync(dir); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const page = Number(f.match(/p-(\d+)\.md$/)?.[1]);
    if (!Number.isFinite(page)) continue;
    now.push({ sha, page, fp: fingerprint(path.join(dir, f)) });
  }
}
now.sort((a, b) => a.sha.localeCompare(b.sha) || a.page - b.page);

if (!existsSync(BASE) || rebase) {
  writeJSONL(BASE, now);
  console.log(`${rebase ? "기준을 다시 잡았습니다" : "기준을 만들었습니다"}: ${now.length.toLocaleString()}쪽`);
  console.log(`  ${path.relative(process.cwd(), BASE)}`);
  writeReport("e-baseline", { "요약": { "고정한 쪽": now.length, "다시 잡음": rebase ? "예" : "아니오" } });
  process.exit(0);
}

const old = new Map(readJSONL(BASE).map((r) => [`${r.sha}-${r.page}`, r.fp]));
const cur = new Map(now.map((r) => [`${r.sha}-${r.page}`, r.fp]));

const changed = [], added = [], removed = [];
for (const [k, fp] of cur) {
  if (!old.has(k)) added.push(k);
  else if (old.get(k) !== fp) changed.push(k);
}
for (const k of old.keys()) if (!cur.has(k)) removed.push(k);

console.log(`기준 ${old.size.toLocaleString()}쪽 · 현재 ${cur.size.toLocaleString()}쪽`);
console.log(`본문이 바뀐 쪽 ${changed.length} · 새 쪽 ${added.length} · 없어진 쪽 ${removed.length}`);
if (changed.length) {
  console.log(`\n본문이 바뀌었습니다. 강조 작업은 글자를 건드리면 안 됩니다. 앞 20개:`);
  for (const k of changed.slice(0, 20)) console.log(`  ${k}`);
  console.log(`\n되돌리는 법: git 이 아니라 backups/ 또는 재전사입니다. l1/ 은 추적되지 않습니다.`);
}

writeReport("e-baseline", {
  "요약": { "기준 쪽": old.size, "현재 쪽": cur.size, "본문 변경": changed.length, "신규": added.length, "삭제": removed.length },
  "본문이 바뀐 쪽": changed.length ? changed.slice(0, 60).map((k) => `- ${k}`) : ["없음"],
});

if (verify) process.exit(changed.length || removed.length ? 1 : 0);
