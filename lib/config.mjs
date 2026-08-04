/**
 * 경로·과목·시험 배치. 모든 스크립트가 여기만 봅니다.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(fileURLToPath(import.meta.url), "../..");

// --- .env (의존성 없이 직접 읽습니다) ---------------------------------------
for (const f of [".env", ".env.local"]) {
  const p = path.join(REPO, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

export const SOURCE_ROOT =
  process.env.SOURCE_ROOT || "G:\\내 드라이브\\여형준님\\32 공부 자료";

export const DIR = {
  data: path.join(REPO, "data"),
  render: path.join(REPO, "render"),
  l1: path.join(REPO, "l1"),
  l2: path.join(REPO, "l2"),
  reports: path.join(REPO, "reports"),
  schema: path.join(REPO, "schema"),
};

export const MANIFEST = path.join(DIR.data, "manifest.json");

export const LLM = {
  baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  apiKey: process.env.LLM_API_KEY || "",
  vision: process.env.LLM_MODEL_VISION || "gpt-5.6-luna",
  struct: process.env.LLM_MODEL_STRUCT || "gpt-5.6-luna",
};

export const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
export const RENDER_DPI = Number(process.env.RENDER_DPI || 150);

// --- 과목 -------------------------------------------------------------------
// folder: 원본 폴더명 / key: subjectKey (공부 사이트와 동일) / q: 출제 문항 수
export const SUBJECTS = [
  { folder: "1-1. 생화학",          key: "biochemistry",     area: 1, q: 20, session: 1 },
  { folder: "1-2. 미생물학",         key: "microbiology",     area: 1, q: 20, session: 1 },
  { folder: "1-3. 약물학",          key: "pharmacology",     area: 1, q: 20, session: 1 },
  { folder: "1-4. 예방약학",         key: "preventive",       area: 1, q: 20, session: 1 },
  { folder: "1-5. 병태생리학",        key: "pathophysiology",  area: 1, q: 20, session: 1 },
  { folder: "2-1. 물리약학",         key: "physical",         area: 2, q: 18, session: 2 },
  { folder: "2-2. 합성학-의약화학",     key: "medchem",          area: 2, q: 18, session: 2 },
  { folder: "2-3. 분석학",          key: "analytical",       area: 2, q: 18, session: 2 },
  { folder: "2-4. 약제학-제제학",      key: "pharmaceutics",    area: 2, q: 18, session: 2 },
  { folder: "2-5. 생약학-한약제제학",   key: "pharmacognosy",    area: 2, q: 18, session: 2 },
  { folder: "3-1. 약물치료학",        key: "pharmacotherapy",  area: 3, q: 77, session: 3 },
  { folder: "3-2. 실무실습",         key: "practice",         area: 3, q: 27, session: 4 },
  { folder: "3-3. 제조-품질관리학",     key: "manufacturing",    area: 3, q: 18, session: 4 },
  { folder: "3-4. 사회약학",         key: "social",           area: 3, q: 18, session: 4 },
  { folder: "4-1. 약사법규",         key: "law",              area: 4, q: 20, session: 4 },
];

export const SUBJECT_BY_FOLDER = new Map(SUBJECTS.map((s) => [s.folder, s]));
export const SUBJECT_BY_KEY = new Map(SUBJECTS.map((s) => [s.key, s]));

/**
 * 교시 배치. 출처는 `00. 제78회 약사국시 CBT 시행계획 (국시원).pdf` 본문입니다.
 *   1교시 생명약학 100 / 2교시 산업약학 90
 *   3교시 임상·실무약학1 77 / 4교시 임상·실무약학2 63 + 보건·의약 관계 법규 20
 * 합계 350.
 *
 * 교시 안에서의 과목 순서는 위 SUBJECTS 배열 순서로 가정합니다.
 * 첫 G3 실행 뒤 reports/g3-exams.md 의 경계 표를 실제 시험지와 한 번 대조하세요.
 * 문항의 subject_key 에는 subject_source: "range" 가 함께 기록됩니다.
 */
export const SESSIONS = [1, 2, 3, 4];

export const SESSION_TOTAL = { 1: 100, 2: 90, 3: 77, 4: 83 };

/** 교시별 [시작번호, 끝번호] → subjectKey 구간표를 SUBJECTS 순서로 생성합니다. */
export function sessionRanges(session) {
  let n = 0;
  const out = [];
  for (const s of SUBJECTS.filter((x) => x.session === session)) {
    out.push({ key: s.key, from: n + 1, to: n + s.q });
    n += s.q;
  }
  return out;
}

export function subjectForQuestion(session, number) {
  const hit = sessionRanges(session).find((r) => number >= r.from && number <= r.to);
  return hit ? hit.key : null;
}

/** 전 교시 문항 수 합이 350인지 확인합니다. 설정이 틀어지면 즉시 터집니다. */
export function assertExamLayout() {
  const errs = [];
  let total = 0;
  for (const s of SESSIONS) {
    const sum = sessionRanges(s).at(-1)?.to ?? 0;
    total += sum;
    if (sum !== SESSION_TOTAL[s]) errs.push(`${s}교시 과목 합=${sum}, 시행계획=${SESSION_TOTAL[s]}`);
  }
  if (total !== 350) errs.push(`전체 합=${total}, 기대=350`);
  if (errs.length) throw new Error("시험 배치 설정 불일치:\n  " + errs.join("\n  "));
  return true;
}

export const EXAM_ROUNDS = [
  { round: 71, year: 2020 }, { round: 72, year: 2021 }, { round: 73, year: 2022 },
  { round: 74, year: 2023 }, { round: 75, year: 2024 }, { round: 76, year: 2025 },
  { round: 77, year: 2026 },
];
