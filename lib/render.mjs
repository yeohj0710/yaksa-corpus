/**
 * 렌더 캐시 접근. G1 이 구워둔 PNG 를 쪽 단위로 꺼내 씁니다.
 * 캐시가 없으면 그 문서만 즉석에서 굽습니다.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR, RENDER_DPI } from "./config.mjs";
import { absPath } from "./manifest.mjs";
import { pdfToPngAll, pageOf } from "./pdf.mjs";
import { ensureDir } from "./jobs.mjs";

const inflight = new Map();

export function renderDir(row) {
  return path.join(DIR.render, row.content_sha);
}

/** 문서의 쪽 → PNG 경로 맵. 없으면 굽습니다. 같은 문서 동시 요청은 한 번만 굽습니다. */
export async function ensureRendered(row) {
  const dir = renderDir(row);
  if (existsSync(path.join(dir, ".done"))) return listPages(dir);
  if (inflight.has(row.content_sha)) return inflight.get(row.content_sha);

  const job = (async () => {
    ensureDir(dir);
    await pdfToPngAll(absPath(row), dir, { dpi: RENDER_DPI });
    const n = readdirSync(dir).filter((f) => f.endsWith(".png")).length;
    writeFileSync(path.join(dir, ".done"), String(n), "utf8");
    return listPages(dir);
  })();
  inflight.set(row.content_sha, job);
  try { return await job; } finally { inflight.delete(row.content_sha); }
}

function listPages(dir) {
  const map = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".png")) continue;
    const p = pageOf(f);
    if (p != null) map.set(p, path.join(dir, f));
  }
  return map;
}

export function pngBase64(file) {
  return readFileSync(file).toString("base64");
}
