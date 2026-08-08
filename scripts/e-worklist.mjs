/**
 * G-A2 — 남은 강조 복원 작업 목록. **API 를 쓰지 않습니다.**
 *
 *   npm run e:worklist                        남은 전부 (한 줄 JSON)
 *   npm run e:worklist -- --count             줄 수만
 *   npm run e:worklist -- --by subject        과목별 남은 쪽
 *   npm run e:worklist -- --subject law
 *   npm run e:worklist -- --material-type textbook
 *   npm run e:worklist -- --tier b            색이 없는 쪽의 표본
 *
 * 이 스크립트가 진행률의 유일한 기준입니다. 손으로 세지 마세요.
 * G-A 에서 매 쪽 손으로 세다가 41% 라고 보고했는데 실제로는 27.6% 였습니다.
 *
 * 두 갈래
 *   tier A  색 잉크나 형광이 감지된 쪽. 전수 확인합니다.
 *   tier B  색이 하나도 없는 쪽. 검은 굵게·밑줄만 있을 수 있어 문서마다 표본 3쪽만 봅니다.
 *           표본에서 강조가 나오면 그 문서에 `emphasis/{sha}/.all` 을 만들고 전수로 돌립니다.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DIR } from "../lib/config.mjs";
import { loadManifest } from "../lib/manifest.mjs";
import { readJSONL, arg } from "../lib/jobs.mjs";
import { EMPH_DIR, markPath, SAMPLE_PER_DOC, sampleIdx } from "../lib/emphasis-paths.mjs";

const SCAN = path.join(DIR.data, "emphasis-scan.jsonl");
const tier = String(arg("tier", "a")).toLowerCase();
const onlySubject = arg("subject");
const onlyType = arg("material-type");
const countOnly = !!arg("count");
const by = arg("by");

if (!existsSync(SCAN)) {
  console.error("data/emphasis-scan.jsonl 이 없습니다. 먼저 `npm run e:scan` 을 돌리세요.");
  process.exit(1);
}

const bySha = new Map();
for (const r of loadManifest()) if (r.is_primary) bySha.set(r.content_sha, r);

const ORDER = ["study-guide", "d-grade-list", "textbook", "summary", "subtext",
  "workbook", "study-aid", "mnemonic", "past-paper", "past-paper-answer", "errata", "etc"];
const ord = (t) => { const i = ORDER.indexOf(t); return i === -1 ? ORDER.length : i; };

const scan = readJSONL(SCAN).filter((r) => !r.err);
const byDoc = new Map();
for (const r of scan) {
  if (!byDoc.has(r.sha)) byDoc.set(r.sha, []);
  byDoc.get(r.sha).push(r);
}

// 과목별 남은 쪽 = 정렬 기준(적은 것부터)
const work = [];
for (const [sha, pages] of byDoc) {
  const row = bySha.get(sha);
  if (!row) continue;
  if (onlySubject && row.subject_key !== onlySubject) continue;
  if (onlyType && row.material_type !== onlyType) continue;
  pages.sort((a, b) => a.page - b.page);

  const forcedAll = existsSync(path.join(EMPH_DIR, sha, ".all"));
  const colored = pages.filter((p) => p.level !== "없음");
  const plain = pages.filter((p) => p.level === "없음");

  let target;
  if (tier === "a") target = colored;
  else if (tier === "b") target = forcedAll ? plain : sampleIdx(plain, SAMPLE_PER_DOC);
  else target = forcedAll ? pages : [...colored, ...sampleIdx(plain, SAMPLE_PER_DOC)];

  for (const p of target) {
    if (existsSync(markPath(sha, p.page))) continue;
    if (!existsSync(path.join(DIR.l1, sha, `p-${String(p.page).padStart(4, "0")}.md`))) continue;
    work.push({
      content_sha: sha, page: p.page, subject_key: row.subject_key,
      material_type: row.material_type, level: p.level, tier: p.level === "없음" ? "b" : "a",
    });
  }
}

work.sort((a, b) =>
  a.subject_key.localeCompare(b.subject_key) ||
  ord(a.material_type) - ord(b.material_type) ||
  a.content_sha.localeCompare(b.content_sha) ||
  a.page - b.page);

if (countOnly) { console.log(work.length); process.exit(0); }

if (by) {
  const key = by === "doc" ? (w) => `${w.subject_key}/${w.material_type} ${w.content_sha}` : (w) => w.subject_key;
  const agg = new Map();
  for (const w of work) agg.set(key(w), (agg.get(key(w)) || 0) + 1);
  const sorted = [...agg].sort((a, b) => a[1] - b[1]);
  for (const [k, v] of sorted) console.log(`${String(v).padStart(6)}  ${k}`);
  console.log(`${String(work.length).padStart(6)}  합계`);
  process.exit(0);
}

for (const w of work) console.log(JSON.stringify(w));
