/**
 * G-A2 산출물 경로. 스크립트끼리 경로 규칙이 어긋나면 재개가 깨지므로 여기 한 곳에 둡니다.
 *
 *   emphasis/{sha}/p-NNNN.json   에이전트가 쓰는 강조 지시서. 쪽 하나에 파일 하나
 *   emphasis/{sha}/.all          이 문서는 색이 없어도 전수로 본다는 표시
 *   render-ink/{sha}/p-NNNN.png  잉크맵(색만 남긴 사본)
 *
 * emphasis/ 와 render-ink/ 는 gitignore 대상입니다. 원문이 들어갑니다.
 */
import path from "node:path";
import { DIR } from "./config.mjs";

export const EMPH_DIR = path.join(DIR.l1, "..", "emphasis");

export const SAMPLE_PER_DOC = 3;

export function markPath(sha, page) {
  return path.join(EMPH_DIR, sha, `p-${String(page).padStart(4, "0")}.json`);
}

/** 결정적 표본. 같은 목록을 주면 언제나 같은 쪽이 나옵니다. */
export function sampleIdx(pages, n) {
  if (pages.length <= n) return pages;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(pages[Math.floor(((i + 0.5) / n) * pages.length)]);
  }
  return [...new Set(out)];
}
