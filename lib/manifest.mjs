/**
 * L0 인벤토리 로더. 모든 스크립트는 여기를 통해서만 대상 파일을 고릅니다.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { MANIFEST, SOURCE_ROOT } from "./config.mjs";

let cache = null;

export function loadManifest() {
  if (cache) return cache;
  if (!existsSync(MANIFEST)) {
    throw new Error(`manifest 가 없습니다: ${MANIFEST}\n  먼저 \`npm run g0\` 를 돌리세요.`);
  }
  cache = JSON.parse(readFileSync(MANIFEST, "utf8"));
  return cache;
}

/** 원본 절대 경로. 원본은 읽기 전용입니다. */
export function absPath(row) {
  return path.join(SOURCE_ROOT, row.path.split("/").join(path.sep));
}

/**
 * 대상 선택. 기본으로 중복본(is_primary=false)은 제외합니다.
 * select({ type: "past-paper", route: "vision", subject: "law" })
 */
export function select(filter = {}) {
  const { type, types, route, routes, subject, ext, primaryOnly = true, limit } = filter;
  const typeSet = types ? new Set(types) : type ? new Set([type]) : null;
  const routeSet = routes ? new Set(routes) : route ? new Set([route]) : null;

  let rows = loadManifest();
  if (primaryOnly) rows = rows.filter((r) => r.is_primary);
  if (typeSet) rows = rows.filter((r) => typeSet.has(r.material_type));
  if (routeSet) rows = rows.filter((r) => routeSet.has(r.extract_route));
  if (subject) rows = rows.filter((r) => r.subject_key === subject);
  if (ext) rows = rows.filter((r) => r.ext === ext);
  return limit ? rows.slice(0, limit) : rows;
}

export function totalPages(rows) {
  return rows.reduce((n, r) => n + (r.pages || 0), 0);
}

/** 산출물 키. 재개 판단의 기준입니다. */
export function pageKey(row, page) {
  return `${row.content_sha}-${String(page).padStart(4, "0")}`;
}
