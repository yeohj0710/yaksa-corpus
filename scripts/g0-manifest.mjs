/**
 * G0 — 인벤토리(L0) 생성.
 *
 * 원본을 훑어 파일마다 과목·자료종류·쪽수·텍스트레이어·추출경로·SHA·중복그룹을 채웁니다.
 * LLM 을 쓰지 않습니다. 두 번 돌리면 같은 결과가 나옵니다.
 *
 *   node scripts/g0-manifest.mjs [--force]
 *
 * 쪽 샘플링 결과는 data/probe-cache.json 에 SHA 로 캐시합니다.
 * 파일이 그대로면 두 번째 실행은 몇 초에 끝납니다.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { SOURCE_ROOT, SUBJECT_BY_FOLDER, DIR, MANIFEST, CONCURRENCY } from "../lib/config.mjs";
import { pdfInfo, pdfToText } from "../lib/pdf.mjs";
import { runJobs, writeJSON, readJSON, writeReport, ensureDir, arg } from "../lib/jobs.mjs";

const SKIP_DIRS = new Set(["약사 국가고시 공부 사이트", "node_modules", ".git"]);
const SKIP_FILES = new Set([
  "desktop.ini", ".DS_Store",
  // 이 파이프라인이 원본 폴더에 만들어 둔 산출물. 원본으로 다시 읽으면 안 됩니다.
  "00. 자료 인벤토리 (manifest).json",
  "00. 자료 인벤토리 (manifest).csv",
  "00. 국시 자료 데이터화 전략.md",
  "00. AGENTS 초안.md",
]);
const SKIP_EXT = new Set([".gscript", ".ini"]);
// Drive 링크 JSON 은 파일 ID 가 들어 있는 비공개 파일입니다. 코퍼스에 넣지 않습니다.
const SKIP_PATTERN = /\.private\.(json|gs)$/i;

// 한국어 상용 음절. 정상 한글 본문은 이 비율이 높습니다.
const COMMON = new Set("이가는은을를에의로와과도만하한할합니다있없되수것들그저때문또는및위해대한따라서약물치료환자투여증상질환경우같다음각첫번");

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else {
      if (SKIP_FILES.has(e.name)) continue;
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
      if (SKIP_PATTERN.test(e.name)) continue;
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function materialType(file) {
  const name = path.basename(file);
  const parent = path.basename(path.dirname(file));
  const ext = path.extname(file).toLowerCase();
  if (ext === ".md" || ext === ".txt") return "note";   // 폴더 안내문. 시험지가 아닙니다
  if (parent.includes("국시 기출문제")) return name.includes("최종답안") ? "past-paper-answer" : "past-paper";
  if (name.includes("공부가이드")) return "study-guide";
  if (name.includes("D등급")) return "d-grade-list";
  if ([".mp3", ".m4a"].includes(ext) || file.endsWith("의 사본")) return "audio";
  if (ext === ".mp4") return "video";
  if (ext === ".csv") return "flashcard-csv";
  if ([".xlsx", ".xls", ".numbers"].includes(ext)) return "spreadsheet";
  if (ext === ".zip") return "goodnotes";
  const pairs = [["주교재","textbook"],["기본서","textbook"],["부교재","subtext"],["문제집","workbook"],
                 ["요약","summary"],["정리본","summary"],["암기송","mnemonic"],["생약송","mnemonic"],
                 ["실습송","mnemonic"],["말만들기","mnemonic"],["플래시카드","flashcard"],
                 ["스터디","study-aid"],["정오표","errata"]];
  for (const [pat, t] of pairs) if (parent.includes(pat) || name.includes(pat)) return t;
  return "etc";
}

function sha16(file, cap = 8 * 1024 * 1024) {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    let read = 0;
    const s = createReadStream(file, { highWaterMark: 1 << 20 });
    s.on("data", (b) => { h.update(b); read += b.length; if (read >= cap) s.destroy(); });
    s.on("close", () => res(h.digest("hex").slice(0, 16)));
    s.on("error", rej);
  });
}

/**
 * 이 코퍼스에 정상적으로 나올 수 있는 문자만 허용합니다.
 * 깨진 인코딩은 그리스확장·데바나가리·구자라트·PUA 등 온갖 대역으로 흩어지므로,
 * 나쁜 대역을 열거하는 것보다 좋은 대역만 통과시키는 쪽이 훨씬 안전합니다.
 */
function expected(o) {
  return (o >= 0x0020 && o <= 0x024f)          // ASCII + 라틴 확장
      || (o >= 0xac00 && o <= 0xd7a3)          // 한글 음절
      || (o >= 0x4e00 && o <= 0x9fff)          // 한자
      || (o >= 0x0370 && o <= 0x03ff)          // 그리스 (α, β …)
      || (o >= 0x2000 && o <= 0x22ff)          // 일반 구두점·화살표·수학
      || (o >= 0x2460 && o <= 0x24ff)          // ①②③
      || (o >= 0x3000 && o <= 0x303f)          // CJK 구두점
      || (o >= 0xff00 && o <= 0xffef);         // 전각
}

/** 한 쪽 단위 판정. 문서 단위로 뭉뚱그리면 표지만 멀쩡한 파일을 놓칩니다. */
function classifyPage(text) {
  const t = text.replace(/\s+/g, "");
  if (t.length < 60) return "EMPTY";
  let hangul = 0, common = 0, odd = 0;
  for (const c of t) {
    const o = c.codePointAt(0);
    if (o >= 0xac00 && o <= 0xd7a3) { hangul++; if (COMMON.has(c)) common++; }
    else if (!expected(o)) odd++;
  }
  if (odd > Math.max(10, t.length * 0.05)) return "MOJIBAKE";
  if (hangul >= 20) return common / hangul > 0.10 ? "CLEAN" : "MOJIBAKE";
  // 한글이 거의 없는데 글자는 많음 → Distiller 계열의 ASCII 영역 깨짐
  return "MOJIBAKE";
}

/**
 * 문서 판정. 쪽마다 따로 보고 **가장 나쁜 쪽**을 따릅니다.
 * 한 쪽이라도 깨져 있으면 pdftotext 로 보내면 안 됩니다. 그 쪽 L1 이 통째로 쓰레기가 됩니다.
 */
function classify(pageTexts) {
  const kinds = pageTexts.map(classifyPage);
  const real = kinds.filter((k) => k !== "EMPTY");
  if (!real.length) return { kind: "SCAN", pageKinds: kinds };
  if (real.includes("MOJIBAKE")) return { kind: "MOJIBAKE", pageKinds: kinds };
  // 본문이 거의 비어 있고 몇 쪽만 글자가 있으면 스캔으로 봅니다
  if (real.length < kinds.length / 2) return { kind: "SCAN", pageKinds: kinds };
  return { kind: "CLEAN", pageKinds: kinds };
}

function route(row) {
  if (row.ext === ".pdf") return row.text_layer === "CLEAN" ? "pdftotext" : "vision";
  if (row.ext === ".csv") return "direct-csv";
  if ([".xlsx", ".xls"].includes(row.ext)) return "xls-ole2";
  if ([".mp3", ".m4a"].includes(row.ext) || row.material_type === "audio") return "audio-defer";
  if (row.ext === ".zip") return "goodnotes-defer";
  return "manual";
}

// ---------------------------------------------------------------------------
console.log(`원본: ${SOURCE_ROOT}`);
ensureDir(DIR.data);
const force = !!arg("force");
const cacheFile = path.join(DIR.data, "probe-cache.json");
const cache = force ? {} : (readJSON(cacheFile, {}) ?? {});

const files = walk(SOURCE_ROOT);
console.log(`파일 ${files.length}개 발견`);

const rows = [];
for (const file of files) {
  const rel = path.relative(SOURCE_ROOT, file);
  const parts = rel.split(path.sep);
  const subj = SUBJECT_BY_FOLDER.get(parts[0]);
  rows.push({
    source_key: `${subj?.key ?? "_root"}/${rel.split(path.sep).join("/")}`,
    path: rel.split(path.sep).join("/"),
    subject_folder: subj?.folder ?? null,
    subject_key: subj?.key ?? "_root",
    area: subj?.area ?? 0,
    exam_questions: subj?.q ?? 0,
    category: path.dirname(file) === SOURCE_ROOT ? null : path.basename(path.dirname(file)),
    filename: path.basename(file),
    ext: path.extname(file).toLowerCase(),
    material_type: materialType(file),
    size_mb: +(statSync(file).size / 1048576).toFixed(3),
    pages: null, producer: null, text_layer: null,
    extract_route: null, content_sha: null, dup_group: null, is_primary: true,
    _abs: file,
  });
}

// --- SHA -------------------------------------------------------------------
console.log("SHA 계산...");
await runJobs({
  goal: "g0-sha", concurrency: 8,
  jobs: rows.map((r) => ({ key: r.path, run: async () => { r.content_sha = await sha16(r._abs); } })),
});

// --- PDF 프로브 -------------------------------------------------------------
const pdfs = rows.filter((r) => r.ext === ".pdf");
console.log(`PDF ${pdfs.length}개 텍스트 레이어 판정...`);
await runJobs({
  goal: "g0-probe", concurrency: CONCURRENCY * 2,
  jobs: pdfs.map((r) => ({
    key: r.path,
    run: async () => {
      const hit = cache[r.content_sha];
      if (hit) { Object.assign(r, hit); return; }
      const info = await pdfInfo(r._abs);
      const texts = [];
      if (info.pages > 0) {
        // 최대 8쪽을 고르게 표본. 표지만 멀쩡한 혼합 인코딩 문서를 잡아내려면 3쪽으로는 부족합니다.
        const n = Math.min(8, info.pages);
        const idx = [...new Set(
          Array.from({ length: n }, (_, i) => 1 + Math.round((i * (info.pages - 1)) / Math.max(1, n - 1))),
        )];
        for (const p of idx) texts.push(await pdfToText(r._abs, p, { layout: false }).catch(() => ""));
      }
      const c = classify(texts);
      const probe = { pages: info.pages, producer: info.producer.slice(0, 45), text_layer: c.kind };
      cache[r.content_sha] = probe;
      Object.assign(r, probe);
    },
  })),
});
writeJSON(cacheFile, cache);

// --- 중복 그룹 --------------------------------------------------------------
const groups = new Map();
for (const r of rows) {
  const k = `${r.content_sha}|${r.size_mb}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
let g = 0;
for (const list of groups.values()) {
  if (list.length < 2) continue;
  list.sort((a, b) => a.path.localeCompare(b.path));
  const id = `dup${String(g++).padStart(3, "0")}`;
  list.forEach((r, i) => { r.dup_group = id; r.is_primary = i === 0; });
}

for (const r of rows) { r.extract_route = route(r); delete r._abs; }
rows.sort((a, b) => a.path.localeCompare(b.path));
writeJSON(MANIFEST, rows);

// --- 리포트 -----------------------------------------------------------------
const prim = rows.filter((r) => r.is_primary);
const sum = (rs) => rs.reduce((n, r) => n + (r.pages || 0), 0);
const by = (rs, k) => {
  const m = new Map();
  for (const r of rs) {
    const v = m.get(r[k]) ?? [0, 0];
    m.set(r[k], [v[0] + 1, v[1] + (r.pages || 0)]);
  }
  return [...m].sort((a, b) => b[1][1] - a[1][1]);
};

console.log(`\n자산 ${rows.length} / 중복제거 ${prim.length}`);
console.log(`쪽 ${sum(rows).toLocaleString()} / 중복제거 ${sum(prim).toLocaleString()}`);
for (const [k, [n, p]] of by(prim, "extract_route")) console.log(`  ${String(k).padEnd(16)} ${String(n).padStart(4)}개  ${String(p).padStart(6)}쪽`);

writeReport("g0-manifest", {
  "요약": {
    "전체 자산": rows.length, "중복 제거 후": prim.length,
    "전체 쪽": sum(rows), "중복 제거 후 쪽": sum(prim),
    "중복 그룹": g, "중복으로 아낀 쪽": sum(rows) - sum(prim),
  },
  "추출 경로별": ["| 경로 | 파일 | 쪽 |", "|---|---:|---:|",
    ...by(prim, "extract_route").map(([k, [n, p]]) => `| ${k} | ${n} | ${p} |`)],
  "텍스트 레이어별": ["| 상태 | 파일 | 쪽 |", "|---|---:|---:|",
    ...by(prim.filter((r) => r.ext === ".pdf"), "text_layer").map(([k, [n, p]]) => `| ${k} | ${n} | ${p} |`)],
  "자료 종류별": ["| 종류 | 파일 | 쪽 |", "|---|---:|---:|",
    ...by(prim, "material_type").map(([k, [n, p]]) => `| ${k} | ${n} | ${p} |`)],
});
console.log(`\nmanifest: ${MANIFEST}`);
