/**
 * G2 — 공부가이드 + D등급 리스트 구조화. 83쪽밖에 안 되는데 분류축 전체를 여기서 얻습니다.
 *
 *   node scripts/g2-guide.mjs
 *   node scripts/g2-guide.mjs --subject law
 *
 * 산출: l2/guide.json  (과목 15개)
 * 문서 하나를 통째로(모든 쪽을 한 번에) 모델에 보여줍니다. 표가 쪽을 넘어가기 때문입니다.
 */
import path from "node:path";
import { DIR, CONCURRENCY, LLM, SUBJECTS } from "../lib/config.mjs";
import { select } from "../lib/manifest.mjs";
import { ensureRendered, pngBase64 } from "../lib/render.mjs";
import { vision, assertStrictSchema, usageReport } from "../lib/llm.mjs";
import { runJobs, ensureDir, writeJSON, readJSON, writeReport, arg } from "../lib/jobs.mjs";
import { GUIDE_SYSTEM, GUIDE_PROMPT } from "../lib/prompts.mjs";

const SCHEMA = readJSON(path.join(DIR.schema, "guide.schema.json"));
assertStrictSchema(SCHEMA);

const onlySubject = arg("subject");
const force = !!arg("force");
const CACHE = ensureDir(path.join(DIR.data, "g2"));

let docs = select({ types: ["study-guide", "d-grade-list"] });
if (onlySubject) docs = docs.filter((d) => d.subject_key === onlySubject);
console.log(`가이드·D등급 문서 ${docs.length}개 / ${docs.reduce((n, d) => n + (d.pages || 0), 0)}쪽`);

const res = await runJobs({
  goal: "g2-guide", concurrency: CONCURRENCY, force,
  jobs: docs.map((d) => {
    const out = path.join(CACHE, `${d.content_sha}.json`);
    return {
      key: d.path, out,
      run: async () => {
        let imgs;
        if (d.extract_route === "vision") {
          const pages = await ensureRendered(d);
          imgs = [...pages.keys()].sort((a, b) => a - b).map((p) => pngBase64(pages.get(p)));
        } else {
          const pages = await ensureRendered(d);   // CLEAN 이어도 표는 그림으로 보는 편이 정확합니다
          imgs = [...pages.keys()].sort((a, b) => a - b).map((p) => pngBase64(pages.get(p)));
        }
        const data = await vision({
          model: LLM.struct, system: GUIDE_SYSTEM, prompt: GUIDE_PROMPT,
          imagesBase64: imgs, schema: SCHEMA, schemaName: "guide",
          promptCacheKey: "yaksa-guide-v1", maxTokens: 16000,
        });
        writeJSON(out, { subject_key: d.subject_key, material_type: d.material_type,
                         source_key: d.source_key, source_sha: d.content_sha, ...data });
        return true;
      },
    };
  }),
});

// --- 과목별 병합 ------------------------------------------------------------
const bySubject = new Map();
for (const d of docs) {
  const data = readJSON(path.join(CACHE, `${d.content_sha}.json`));
  if (!data) continue;
  const s = SUBJECTS.find((x) => x.key === d.subject_key);
  if (!bySubject.has(d.subject_key)) {
    bySubject.set(d.subject_key, {
      subject_key: d.subject_key, subject_name: s?.folder ?? d.subject_key,
      area: s?.area ?? 0, exam_questions: s?.q ?? 0, session: s?.session ?? 0,
      study_order: [], unit_priority: [], recommended_materials: [], notes: [], sources: [],
    });
  }
  const g = bySubject.get(d.subject_key);
  g.study_order.push(...(data.study_order ?? []));
  g.unit_priority.push(...(data.unit_priority ?? []));
  g.recommended_materials.push(...(data.recommended_materials ?? []));
  g.notes.push(...(data.notes ?? []));
  g.sources.push({ type: d.material_type, source_key: d.source_key, sha: d.content_sha });
}
const guides = SUBJECTS.map((s) => bySubject.get(s.key)).filter(Boolean);
ensureDir(DIR.l2);
writeJSON(path.join(DIR.l2, "guide.json"), guides);

const missing = SUBJECTS.filter((s) => !bySubject.has(s.key)).map((s) => s.key);
const noUnits = guides.filter((g) => !g.unit_priority.length).map((g) => g.subject_key);
const u = usageReport();

writeReport("g2-guide", {
  "요약": { "문서": docs.length, "과목": guides.length, "새로 처리": res.done, "건너뜀": res.skipped, "실패": res.failed,
            "LLM 호출": u.calls, "입력 토큰": u.promptTokens, "출력 토큰": u.completionTokens },
  "과목별": ["| 과목 | 학습순서 | 단원순위 | 추천자료 | 지침 |", "|---|---:|---:|---:|---:|",
    ...guides.map((g) => `| ${g.subject_name} | ${g.study_order.length} | ${g.unit_priority.length} | ${g.recommended_materials.length} | ${g.notes.length} |`)],
  "게이트": [`| 검사 | 결과 |`, `|---|---|`,
    `| 15과목 존재 | ${missing.length ? `❌ 빠짐: ${missing.join(", ")}` : "✅"} |`,
    `| 단원 순위 1개 이상 | ${noUnits.length ? `🟨 없는 과목: ${noUnits.join(", ")}` : "✅"} |`],
});

console.log(`과목 ${guides.length}/15 → ${path.join(DIR.l2, "guide.json")}`);
if (missing.length) process.exit(1);
