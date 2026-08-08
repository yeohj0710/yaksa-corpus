/**
 * PNG 읽기. 의존성 없이 씁니다. `lib/image.mjs` 가 쓰기라면 여기는 읽기입니다.
 *
 * 왜 필요한가
 *   강조(빨간 글씨·형광펜·색 밑줄)는 픽셀에 남아 있습니다. 모델한테 묻지 않고
 *   렌더 PNG 를 직접 열어서 "이 쪽에 강조가 있는지"를 기계로 판정합니다.
 *   이게 있어야 "에이전트가 강조를 그냥 안 적었다"를 게이트로 잡습니다.
 *
 * 지원: 8bit, non-interlaced, colorType 0/2/4/6. pdftoppm 산출물은 전부 colorType 2 입니다.
 */
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG 가 아닙니다");
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4),
        depth: body[8], colorType: body[9], interlace: body[12],
      };
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error("IHDR 없음");
  if (ihdr.depth !== 8) throw new Error(`bit depth ${ihdr.depth} 은 지원하지 않습니다`);
  if (ihdr.interlace !== 0) throw new Error("인터레이스 PNG 는 지원하지 않습니다");
  const ch = CHANNELS[ihdr.colorType];
  if (!ch) throw new Error(`colorType ${ihdr.colorType} 은 지원하지 않습니다`);

  const { width: w, height: h } = ihdr;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length < h * (stride + 1)) throw new Error("IDAT 가 잘렸습니다");

  const out = Buffer.allocUnsafe(w * h * 3);
  const prev = Buffer.alloc(stride);
  const line = Buffer.allocUnsafe(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = src[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (ft !== 0) throw new Error(`필터 ${ft} 를 모릅니다`);
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch, d = (y * w + x) * 3;
      if (ch >= 3) { out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; }
      else { out[d] = out[d + 1] = out[d + 2] = line[s]; }
    }
    prev.set(line);
  }
  return { width: w, height: h, data: out };
}

export function readPNG(file) {
  return decodePNG(readFileSync(file));
}
