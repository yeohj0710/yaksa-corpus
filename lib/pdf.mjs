/**
 * poppler 래퍼. shell 을 거치지 않아서 공백·한글 경로가 그대로 통합니다.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const CANDIDATES = [
  process.env.POPPLER_BIN,
  "C:\\Users\\hjyeo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin",
  "C:\\Program Files\\poppler\\bin",
].filter(Boolean);

let BIN = null;
function bin(tool) {
  if (BIN === null) {
    BIN = CANDIDATES.find((d) => existsSync(path.join(d, "pdftotext.exe"))) ?? "";
  }
  return BIN ? path.join(BIN, `${tool}.exe`) : tool; // PATH 로 폴백
}

const OPTS = { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 300_000 };

export async function pdfInfo(file) {
  const { stdout } = await run(bin("pdfinfo"), [file], { ...OPTS, encoding: "buffer" });
  const text = stdout.toString("utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { pages: Number(out.Pages || 0), producer: out.Producer || "", raw: out };
}

/** 한 쪽만 텍스트로. -layout 은 표 구조를 살립니다. */
export async function pdfToText(file, page, { layout = true } = {}) {
  const args = ["-enc", "UTF-8", "-f", String(page), "-l", String(page)];
  if (layout) args.push("-layout");
  args.push(file, "-");
  const { stdout } = await run(bin("pdftotext"), args, { ...OPTS, encoding: "buffer" });
  return stdout.toString("utf8");
}

/**
 * 문서 전체를 한 번의 호출로 PNG 렌더. 쪽마다 프로세스를 띄우는 것보다 훨씬 빠릅니다.
 * `${outDir}/p-001.png` 형태로 떨어집니다.
 */
export async function pdfToPngAll(file, outDir, { dpi = 150, first, last } = {}) {
  const args = ["-png", "-r", String(dpi)];
  if (first) args.push("-f", String(first));
  if (last) args.push("-l", String(last));
  args.push(file, path.join(outDir, "p"));
  await run(bin("pdftoppm"), args, { ...OPTS, timeout: 900_000 });
  return readdirSync(outDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(outDir, f));
}

/** `p-001.png` / `p-1.png` 어느 쪽이든 쪽번호를 뽑습니다. */
export function pageOf(pngPath) {
  const m = path.basename(pngPath).match(/-(\d+)\.png$/);
  return m ? Number(m[1]) : null;
}

export function popplerRoot() {
  bin("pdfinfo");
  return BIN || "(PATH)";
}
