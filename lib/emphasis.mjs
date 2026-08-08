/**
 * 강조 복원(G-A2)의 공용 코드. **API 를 쓰지 않습니다.** 픽셀과 문자열만 봅니다.
 *
 * 배경
 *   G-A 전사는 글자를 다 옮겼지만 강조를 거의 다 버렸습니다. 렌더 6,683쪽을 스캔해 보니
 *   색 잉크·형광이 있는 쪽이 3,718쪽인데 그중 3,161쪽의 L1 에 강조 표기가 하나도 없습니다.
 *   자료 만든 사람이 빨간 글씨·형광펜으로 표시한 자리가 곧 "외울 것"이라, 이게 빠지면
 *   코퍼스의 값어치가 크게 깎입니다.
 *
 * 이 파일이 담당하는 두 가지
 *   1. 탐지 — 렌더 PNG 에서 색 잉크·형광·밑줄 후보를 셉니다. 게이트의 근거가 됩니다.
 *   2. 표기 — 본문에 마커를 넣고 빼는 규칙. 본문 글자는 절대 바뀌지 않게 강제합니다.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR } from "./config.mjs";
import { readPNG } from "./png.mjs";
import { encodePNG } from "./image.mjs";

// --- 표기 규칙 --------------------------------------------------------------
//
//  **글자**            빨강·파랑 같은 색 글씨, 굵은 글씨
//  <mark>글자</mark>   형광펜
//  <u>글자</u>         밑줄
//
//  겹쳐도 됩니다: <mark>**핵심**</mark>
//
//  `==글자==` 는 쓰지 않습니다. 원문에 `[A] + [R] ========= [AR]` 처럼 등호가 그대로
//  들어간 쪽이 31쪽 있어서, 마커로 쓰면 본문과 구분이 안 됩니다.

export const MARK_TYPES = {
  color: { open: "**", close: "**", label: "색 글씨·굵은 글씨" },
  hl: { open: "<mark>", close: "</mark>", label: "형광펜" },
  underline: { open: "<u>", close: "</u>", label: "밑줄" },
};

/** 별칭. 에이전트가 red/bold/highlight 로 써도 받습니다. */
const ALIAS = {
  color: "color", red: "color", bold: "color", blue: "color", green: "color", c: "color",
  hl: "hl", highlight: "hl", marker: "hl", h: "hl",
  underline: "underline", u: "underline", ul: "underline",
};

export function normalizeType(t) {
  return ALIAS[String(t || "").toLowerCase().trim()] ?? null;
}

/**
 * 짝이 맞는 마커만 벗겨냅니다. 짝이 없는 `**` 는 본문으로 보고 그대로 둡니다.
 * 이 함수가 "본문이 안 바뀌었다"를 판정하는 기준입니다.
 */
export function stripMarks(text) {
  let out = String(text);
  for (let i = 0; i < 6; i++) {
    const before = out;
    out = out
      .replace(/<mark>([\s\S]*?)<\/mark>/g, "$1")
      .replace(/<u>([\s\S]*?)<\/u>/g, "$1")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1");
    if (out === before) break;
  }
  return out;
}

/** 본문에 남은 강조 개수. 리포트·게이트용. */
export function countMarks(text) {
  const s = String(text);
  return {
    color: (s.match(/\*\*[^*\n]+\*\*/g) || []).length,
    hl: (s.match(/<mark>[\s\S]*?<\/mark>/g) || []).length,
    underline: (s.match(/<u>[\s\S]*?<\/u>/g) || []).length,
  };
}

export function totalMarks(text) {
  const c = countMarks(text);
  return c.color + c.hl + c.underline;
}

/** 프론트매터와 본문을 가릅니다. 프론트매터는 손대지 않습니다. */
export function splitFrontMatter(file) {
  const m = String(file).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!m) return { head: "", body: String(file) };
  return { head: m[0], body: String(file).slice(m[0].length) };
}

/**
 * 마커를 본문에 넣습니다.
 *
 * @param {string} body  L1 본문(마커가 이미 있어도 됩니다 — 먼저 벗겨냅니다)
 * @param {Array}  marks [{ line, text, type }]  line 은 벗겨낸 본문 기준 1-base
 * @returns {{ body, applied, failed }}
 *
 * 규칙
 *  - 지정한 줄에서 text 를 그대로 찾습니다. 없으면 ±2 줄까지만 봅니다. 그래도 없으면 실패로 남깁니다.
 *  - 겹치는 구간은 긴 것부터 적용하고, 이미 덮인 자리는 건너뜁니다.
 *  - 끝나고 stripMarks(결과) === stripMarks(원본) 을 확인합니다. 다르면 예외입니다.
 */
export function applyMarks(body, marks) {
  const base = stripMarks(body);
  const lines = base.split("\n");
  const perLine = new Map();
  const failed = [];

  const sorted = [...marks]
    .map((m, i) => ({ ...m, _i: i, type: normalizeType(m.type) ?? "color", text: String(m.text ?? "") }))
    .sort((a, b) => b.text.length - a.text.length);

  for (const m of sorted) {
    if (!m.text.trim()) { failed.push({ ...m, why: "text 가 비었습니다" }); continue; }
    if (m.text.includes("\n")) { failed.push({ ...m, why: "text 에 줄바꿈이 있습니다 — 줄마다 나눠 적으세요" }); continue; }
    const want = Number(m.line);
    let hit = null;
    for (const d of [0, -1, 1, -2, 2]) {
      const ln = want + d;
      if (ln < 1 || ln > lines.length) continue;
      const col = lines[ln - 1].indexOf(m.text);
      if (col !== -1) { hit = { ln, col }; break; }
    }
    if (!hit) {
      const anywhere = lines.findIndex((l) => l.includes(m.text));
      failed.push({
        ...m,
        why: anywhere === -1
          ? "본문에 없는 글자입니다 — 원문 그대로 옮겼는지 확인하세요"
          : `지정한 줄에 없습니다 (실제로는 ${anywhere + 1}줄)`,
      });
      continue;
    }
    const list = perLine.get(hit.ln) ?? [];
    const s = hit.col, e = hit.col + m.text.length;
    if (list.some((x) => s < x.e && e > x.s && !(s >= x.s && e <= x.e) && !(x.s >= s && x.e <= e))) {
      failed.push({ ...m, why: "다른 강조와 부분적으로 겹칩니다" });
      continue;
    }
    if (list.some((x) => x.s === s && x.e === e && x.type === m.type)) continue; // 중복 지정
    list.push({ s, e, type: m.type, _i: m._i });
    perLine.set(hit.ln, list);
  }

  for (const [ln, list] of perLine) {
    // 안쪽(짧은 것)부터 감싸야 <mark>**x**</mark> 순서가 나옵니다.
    list.sort((a, b) => (b.e - b.s) - (a.e - a.s) || a.s - b.s);
    let s = lines[ln - 1];
    const shift = [];
    for (const m of list) {
      const t = MARK_TYPES[m.type];
      let a = m.s, b = m.e;
      for (const p of shift) { if (p.at <= a) a += p.len; if (p.at < b) b += p.len; }
      s = s.slice(0, a) + t.open + s.slice(a, b) + t.close + s.slice(b);
      shift.push({ at: m.s, len: t.open.length }, { at: m.e, len: t.close.length });
    }
    lines[ln - 1] = s;
  }

  const out = lines.join("\n");
  if (stripMarks(out) !== base) {
    throw new Error("적용 후 본문이 달라졌습니다 — 버그입니다. 쓰지 않고 멈춥니다");
  }
  return { body: out, applied: marks.length - failed.length, failed };
}

// --- 픽셀 탐지 --------------------------------------------------------------

const CELL = 8;

/**
 * 렌더 PNG 한 장에서 강조 흔적을 셉니다.
 *   ink : 진한 유채색 획   = 빨간 글씨·파란 글씨·색 밑줄
 *   hl  : 밝은 유채색 면   = 형광펜
 *   rule: 얇고 긴 가로선   = 밑줄 후보(참고용. 표 테두리가 섞입니다)
 */
export function detectEmphasis(png, opt = {}) {
  const { width: w, height: h, data } = png;
  const gw = Math.ceil(w / CELL), gh = Math.ceil(h / CELL);
  const inkGrid = new Int32Array(gw * gh);
  const hlGrid = new Int32Array(gw * gh);
  const rgbSum = new Float64Array(gw * gh * 3);
  let inkPx = 0, hlPx = 0, darkPx = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 110) { darkPx++; continue; }
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (sat < 0.28) continue;
      const gi = ((y / CELL) | 0) * gw + ((x / CELL) | 0);
      if (mx < 200) {
        inkPx++; inkGrid[gi]++;
        rgbSum[gi * 3] += r; rgbSum[gi * 3 + 1] += g; rgbSum[gi * 3 + 2] += b;
      } else if (mn > 90) {
        hlPx++; hlGrid[gi]++;
      }
    }
  }

  const inkBoxes = components(inkGrid, rgbSum, gw, gh, 6, 40);
  const hlBoxes = components(hlGrid, null, gw, gh, 20, 200);
  const textInk = inkBoxes.filter(isTextShaped).length;
  const textHl = hlBoxes.filter(isTextShaped).length;
  return {
    w, h, inkPx, hlPx, darkPx,
    inkBoxes, hlBoxes, textInk, textHl,
    ruleHints: opt.rules === false ? [] : underlineHints(data, w, h),
    level: level({ textInk, textHl }),
  };
}

/**
 * 글자 모양인가. 150dpi 에서 글줄 하나는 높이 12~60px 이고 가로로 깁니다.
 * 이걸 안 걸면 스캔본의 분홍 배경과 색 구조식이 전부 "강조"로 잡힙니다.
 * 표지 한 장으로 확인: 색 픽셀 1,008개인데 글자꼴 덩이는 0개였습니다.
 */
export function isTextShaped(b) {
  return b.h >= 10 && b.h <= 64 && b.w >= b.h * 0.6 && b.px >= 60;
}

/** 등급. 게이트는 "없음"이 아닌 쪽에만 강조를 요구합니다. */
export function level({ textInk = 0, textHl = 0 }) {
  if (textInk >= 3 || textHl >= 2) return "강";
  if (textInk >= 1 || textHl >= 1) return "약";
  return "없음";
}

function components(grid, rgbSum, gw, gh, cellThr, pxThr) {
  const seen = new Uint8Array(gw * gh);
  const out = [];
  const stack = [];
  for (let s = 0; s < grid.length; s++) {
    if (seen[s] || grid[s] < cellThr) continue;
    stack.length = 0; stack.push(s); seen[s] = 1;
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1, px = 0, R = 0, G = 0, B = 0;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % gw, cy = (c / gw) | 0;
      px += grid[c];
      if (rgbSum) { R += rgbSum[c * 3]; G += rgbSum[c * 3 + 1]; B += rgbSum[c * 3 + 2]; }
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx;
        if (seen[ni] || grid[ni] < cellThr) continue;
        seen[ni] = 1; stack.push(ni);
      }
    }
    if (px < pxThr) continue;
    const box = { x: x0 * CELL, y: y0 * CELL, w: (x1 - x0 + 1) * CELL, h: (y1 - y0 + 1) * CELL, px };
    if (rgbSum && px) box.hue = hueName(Math.round(R / px), Math.round(G / px), Math.round(B / px));
    out.push(box);
  }
  return out.sort((a, b) => b.px - a.px);
}

export function hueName(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 30) return "gray";
  if (r === mx) return g > mn + (mx - mn) * 0.55 ? "orange" : b > g + 25 ? "pink" : "red";
  if (g === mx) return "green";
  return b > 150 && r > 110 ? "purple" : "blue";
}

/**
 * 밑줄 후보. 얇고(≤4px) 적당히 길고(45~페이지폭 60%) 바로 위에 글자가 있는 가로선.
 * 표 테두리와 박스 선이 섞이므로 게이트로 쓰지 않고 참고 수치로만 씁니다.
 */
function underlineHints(data, w, h) {
  const found = [];
  const maxLen = Math.round(w * 0.6);
  const isDark = (x, y) => {
    const i = (y * w + x) * 3;
    return Math.max(data[i], data[i + 1], data[i + 2]) < 130;
  };
  for (let y = 2; y < h - 6; y++) {
    let x = 0;
    while (x < w) {
      if (!isDark(x, y)) { x++; continue; }
      let e = x;
      while (e < w && isDark(e, y)) e++;
      const len = e - x;
      if (len >= 45 && len <= maxLen) {
        const mid = x + (len >> 1);
        if (!isDark(mid, y - 1)) {
          let thick = 1;
          while (thick <= 5 && y + thick < h && isDark(mid, y + thick)) thick++;
          if (thick <= 4) {
            let above = 0;
            for (let dy = 4; dy <= 34 && y - dy >= 0; dy++) {
              for (let xx = x; xx < e; xx += 3) if (isDark(xx, y - dy)) { above++; break; }
            }
            // 선 아래가 비어 있어야 밑줄입니다. 표 칸이면 아래에도 글자가 있습니다.
            if (above >= 8) found.push({ x, y, len });
          }
        }
      }
      x = e;
    }
  }
  return found;
}

/**
 * 잉크맵 — 유채색만 남기고 검은 글씨는 아주 옅게 깔아 둔 이미지.
 * 어느 글자에 색이 칠해졌는지 한눈에 보라고 만듭니다. 위치 확인용으로 원본 글자를 남깁니다.
 */
export const INK_DIR = path.join(DIR.render, "..", "render-ink");

export function inkPath(sha, page) {
  return path.join(INK_DIR, sha, `p-${String(page).padStart(4, "0")}.png`);
}

/** 잉크맵을 만들어 저장하고 경로를 돌려줍니다. 이미 있으면 그대로 씁니다. */
export function makeInkMap(srcPng, sha, page, { force = false } = {}) {
  const out = inkPath(sha, page);
  if (!force && existsSync(out)) return out;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, encodePNG(inkMapRGB(readPNG(srcPng))));
  return out;
}

export function inkMapRGB({ width: w, height: h, data }) {
  const out = Buffer.allocUnsafe(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const s = i * 3;
    const r = data[s], g = data[s + 1], b = data[s + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat >= 0.28 && mx >= 60) { out[s] = r; out[s + 1] = g; out[s + 2] = b; }
    else { const v = 200 + Math.round((mx / 255) * 55); out[s] = out[s + 1] = out[s + 2] = v; }
  }
  return { width: w, height: h, data: out };
}
