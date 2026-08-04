/**
 * 페이지 회전 감지. PDF 의 /Rotate 는 0 인데 내용만 눕혀 놓은 파일이 섞여 있습니다.
 *
 * 감지: `pdftotext -bbox` 의 단어 상자에서, 회전된 페이지는 대부분의 단어가
 *       가로보다 세로로 깁니다(h > w). 정상 페이지는 0.02~0.17, 회전 페이지는 0.9+ 입니다.
 *
 * 방향: 읽기 순서로 나온 단어들의 y 좌표 증감을 봅니다.
 *       - 시계방향 90도로 눕혀진 글(오른쪽에서 아래로 읽힘) → 연속 단어의 y 가 증가
 *       - 반시계 90도(왼쪽에서 위로 읽힘) → y 가 감소
 *       세우려면 감지된 방향의 반대로 돌립니다.
 *
 * 텍스트 레이어가 없는 순수 스캔에서는 판정할 수 없어 0 을 돌려줍니다.
 * 그런 쪽은 프롬프트의 회전 지시가 받아냅니다.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { popplerRoot } from "./pdf.mjs";

const run = promisify(execFile);
const EXE = process.platform === "win32" ? ".exe" : "";

const WORD_RE = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g;

/** @returns {Promise<0|90|180|270>} 세우기 위해 시계방향으로 돌려야 하는 각도 */
export async function detectRotation(file, page) {
  let xml = "";
  try {
    const bin = popplerRoot();
    const exe = bin === "(PATH)" ? `pdftotext${EXE}` : path.join(bin, `pdftotext${EXE}`);
    const { stdout } = await run(exe, ["-bbox", "-f", String(page), "-l", String(page), file, "-"],
      { maxBuffer: 64 << 20, windowsHide: true, timeout: 120_000, encoding: "buffer" });
    xml = stdout.toString("utf8");
  } catch { return 0; }

  const words = [];
  for (const m of xml.matchAll(WORD_RE)) {
    const [, x0, y0, x1, y1, t] = m;
    if (t.trim().length < 2) continue;
    words.push({ x: +x0, y: +y0, w: +x1 - +x0, h: +y1 - +y0 });
  }
  if (words.length < 15) return 0;                       // 표본 부족(스캔 등)

  const tallFrac = words.filter((w) => w.h > w.w).length / words.length;
  if (tallFrac < 0.7) return 0;                          // 세로 단어가 드물면 정상

  // 읽기 순서상 y 가 늘어나는지 줄어드는지
  let up = 0, down = 0;
  for (let i = 1; i < words.length; i++) {
    const dy = words[i].y - words[i - 1].y;
    if (Math.abs(dy) < 1) continue;
    if (dy > 0) down++; else up++;
  }
  // y 증가(down) 우세 = 시계방향으로 눕혀짐 → 반시계로 세움(=270 시계)
  return down >= up ? 270 : 90;
}

/** 문서 대표 회전값. 앞쪽 몇 쪽만 보고 정합니다. */
export async function detectDocRotation(file, pages, sample = 3) {
  const idx = [...new Set(
    Array.from({ length: Math.min(sample, pages) }, (_, i) =>
      1 + Math.round((i * (pages - 1)) / Math.max(1, Math.min(sample, pages) - 1))),
  )];
  const votes = new Map();
  for (const p of idx) {
    const r = await detectRotation(file, p);
    votes.set(r, (votes.get(r) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}
