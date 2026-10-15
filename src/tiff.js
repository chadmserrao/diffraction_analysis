// Minimal TIFF reader: classic + BigTIFF, strips or tiles, none/LZW/PackBits/Deflate,
// 8/16/32-bit int or float, 1-4 samples, horizontal predictor.
// Returns {width, height, gray: Float32Array, bits, info}.
(function (DP) {
  'use strict';

  function lzwDecode(src, n) {
    const out = new Uint8Array(n);
    const st = new Int32Array(4096), ln = new Int32Array(4096);
    const total = src.length * 8;
    let op = 0, bitpos = 0, width = 9, next = 258, first = true, pStart = 0, pLen = 0;
    for (;;) {
      if (bitpos + width > total) break;
      const b = bitpos >> 3, off = bitpos & 7;
      const x = (src[b] << 16) | ((src[b + 1] || 0) << 8) | (src[b + 2] || 0);
      const c = (x >> (24 - off - width)) & ((1 << width) - 1);
      bitpos += width;
      if (c === 257) break;
      if (c === 256) { width = 9; next = 258; first = true; continue; }
      const start = op;
      let l;
      if (c < 256) {
        if (op < n) out[op] = c;
        op++; l = 1;
      } else if (c < next && !first) {
        const s = st[c]; l = ln[c];
        for (let i = 0; i < l && op + i < n; i++) out[op + i] = out[s + i];
        op += l;
      } else {
        // KwKwK case: previous string + its first byte
        l = pLen + 1;
        for (let i = 0; i < pLen && op + i < n; i++) out[op + i] = out[pStart + i];
        if (op + pLen < n) out[op + pLen] = out[pStart];
        op += l;
      }
      if (!first && next < 4096) { st[next] = pStart; ln[next] = pLen + 1; next++; }
      first = false;
      pStart = start; pLen = l;
      if (next >= (1 << width) - 1 && width < 12) width++;
      if (op >= n) break;
    }
    return out;
  }

  function packBitsDecode(src, n) {
    const out = new Uint8Array(n);
    let i = 0, o = 0;
    while (i < src.length && o < n) {
      let h = src[i++];
      if (h > 127) h -= 256;
      if (h >= 0) { for (let k = 0; k <= h && o < n; k++) out[o++] = src[i++]; }
      else if (h !== -128) { const v = src[i++]; for (let k = 0; k < 1 - h && o < n; k++) out[o++] = v; }
    }
    return out;
  }

  async function inflate(src) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Deflate TIFF needs a newer browser');
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([src]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function parseIFDs(dv, le) {
    const magic = dv.getUint16(2, le);
    const big = magic === 43;
    if (magic !== 42 && !big) throw new Error('Not a TIFF file');
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
    const rd = (t, p) => {
      switch (t) {
        case 1: case 2: case 7: return dv.getUint8(p);
        case 6: return dv.getInt8(p);
        case 3: return dv.getUint16(p, le);
        case 8: return dv.getInt16(p, le);
        case 4: return dv.getUint32(p, le);
        case 9: return dv.getInt32(p, le);
        case 5: return dv.getUint32(p, le) / (dv.getUint32(p + 4, le) || 1);
        case 10: return dv.getInt32(p, le) / (dv.getInt32(p + 4, le) || 1);
        case 11: return dv.getFloat32(p, le);
        case 12: return dv.getFloat64(p, le);
        case 16: case 18: return Number(dv.getBigUint64(p, le));
        case 17: return Number(dv.getBigInt64(p, le));
        default: return 0;
      }
    };
    let off = big ? Number(dv.getBigUint64(8, le)) : dv.getUint32(4, le);
    const ifds = [];
    let guard = 0;
    while (off && off < dv.byteLength && guard++ < 64) {
      const n = big ? Number(dv.getBigUint64(off, le)) : dv.getUint16(off, le);
      const entSize = big ? 20 : 12, head = big ? 8 : 2;
      const tags = {};
      for (let i = 0; i < n; i++) {
        const e = off + head + i * entSize;
        const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le);
        const count = big ? Number(dv.getBigUint64(e + 4, le)) : dv.getUint32(e + 4, le);
        const sz = (sizes[type] || 1) * count;
        const inline = big ? 8 : 4;
        const vp = sz <= inline ? e + (big ? 12 : 8) : (big ? Number(dv.getBigUint64(e + 12, le)) : dv.getUint32(e + 8, le));
        if (tag === 270 && type === 2) {
          let s = ''; for (let k = 0; k < Math.min(count, 4096); k++) s += String.fromCharCode(dv.getUint8(vp + k));
          tags[tag] = s.replace(/\0+$/, '');
        } else if (count > 100000 && tag !== 273 && tag !== 279 && tag !== 324 && tag !== 325) {
          tags[tag] = null; // skip large private blobs
        } else {
          const vals = new Array(count);
          for (let k = 0; k < count; k++) vals[k] = rd(type, vp + k * (sizes[type] || 1));
          tags[tag] = vals;
        }
      }
      ifds.push(tags);
      const np = off + head + n * entSize;
      off = big ? Number(dv.getBigUint64(np, le)) : dv.getUint32(np, le);
    }
    return ifds;
  }

  async function readTIFF(buf) {
    const dv = new DataView(buf);
    const bo = dv.getUint16(0, false);
    if (bo !== 0x4949 && bo !== 0x4d4d) throw new Error('Not a TIFF file');
    const le = bo === 0x4949;
    const ifds = parseIFDs(dv, le);
    const g = (t, k, d) => (t[k] ? t[k][0] : d);
    let best = null, bestPx = -1;
    for (const t of ifds) {
      if (!t[256] || !t[257]) continue;
      if (g(t, 254, 0) & 1) continue; // reduced-resolution thumbnail
      const px = g(t, 256) * g(t, 257);
      if (px > bestPx) { bestPx = px; best = t; }
    }
    if (!best) throw new Error('No image in TIFF');
    const t = best;
    const W = g(t, 256), H = g(t, 257);
    const spp = g(t, 277, 1);
    const bps = t[258] ? t[258][0] : 1;
    const comp = g(t, 259, 1), photo = g(t, 262, 1), planar = g(t, 284, 1);
    const pred = g(t, 317, 1), fmt = g(t, 339, 1);
    if (![8, 16, 32].includes(bps)) throw new Error('Unsupported TIFF bit depth ' + bps);
    const bpsB = bps / 8;
    const tiled = !!t[322];
    const tw = tiled ? g(t, 322) : W, th = tiled ? g(t, 323) : g(t, 278, H);
    const offs = tiled ? t[324] : t[273], cnts = tiled ? t[325] : t[279];
    const planes = planar === 2 ? spp : 1;
    const sppChunk = planar === 2 ? 1 : spp;
    const across = tiled ? Math.ceil(W / tw) : 1, down = Math.ceil(H / th);
    const raw = new Uint8Array(W * H * spp * bpsB);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < offs.length; i++) {
      const plane = Math.floor(i / (across * down));
      if (plane >= planes) break;
      const idx = i % (across * down);
      const cx = idx % across, cy = Math.floor(idx / across);
      const rowsHere = tiled ? th : Math.min(th, H - cy * th);
      const chunkW = tiled ? tw : W;
      const rowBytes = chunkW * sppChunk * bpsB;
      const need = rowBytes * rowsHere;
      const src = u8.subarray(offs[i], offs[i] + cnts[i]);
      let dec;
      if (comp === 1) dec = src;
      else if (comp === 5) dec = lzwDecode(src, need);
      else if (comp === 32773) dec = packBitsDecode(src, need);
      else if (comp === 8 || comp === 32946) dec = await inflate(src);
      else throw new Error('Unsupported TIFF compression ' + comp);
      if (pred === 2) {
        for (let r = 0; r < rowsHere; r++) {
          const base = r * rowBytes;
          if (bpsB === 1) {
            for (let k = sppChunk; k < chunkW * sppChunk; k++) dec[base + k] = (dec[base + k] + dec[base + k - sppChunk]) & 255;
          } else if (bpsB === 2) {
            const v = new DataView(dec.buffer, dec.byteOffset + base, rowBytes);
            for (let k = sppChunk; k < chunkW * sppChunk; k++) v.setUint16(k * 2, (v.getUint16(k * 2, le) + v.getUint16((k - sppChunk) * 2, le)) & 65535, le);
          }
        }
      }
      // copy into raw (interleaved samples, file byte order)
      for (let r = 0; r < rowsHere; r++) {
        const y = cy * th + r;
        if (y >= H) break;
        const x0 = cx * tw, wHere = Math.min(chunkW, W - x0);
        for (let x = 0; x < wHere; x++) {
          for (let s = 0; s < sppChunk; s++) {
            const sIdx = planar === 2 ? plane : s;
            const dst = ((y * W + x0 + x) * spp + sIdx) * bpsB;
            const sp = (r * chunkW + x) * sppChunk * bpsB + s * bpsB;
            for (let b = 0; b < bpsB; b++) raw[dst + b] = dec[sp + b];
          }
        }
      }
    }
    const rv = new DataView(raw.buffer);
    const N = W * H;
    const gray = new Float32Array(N);
    const sample = (i) => {
      const p = i * bpsB;
      if (bpsB === 1) return fmt === 2 ? rv.getInt8(p) : raw[p];
      if (bpsB === 2) return fmt === 2 ? rv.getInt16(p, le) : rv.getUint16(p, le);
      if (fmt === 3) return rv.getFloat32(p, le);
      return fmt === 2 ? rv.getInt32(p, le) : rv.getUint32(p, le);
    };
    if (photo === 3 && t[320]) {
      const cm = t[320], n3 = cm.length / 3;
      for (let i = 0; i < N; i++) { const v = sample(i * spp); gray[i] = (cm[v] + cm[v + n3] + cm[v + 2 * n3]) / 3 / 257; }
    } else if (spp >= 3 && photo === 2) {
      for (let i = 0; i < N; i++) gray[i] = 0.299 * sample(i * spp) + 0.587 * sample(i * spp + 1) + 0.114 * sample(i * spp + 2);
    } else {
      for (let i = 0; i < N; i++) gray[i] = sample(i * spp);
      if (photo === 0) { let mx = -Infinity; for (let i = 0; i < N; i++) if (gray[i] > mx) mx = gray[i]; for (let i = 0; i < N; i++) gray[i] = mx - gray[i]; }
    }
    return { width: W, height: H, gray, bits: bps, info: { compression: comp, samples: spp, description: t[270] || '' } };
  }

  DP.readTIFF = readTIFF;
  DP._lzwDecode = lzwDecode;
})(typeof globalThis !== 'undefined' ? (globalThis.DP = globalThis.DP || {}) : {});
