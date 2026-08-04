/**
 * 회전 렌더. 의존성 없이 PPM(원시 RGB) → 회전 → PNG 로 만듭니다.
 *
 * 이 코퍼스에는 가로 자료를 세로 A4 에 눕혀서 넣은 PDF 가 섞여 있습니다.
 * PDF 의 /Rotate 는 0 이라 메타데이터로는 못 잡고, 비전 모델에 그대로 넣으면
 * 글자를 못 읽고 **그럴듯한 내용을 지어냅니다.** 반드시 세워서 넣어야 합니다.
 *
 * poppler 의 pdftoppm/pdftocairo 에는 회전 옵션이 없어서 직접 돌립니다.
 */
import zlib from "node:zlib";

/** P6 PPM 파싱. 헤더는 공백으로 구분된 토큰 3개(width height maxval) 뒤 원시 바이트. */
export function parsePPM(buf) {
  if (buf[0] !== 0x50 || buf[1] !== 0x36) throw new Error("P6 PPM 이 아닙니다");
  let pos = 2;
  const nums = [];
  while (nums.length < 3) {
    while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; continue; } // 주석
    let s = "";
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++]);
    nums.push(Number(s));
  }
  pos++; // 헤더 뒤 공백 1
  const [width, height, maxval] = nums;
  if (maxval !== 255) throw new Error(`maxval=${maxval} 은 지원하지 않습니다`);
  return { width, height, data: buf.subarray(pos, pos + width * height * 3) };
}

/** 90 / 180 / 270 도 회전. 시계방향 기준. */
export function rotateRGB({ width, height, data }, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return { width, height, data };
  const out = Buffer.allocUnsafe(data.length);
  const nw = d === 180 ? width : height;
  const nh = d === 180 ? height : width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 3;
      let nx, ny;
      if (d === 90) { nx = height - 1 - y; ny = x; }
      else if (d === 180) { nx = width - 1 - x; ny = height - 1 - y; }
      else { nx = y; ny = width - 1 - x; }        // 270
      const di = (ny * nw + nx) * 3;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2];
    }
  }
  return { width: nw, height: nh, data: out };
}

const crc32 = zlib.crc32 ?? (() => {
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    T[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** RGB8 → PNG. 필터는 전부 0(None) 으로 두고 zlib 에 맡깁니다. */
export function encodePNG({ width, height, data }) {
  const raw = Buffer.allocUnsafe(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    raw[o] = 0;
    data.copy(raw, o + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function ppmToRotatedPng(ppmBuffer, deg) {
  return encodePNG(rotateRGB(parsePPM(ppmBuffer), deg));
}
