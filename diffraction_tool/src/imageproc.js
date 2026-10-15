// Diffraction pattern analysis: scale bar, masks, center, radial profile, rings, spots.
// All returned coordinates are in ORIGINAL image pixels.
(function (DP) {
  'use strict';

  // ---------- basic helpers ----------
  function percentiles(a, ps, mask) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.length; i++) { if (mask && mask[i]) continue; const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) return ps.map(() => 0);
    const NB = 4096, h = new Uint32Array(NB), sc = (NB - 1) / (hi - lo || 1);
    let n = 0;
    for (let i = 0; i < a.length; i++) { if (mask && mask[i]) continue; h[Math.round((a[i] - lo) * sc)]++; n++; }
    return ps.map((p) => {
      const target = p / 100 * n; let c = 0;
      for (let k = 0; k < NB; k++) { c += h[k]; if (c >= target) return lo + k / sc; }
      return hi;
    });
  }

  function downsample(img, W, H, f) {
    if (f === 1) return { data: Float32Array.from(img), W, H };
    const w = Math.floor(W / f), h = Math.floor(H / f), out = new Float32Array(w * h), inv = 1 / (f * f);
    for (let y = 0; y < h; y++) for (let dy = 0; dy < f; dy++) {
      const row = (y * f + dy) * W;
      for (let x = 0; x < w; x++) { let s = 0; const b = row + x * f; for (let dx = 0; dx < f; dx++) s += img[b + dx]; out[y * w + x] += s * inv; }
    }
    return { data: out, W: w, H: h };
  }

  function blur1d(src, dst, W, H, sigma, horiz) {
    const r = Math.max(1, Math.ceil(3 * sigma)), k = new Float32Array(2 * r + 1);
    let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const n = horiz ? W : H, m = horiz ? H : W, step = horiz ? 1 : W, lineStep = horiz ? W : 1;
    for (let j = 0; j < m; j++) {
      const base = j * lineStep;
      for (let i = 0; i < n; i++) {
        let a = 0;
        if (i >= r && i < n - r) { let p = base + (i - r) * step; for (let t = 0; t <= 2 * r; t++, p += step) a += src[p] * k[t]; }
        else { for (let t = -r; t <= r; t++) { let ii = i + t; ii = ii < 0 ? 0 : ii >= n ? n - 1 : ii; a += src[base + ii * step] * k[t + r]; } }
        dst[base + i * step] = a;
      }
    }
  }
  function boxPass(src, dst, W, H, r, horiz) {
    const n = horiz ? W : H, m = horiz ? H : W, step = horiz ? 1 : W, lineStep = horiz ? W : 1, inv = 1 / (2 * r + 1);
    for (let j = 0; j < m; j++) {
      const base = j * lineStep, last = base + (n - 1) * step;
      let acc = 0;
      for (let i = -r; i <= r; i++) { const ii = i < 0 ? 0 : i >= n ? n - 1 : i; acc += src[base + ii * step]; }
      for (let i = 0; i < n; i++) {
        dst[base + i * step] = acc * inv;
        const ai = i + r + 1, ri = i - r;
        acc += src[ai >= n ? last : base + ai * step] - src[ri < 0 ? base : base + ri * step];
      }
    }
  }
  function blur(img, W, H, sigma) {
    if (sigma > 4) {
      const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
      let a = Float32Array.from(img), b = new Float32Array(img.length);
      for (let k = 0; k < 3; k++) { boxPass(a, b, W, H, r, true); boxPass(b, a, W, H, r, false); }
      return a;
    }
    const t = new Float32Array(img.length), o = new Float32Array(img.length);
    blur1d(img, t, W, H, sigma, true); blur1d(t, o, W, H, sigma, false); return o;
  }

  function dilate(mask, W, H, r) {
    if (r < 1) return mask;
    const t = new Uint8Array(mask.length), o = new Uint8Array(mask.length);
    for (let y = 0; y < H; y++) { let last = -1e9; const row = y * W;
      for (let x = 0; x < W; x++) { if (mask[row + x]) last = x; if (x - last <= r) t[row + x] = 1; }
      last = 1e9; for (let x = W - 1; x >= 0; x--) { if (mask[row + x]) last = x; if (last - x <= r) t[row + x] = 1; } }
    for (let x = 0; x < W; x++) { let last = -1e9;
      for (let y = 0; y < H; y++) { if (t[y * W + x]) last = y; if (y - last <= r) o[y * W + x] = 1; }
      last = 1e9; for (let y = H - 1; y >= 0; y--) { if (t[y * W + x]) last = y; if (last - y <= r) o[y * W + x] = 1; } }
    return o;
  }

  // connected components over a boolean mask (4-connectivity); returns list of {x0,y0,x1,y1,n,pixels?}
  function components(mask, W, H, keepPixels) {
    const lab = new Int32Array(mask.length), out = [], stack = new Int32Array(mask.length);
    let id = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || lab[i]) continue;
      id++; let sp = 0; stack[sp++] = i; lab[i] = id;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0, touches = false;
      const px = keepPixels ? [] : null;
      while (sp) {
        const p = stack[--sp], x = p % W, y = (p / W) | 0; n++;
        if (px) px.push(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
        if (y < H - 1 && mask[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
      }
      out.push({ id, x0, y0, x1: x1 + 1, y1: y1 + 1, n, touches, pixels: px });
    }
    return { comps: out, labels: lab };
  }

  // ---------- FFT ----------
  function fft1(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  function fft2(re, im, N, inv) {
    const r = new Float64Array(N), i2 = new Float64Array(N);
    for (let y = 0; y < N; y++) { const o = y * N; for (let x = 0; x < N; x++) { r[x] = re[o + x]; i2[x] = im[o + x]; } fft1(r, i2, inv); for (let x = 0; x < N; x++) { re[o + x] = r[x]; im[o + x] = i2[x]; } }
    for (let x = 0; x < N; x++) { for (let y = 0; y < N; y++) { r[y] = re[y * N + x]; i2[y] = im[y * N + x]; } fft1(r, i2, inv); for (let y = 0; y < N; y++) { re[y * N + x] = r[y]; im[y * N + x] = i2[y]; } }
  }
  function selfConvPair(a, b, W, H) {
    let N = 1; while (N < 2 * Math.max(W, H)) N <<= 1;
    // pack a in real, b in imag: one forward FFT for both
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { re[y * N + x] = a[y * W + x]; im[y * N + x] = b[y * W + x]; }
    fft2(re, im, N, false);
    // separate spectra: A(k) = (Z(k) + conj Z(-k))/2, B(k) = (Z(k) - conj Z(-k))/(2i)
    const pr = new Float64Array(N * N), pi = new Float64Array(N * N);
    for (let ky = 0; ky < N; ky++) for (let kx = 0; kx < N; kx++) {
      const i = ky * N + kx, j = ((N - ky) % N) * N + ((N - kx) % N);
      const zr = re[i], zi = im[i], wr = re[j], wi = -im[j];
      const ar = (zr + wr) / 2, ai = (zi + wi) / 2;
      const br = (zi - wi) / 2, bi = -(zr - wr) / 2;
      pr[i] = ar * br - ai * bi; pi[i] = ar * bi + ai * br;
    }
    fft2(pr, pi, N, true);
    return { data: pr, N };
  }

  // ---------- scale bar ----------
  function detectScaleBar(gray, W, H) {
    let mx = -Infinity; for (let i = 0; i < gray.length; i++) if (gray[i] > mx) mx = gray[i];
    const mask = new Uint8Array(gray.length);
    const thr = mx * 0.98;
    for (let i = 0; i < gray.length; i++) if (gray[i] >= thr) mask[i] = 1;
    const { comps, labels } = components(mask, W, H, false);
    let bar = null;
    for (const c of comps) {
      const w = c.x1 - c.x0, h = c.y1 - c.y0;
      if (w > 0.04 * W && h < 0.03 * H && w > 8 * h && c.n / (w * h) > 0.9) {
        if (!bar || w > bar.w) bar = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, w, h };
      }
    }
    if (!bar) return null;
    const res = { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bar.y1, lengthPx: bar.w, thickness: bar.h, value: null, unit: null, text: '', confidence: 0 };
    // ---- read the label above the bar ----
    const bh = bar.h;
    const rx0 = Math.max(0, bar.x0 - 2 * bh), rx1 = Math.min(W, bar.x0 + Math.max(bar.w, 30 * bh));
    const ry0 = Math.max(0, bar.y0 - 14 * bh), ry1 = Math.max(ry0 + 1, bar.y0 - 1);
    const rw = rx1 - rx0, rh = ry1 - ry0;
    // threshold halfway between local background and the bar's white level
    const vals = []; for (let y = 0; y < rh; y += 2) for (let x = 0; x < rw; x += 2) vals.push(gray[(ry0 + y) * W + rx0 + x]);
    vals.sort((p, q) => p - q);
    const bgv = vals[vals.length >> 1] || 0, tthr = bgv + 0.55 * (mx - bgv);
    const reg = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (gray[(ry0 + y) * W + rx0 + x] >= tthr) reg[y * rw + x] = 1;
    const cc = components(reg, rw, rh, true);
    const bigs = cc.comps.filter((c) => (c.y1 - c.y0) >= 0.8 * bh && (c.y1 - c.y0) < 7.5 * bh && (c.x1 - c.x0) < 6 * bh);
    if (!bigs.length) { res.confidence = 0; return res; }
    const th = Math.max(...bigs.map((b) => b.y1 - b.y0));
    const baseline = Math.max(...bigs.map((b) => b.y1));
    const lineTop = baseline - th;
    // all components that belong to the text line (includes dots, superscripts)
    const line = cc.comps.filter((c) => { const h = c.y1 - c.y0; return h > 0.06 * th && h <= 1.05 * th && c.y1 <= baseline + 0.1 * th && c.y0 >= lineTop - 0.35 * th && c.n > 4; });
    line.sort((a, b) => a.x0 - b.x0);
    const words = [[line[0]]];
    for (const b of line.slice(1)) { const last = words[words.length - 1]; const gap = b.x0 - Math.max(...last.map((q) => q.x1)); if (gap > 0.3 * th) words.push([b]); else last.push(b); }
    res.textBox = { x0: rx0 + Math.min(...line.map((b) => b.x0)), y0: ry0 + Math.min(...line.map((b) => b.y0)), x1: rx0 + Math.max(...line.map((b) => b.x1)), y1: ry0 + Math.max(...line.map((b) => b.y1)) };
    // if a '/' sits inside the first word (tight spacing), the unit "1/.." starts one glyph before it
    const isSlash = (g) => (g.y1 - g.y0) > 0.85 * th && (g.x1 - g.x0) < 0.6 * (g.y1 - g.y0) && (g.x1 - g.x0) > 0.2 * (g.y1 - g.y0) && isDiagonal(cc.labels, rw, g);
    const si = words[0].findIndex(isSlash);
    if (si > 1) { const unitPart = words[0].slice(si - 1); words[0] = words[0].slice(0, si - 1); words.splice(1, 0, unitPart); }
    let txt = '', worst = 0, ok = true, margin = 1;
    if (DP.OCR_DEBUG) console.log('th', th, 'bh', bh, 'words', words.map((wd) => wd.map((g) => [g.x1 - g.x0, g.y1 - g.y0, g.y1 - baseline].join('x')).join(' ')).join(' | '));
    for (const g of words[0]) {
      const h = g.y1 - g.y0, wd = g.x1 - g.x0;
      if (h < 0.3 * th && wd < 0.3 * th && Math.abs(g.y1 - baseline) < 0.15 * th) { txt += '.'; continue; }
      if (h < 0.5 * th) continue; // stray blob (noise or bright spot), not part of the number
      const r = classifyGlyph(cc.labels, rw, g);
      if (DP.OCR_DEBUG) console.log('glyph', JSON.stringify(r));
      if (!r) { ok = false; break; }
      txt += r.ch; worst = Math.max(worst, r.err); margin = Math.min(margin, r.margin);
    }
    res.text = txt;
    const val = ok ? parseFloat(txt) : NaN;
    if (ok && isFinite(val) && val > 0) {
      res.value = val;
      const m = val / Math.pow(10, Math.floor(Math.log10(val)));
      const niceStep = [1, 2, 5].some((s2) => Math.abs(m - s2) < 1e-6);
      res.confidence = Math.max(0, Math.min(1, (0.4 - worst) / 0.25)) * Math.min(1, margin / 0.08) * (niceStep ? 1 : 0.5);
    }
    // units: '/' (tall thin stroke) or a raised superscript means reciprocal space
    const w2 = words[1] || [];
    const hasSlash = w2.some(isSlash);
    const hasSup = w2.some((g) => (g.y1 - g.y0) < 0.55 * th && g.y1 < baseline - 0.35 * th);
    res.unit = hasSlash || hasSup ? '1/nm' : w2.length ? 'nm' : null;
    return res;
  }

  function classifyGlyph(labels, rw, g) {
    const T = DP.OCR_TEMPLATES; if (!T) return null;
    const GW = DP.OCR_GW, GH = DP.OCR_GH;
    const w = g.x1 - g.x0, h = g.y1 - g.y0;
    // bilinear resample of the binary glyph into GWxGH
    const v = new Float32Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const sx = (x + 0.5) * w / GW - 0.5, sy = (y + 0.5) * h / GH - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
      const at = (xx, yy) => (labels[(g.y0 + yy) * rw + g.x0 + xx] === g.id ? 1 : 0);
      v[y * GW + x] = at(x0, y0) * (1 - fx) * (1 - fy) + at(x1, y0) * fx * (1 - fy) + at(x0, y1) * (1 - fx) * fy + at(x1, y1) * fx * fy;
    }
    let best = null, second = null;
    const all = Object.assign({}, T, DP.OCR_EXTRA || {});
    for (const key in all) {
      const t = all[key]; let e = 0;
      for (let i = 0; i < v.length; i++) { const d = v[i] - t[i]; e += d * d; }
      e = Math.sqrt(e / v.length);
      const ch = key.charAt(0);
      if (!best || e < best.err) { if (best && best.ch !== ch) second = best; best = { ch, err: e }; }
      else if (ch !== best.ch && (!second || e < second.err)) second = { ch, err: e };
    }
    if (DP.OCR_DEBUG) console.log('best', JSON.stringify(best), JSON.stringify(second));
    if (!best || best.err > 0.4) return null;
    best.margin = second ? second.err - best.err : 1;
    return best;
  }

  function isDiagonal(labels, rw, g) {
    // centroid of top rows vs bottom rows shifted horizontally => slanted stroke
    const h = g.y1 - g.y0, band = Math.max(1, Math.round(h * 0.2));
    const cxAt = (y0, y1) => { let s2 = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = g.x0; x < g.x1; x++) if (labels[y * rw + x] === g.id) { s2 += x; n++; } return n ? s2 / n : 0; };
    return cxAt(g.y0, g.y0 + band) - cxAt(g.y1 - band, g.y1) > 0.25 * (g.x1 - g.x0);
  }

  // ---------- main analysis ----------
  function analyze(gray, W, H, opts) {
    opts = Object.assign({ preset: 'auto', spotSigma: 5, scaleBar: null, maxWork: 2048 }, opts || {});
    const t0 = Date.now();
    const f = Math.max(1, Math.ceil(Math.max(W, H) / opts.maxWork));
    const ds = downsample(gray, W, H, f);
    const w = ds.W, h = ds.H, g = ds.data, N = w * h;
    const toOrig = (v) => (v + 0.5) * f - 0.5;

    // --- exclusion mask ---
    const excl = new Uint8Array(N);
    const sb = opts.scaleBar;
    const boxes = [];
    if (sb) { boxes.push(sb); if (sb.textBox) boxes.push(sb.textBox); }
    for (const b of boxes) {
      const pad = Math.max(3, (b.y1 - b.y0) * 0.4);
      for (let y = Math.max(0, Math.floor((b.y0 - pad) / f)); y < Math.min(h, Math.ceil((b.y1 + pad) / f)); y++)
        for (let x = Math.max(0, Math.floor((b.x0 - pad) / f)); x < Math.min(w, Math.ceil((b.x1 + pad) / f)); x++) excl[y * w + x] = 1;
    }
    const gl = blur(g, w, h, 1.5);
    const gb = blur(g, w, h, 2);
    const [p1, p50, p99, p999] = percentiles(gb, [1, 50, 99, 99.9], excl);
    const dark = new Uint8Array(N);
    const darkThr = p1 + 0.35 * (p50 - p1);
    let nd = 0;
    for (let i = 0; i < N; i++) if (gb[i] < darkThr && gb[i] < 0.4 * p50 + 0.6 * p1 + 1e-6) { dark[i] = 1; nd++; }
    let stopper = new Uint8Array(N), stopperAngle = null, stopperArea = 0, stopperTip = null;
    if (nd / N < 0.5 && p50 - p1 > 2) {
      const cc = components(dark, w, h, true).comps.filter((c) => (c.touches && c.n > 0.002 * N) || c.n > 0.004 * N);
      let bestTip = null;
      for (const c of cc) {
        for (const p of c.pixels) stopper[p] = 1; stopperArea += c.n;
        // deepest dark point (farthest from every image border) = stopper bulb over the direct beam
        let far = -1, tx = 0, ty = 0;
        for (const p of c.pixels) { const x = p % w, y = (p / w) | 0, d = Math.min(x, w - 1 - x, y, h - 1 - y); if (d > far) { far = d; tx = x; ty = y; } }
        if (!bestTip || far > bestTip.depth) bestTip = { x: tx, y: ty, depth: far };
      }
      if (bestTip && bestTip.depth < 0.12 * Math.min(w, h)) bestTip = null;
      stopperTip = bestTip;
    }
    stopper = dilate(stopper, w, h, Math.round(0.012 * w));
    // saturated core (large saturated blobs, e.g. central beam around the stopper tip)
    let gmax = -Infinity; for (let i = 0; i < N; i++) if (g[i] > gmax) gmax = g[i];
    const sat = new Uint8Array(N); let nsat = 0;
    for (let i = 0; i < N; i++) if (g[i] >= gmax * 0.995) { sat[i] = 1; nsat++; }
    let satCore = new Uint8Array(N);
    if (nsat) { for (const c of components(sat, w, h, true).comps) if (c.n > 0.0001 * N) for (const p of c.pixels) satCore[p] = 1; }
    satCore = dilate(satCore, w, h, Math.round(0.006 * w));
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = excl[i] | stopper[i] | satCore[i];

    const rMaxAll = Math.hypot(w, h);
    function findCenter() {
    // --- centre: masked normalised cross-correlation of the pattern with its 180-degree rotation ---
    const logOff = Math.max(1, p1);
    const fs = Math.max(1, Math.round(Math.max(w, h) / 250));
    const cmask = dilate(mask, w, h, Math.round(0.012 * w));
    const sm = downsample(g, w, h, fs), smMask = downsample(Float32Array.from(cmask), w, h, fs);
    // the direct beam sits under the stopper tip: restrict the search there when a stopper exists
    // with no stopper, the unblocked direct beam (largest bright blob) marks the centre
    let beamBlob = null;
    if (!stopperTip) {
      const bt = new Uint8Array(N); const thrB = p1 + 0.6 * (gmax - p1);
      for (let i = 0; i < N; i++) if (gb[i] >= thrB && !excl[i]) bt[i] = 1;
      let big = null; for (const c of components(bt, w, h, true).comps) if (!big || c.n > big.n) big = c;
      if (big && big.n > 0.0002 * N) { let sx = 0, sy = 0; for (const p of big.pixels) { sx += p % w; sy += (p / w) | 0; } beamBlob = { x: sx / big.n, y: sy / big.n, r: Math.sqrt(big.n / Math.PI) }; }
    }
    const tipOK = (x, y) => beamBlob ? Math.hypot(x - beamBlob.x, y - beamBlob.y) < Math.max(0.02 * w, beamBlob.r) : true;
    const sw_ = sm.W, sh_ = sm.H;
    const smLog = new Float32Array(sw_ * sh_);
    for (let i = 0; i < smLog.length; i++) smLog[i] = Math.log(Math.max(0, sm.data[i] - p1) + logOff);
    // band-pass version emphasises rings/spots (strictly Friedel-symmetric) over uneven glow
    const smLow = blur(smLog, sw_, sh_, 0.03 * sw_);
    const smBP = new Float32Array(smLog.length); for (let i = 0; i < smBP.length; i++) smBP[i] = smLog[i] - smLow[i];
    const para = (m, c0, p0) => { const d2 = m - 2 * c0 + p0; return d2 < 0 && isFinite(m) && isFinite(p0) ? Math.max(-1, Math.min(1, 0.5 * (m - p0) / d2)) : 0; };
    function coarse(img, K) {
      const u = new Float32Array(img.length), v = new Float32Array(img.length), u2 = new Float32Array(img.length);
      for (let i = 0; i < u.length; i++) { if (smMask.data[i] > 0.05) continue; u[i] = img[i]; v[i] = 1; u2[i] = img[i] * img[i]; }
      const cUU = selfConvPair(u, u, sw_, sh_), cUV = selfConvPair(u, v, sw_, sh_), cVV = selfConvPair(v, v, sw_, sh_), cSV = selfConvPair(u2, v, sw_, sh_);
      const Nc = cUU.N;
      let vmax = 0; for (let i = 0; i < cVV.data.length; i++) vmax = Math.max(vmax, cVV.data[i]);
      const at = (px, py) => { const i = py * Nc + px, n = cVV.data[i]; if (n < 0.2 * vmax) return -2; const s1 = cUV.data[i], mu = s1 / n, num = cUU.data[i] - s1 * mu, den = cSV.data[i] - s1 * mu; return den > 1e-9 ? num / den : -2; };
      const x0 = Math.round(0.4 * sw_), x1 = Math.round(1.6 * sw_), y0 = Math.round(0.4 * sh_), y1 = Math.round(1.6 * sh_);
      const gw = x1 - x0, gh = y1 - y0, map = new Float32Array(gw * gh);
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) map[(py - y0) * gw + px - x0] = at(px, py);
      const peaks = [], rad = Math.max(3, Math.round(0.04 * sw_));
      for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
        const val = map[y * gw + x]; if (val <= -1) continue;
        let isMax = true;
        for (let dy = -rad; dy <= rad && isMax; dy++) for (let dx = -rad; dx <= rad; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= gh || xx >= gw || (!dx && !dy)) continue; const o = map[yy * gw + xx]; if (o > val || (o === val && yy * gw + xx < y * gw + x)) { isMax = false; break; } }
        if (isMax) peaks.push([val, x, y]);
      }
      peaks.sort((p2, q2) => q2[0] - p2[0]);
      return peaks.slice(0, K).map(([val, x, y]) => {
        const px = x + x0, py = y + y0;
        const ox = para(at(px - 1, py), val, at(px + 1, py)), oy = para(at(px, py - 1), val, at(px, py + 1));
        return { x: ((px + ox) / 2 + 0.5) * fs - 0.5, y: ((py + oy) / 2 + 0.5) * fs - 0.5, q: val };
      });
    }
    const candLog = coarse(smLog, 3), candBP = coarse(smBP, 4);
    // Friedel midpoint voting: every symmetric spot pair's midpoint is the centre (precise for spot-rich patterns)
    let friedel = null;
    {
      const dog = blur(gl, w, h, Math.max(4, 0.004 * w));
      const r = new Float32Array(N); for (let i = 0; i < N; i++) r[i] = cmask[i] ? 0 : gl[i] - dog[i];
      const [p99r] = percentiles(r, [99], cmask);
      const thr = Math.max(10 * (p99 - p1) / 255 + 2, p99r);
      const win = Math.max(3, Math.round(0.002 * w)), pk = [];
      for (let y = Math.round(0.03 * h); y < h - Math.round(0.03 * h); y++) for (let x = Math.round(0.03 * w); x < w - Math.round(0.03 * w); x++) {
        const i = y * w + x, v = r[i]; if (v <= thr || cmask[i]) continue;
        let ok = true; for (let dy = -win; dy <= win && ok; dy++) for (let dx = -win; dx <= win; dx++) { const j = i + dy * w + dx; if (r[j] > v || (r[j] === v && j < i)) { ok = false; break; } }
        if (ok) pk.push([v, x, y]);
      }
      pk.sort((a, b) => b[0] - a[0]); const top = pk.slice(0, 120);
      if (top.length >= 8) {
        const cell = 2, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), grid = new Float32Array(gw * gh), mids = [];
        for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) {
          const dx = top[a][1] - top[b][1], dy = top[a][2] - top[b][2]; if (dx * dx + dy * dy < (0.1 * w) ** 2) continue;
          const mx = (top[a][1] + top[b][1]) / 2, my = (top[a][2] + top[b][2]) / 2; mids.push([mx, my]);
          const gx = Math.floor(mx / cell), gy = Math.floor(my / cell); if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) grid[gy * gw + gx]++;
        }
        let bv = 0, bi = -1;
        for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) { let sum = 0; for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) sum += grid[(gy + yy) * gw + gx + xx]; if (sum > bv) { bv = sum; bi = gy * gw + gx; } }
        if (bi >= 0) {
          const gx0 = (bi % gw + 0.5) * cell, gy0 = (Math.floor(bi / gw) + 0.5) * cell;
          const near = mids.filter(([mx, my]) => Math.hypot(mx - gx0, my - gy0) < 3 * cell);
          if (near.length) friedel = { x: near.reduce((a, q) => a + q[0], 0) / near.length, y: near.reduce((a, q) => a + q[1], 0) / near.length, votes: near.length, spots: top.length };
        }
      }
    }
    // glow centre: peak of the heavily smoothed, mask-normalised image (the direct beam halo)
    let glowC = null;
    {
      const sg = 0.04 * sw_, num = new Float32Array(sm.data.length), den = new Float32Array(sm.data.length);
      for (let i = 0; i < num.length; i++) { const wv = smMask.data[i] > 0.05 ? 0 : 1; num[i] = sm.data[i] * wv; den[i] = wv; }
      const bn = blur(num, sw_, sh_, sg), bd = blur(den, sw_, sh_, sg);
      let bv = -Infinity;
      for (let y = 0; y < sh_; y++) for (let x = 0; x < sw_; x++) { const i = y * sw_ + x; if (bd[i] < 0.3) continue; const v = bn[i] / bd[i]; if (v > bv) { bv = v; glowC = { x: (x + 0.5) * fs - 0.5, y: (y + 0.5) * fs - 0.5 }; } }
    }
    // soft prior: the beam sits under the stopper bulb and inside the glow
    const prior = (x, y) => {
      let p = 1;
      if (stopperTip) p *= 0.25 + 0.75 * Math.exp(-((x - stopperTip.x) ** 2 + (y - stopperTip.y) ** 2) / (2 * (0.1 * w) ** 2));
      if (glowC) p *= 0.25 + 0.75 * Math.exp(-((x - glowC.x) ** 2 + (y - glowC.y) ** 2) / (2 * (0.12 * w) ** 2));
      return p;
    };
    const cLog = candLog[0] || { x: w / 2, y: h / 2, q: -2 }, cBP = candBP[0] || cLog;
    // fine refinement at working resolution on the chosen representation
    const glog = new Float32Array(N);
    for (let i = 0; i < N; i++) glog[i] = Math.log(Math.max(0, gl[i] - p1) + logOff);
    const glow = blur(glog, w, h, 0.03 * w);
    const gbp = new Float32Array(N); for (let i = 0; i < N; i++) gbp[i] = glog[i] - glow[i];
    function nccAt(img, cx0, cy0) {
      let sa = 0, sb2 = 0, saa = 0, sbb = 0, sab = 0, n = 0;
      const step = 4;
      for (let y = 0; y < h; y += step) {
        const iy = Math.round(2 * cy0 - y); if (iy < 0 || iy >= h) continue;
        for (let x = (y / step) % step; x < w; x += step) {
          const i = y * w + x; if (cmask[i]) continue;
          const ix = Math.round(2 * cx0 - x); if (ix < 0 || ix >= w) continue;
          const j = iy * w + ix; if (cmask[j]) continue;
          const A = img[i], B = img[j]; sa += A; sb2 += B; saa += A * A; sbb += B * B; sab += A * B; n++;
        }
      }
      if (n < 100) return -2;
      const cov = sab - sa * sb2 / n, va = saa - sa * sa / n, vb = sbb - sb2 * sb2 / n;
      return cov / Math.sqrt(Math.max(1e-12, va * vb));
    }
    function fine(img, c0) {
      let cx0 = c0.x, cy0 = c0.y, cur = nccAt(img, cx0, cy0);
      for (const stp of [Math.max(1, fs), 1, 0.5]) {
        let moved = true, guard = 0;
        while (moved && guard++ < 10) {
          moved = false;
          for (const [dx, dy] of [[stp, 0], [-stp, 0], [0, stp], [0, -stp], [stp, stp], [-stp, -stp], [stp, -stp], [-stp, stp]]) {
            if (!tipOK(cx0 + dx, cy0 + dy)) continue;
            const val = nccAt(img, cx0 + dx, cy0 + dy);
            if (val > cur) { cur = val; cx0 += dx; cy0 += dy; moved = true; }
          }
        }
      }
      return { x: cx0, y: cy0, q: cur };
    }
    // refine both candidates, then pick/refine by radial-profile sharpness (what the d-spacings depend on)
    const refined = candBP.map((c) => Object.assign(fine(gbp, c), { src: 'bp' })).concat(candLog.map((c) => Object.assign(fine(glog, c), { src: 'log' })));
    if (beamBlob) refined.push(Object.assign(fine(gbp, beamBlob), { src: 'beam' }));
    const fB = refined.find((c) => c.src === 'bp') || refined[0], fL = refined.find((c) => c.src === 'log') || refined[0];
    const RB2 = Math.ceil(rMaxAll) + 2;
    const r0s = Math.round(0.03 * w);
    function sharp(cx0, cy0) {
      const sum = new Float64Array(RB2), cnt = new Float64Array(RB2);
      for (let y = 0; y < h; y += 2) { const dy = y - cy0; for (let x = (y >> 1) & 1; x < w; x += 2) {
        const i = y * w + x; if (cmask[i]) continue;
        const dx = x - cx0, r = Math.sqrt(dx * dx + dy * dy), b = r | 0, fr = r - b;
        sum[b] += glog[i] * (1 - fr); cnt[b] += 1 - fr; sum[b + 1] += glog[i] * fr; cnt[b + 1] += fr;
      } }
      const pr = new Float64Array(RB2).fill(NaN);
      for (let b = r0s; b < RB2; b++) if (cnt[b] > 6 && cnt[b] > 0.15 * Math.PI * b) pr[b] = sum[b] / cnt[b];
      let J = 0, n = 0;
      for (const hw of [Math.round(0.012 * w), Math.round(0.04 * w)]) {
        let acc = 0, k = 0;
        const cs = new Float64Array(RB2 + 1), cn = new Float64Array(RB2 + 1);
        for (let b = 0; b < RB2; b++) { const v = pr[b]; cs[b + 1] = cs[b] + (v === v ? v : 0); cn[b + 1] = cn[b] + (v === v ? 1 : 0); }
        for (let b = r0s + hw; b < RB2 - hw; b++) { const v = pr[b]; if (v !== v) continue; const c = cn[b + hw + 1] - cn[b - hw]; if (c < hw) continue; const m = (cs[b + hw + 1] - cs[b - hw]) / c; acc += (v - m) * (v - m); k++; }
        if (k) { J += acc / k; n++; }
      }
      return n ? J : 0;
    }
    // no-stopper patterns with a visible direct beam: stay on the beam; otherwise let sharpness decide
    const cands = refined.filter((c) => tipOK(c.x, c.y));
    if (DP.DEBUG) console.log('glow', glowC && [glowC.x * f, glowC.y * f].map(Math.round), 'tip', stopperTip && [stopperTip.x * f, stopperTip.y * f].map(Math.round), 'cands', refined.map((c) => [c.src, Math.round(c.x * f), Math.round(c.y * f), prior(c.x, c.y).toFixed(2)].join(',')).join(' '));
    if (!cands.length) cands.push(refined[0]);
    let bestS = null;
    for (const c of cands) { const J = sharp(c.x, c.y) * prior(c.x, c.y); if (!bestS || J > bestS.J) bestS = { x: c.x, y: c.y, J }; }
    for (const stp of [2, 1, 0.5]) {
      let moved = true, guard = 0;
      while (moved && guard++ < 8) {
        moved = false;
        for (const [dx, dy] of [[stp, 0], [-stp, 0], [0, stp], [0, -stp]]) {
          const J = sharp(bestS.x + dx, bestS.y + dy) * prior(bestS.x + dx, bestS.y + dy);
          if (J > bestS.J) { bestS = { x: bestS.x + dx, y: bestS.y + dy, J }; moved = true; }
        }
      }
    }
    // geometric refinement: fit concentric circles to ring peaks sampled along rays
    const gsm = blur(gbp, w, h, 2);
    function ringFit(c0) {
      let x = c0.x, y = c0.y, rms = Infinity, npts = 0;
      for (let it = 0; it < 4; it++) {
        // radial profile of band-passed image about current centre
        const R = Math.ceil(rMaxAll) + 2, sum = new Float64Array(R), cnt = new Float64Array(R);
        for (let yy = 0; yy < h; yy += 2) for (let xx = (yy >> 1) & 1; xx < w; xx += 2) { const i = yy * w + xx; if (cmask[i]) continue; const b = Math.round(Math.hypot(xx - x, yy - y)); sum[b] += gsm[i]; cnt[b]++; }
        const pr = new Float64Array(R); for (let b = 0; b < R; b++) pr[b] = cnt[b] > 0.2 * Math.PI * b && cnt[b] > 6 ? sum[b] / cnt[b] : NaN;
        const rings = [];
        const lo2 = Math.round(0.07 * w);
        for (let b = lo2 + 3; b < R - 3; b++) {
          const v = pr[b]; if (v !== v) continue;
          let ok = true; const win2 = Math.max(4, Math.round(0.02 * w));
          for (let k = -win2; k <= win2; k++) { const u = pr[b + k]; if (u === u && u > v) { ok = false; break; } }
          if (!ok) continue;
          let a = b, c = b; const half = v / 2; while (a > lo2 && pr[a] === pr[a] && pr[a] > half) a--; while (c < R - 1 && pr[c] === pr[c] && pr[c] > half) c++;
          if (v > 0) rings.push({ r: b, v, fw: c - a });
        }
        rings.sort((p2, q2) => q2.v - p2.v);
        const use = rings.slice(0, 3);
        if (!use.length) break;
        const pts = [];
        const NR = 120;
        use.forEach((rg, k) => {
          const dlt = Math.max(0.05 * rg.r, 0.8 * rg.fw, 4);
          for (let q = 0; q < NR; q++) {
            const th = q / NR * 2 * Math.PI, ct = Math.cos(th), st = Math.sin(th);
            let bv = -Infinity, br = -1; const prof = [];
            for (let rr = rg.r - dlt; rr <= rg.r + dlt; rr += 1) {
              const xx = Math.round(x + rr * ct), yy = Math.round(y + rr * st);
              if (xx < 0 || yy < 0 || xx >= w || yy >= h || cmask[yy * w + xx]) { prof.push(NaN); continue; }
              const v = gsm[yy * w + xx]; prof.push(v); if (v > bv) { bv = v; br = prof.length - 1; }
            }
            if (br <= 0 || br >= prof.length - 1 || prof.some((v) => v !== v)) continue;
            const off = para(prof[br - 1], prof[br], prof[br + 1]);
            const rr = rg.r - dlt + br + off;
            pts.push([x + rr * ct, y + rr * st, k]);
          }
        });
        if (pts.length < 20) break;
        // Gauss-Newton on (a, b, R_k) with Tukey weights
        let a = x, b2 = y; const Rk = use.map((rg) => rg.r);
        for (let gn = 0; gn < 8; gn++) {
          const res = pts.map(([px, py, k]) => Math.hypot(px - a, py - b2) - Rk[k]);
          const sd = 1.4826 * res.map(Math.abs).sort((p2, q2) => p2 - q2)[res.length >> 1] + 0.5;
          const nP = 2 + use.length, A = Array.from({ length: nP }, () => new Float64Array(nP)), B = new Float64Array(nP);
          let wsum = 0, r2 = 0;
          pts.forEach(([px, py, k], i) => {
            const d = Math.hypot(px - a, py - b2) || 1, e = res[i], t = e / (4.685 * sd), wt = Math.abs(t) < 1 ? (1 - t * t) ** 2 : 0;
            if (!wt) return;
            const J = new Float64Array(nP); J[0] = -(px - a) / d; J[1] = -(py - b2) / d; J[2 + k] = -1;
            for (let m = 0; m < nP; m++) { B[m] -= wt * J[m] * e; for (let n2 = 0; n2 < nP; n2++) A[m][n2] += wt * J[m] * J[n2]; }
            wsum += wt; r2 += wt * e * e;
          });
          const sol = solveN(A, B); if (!sol) break;
          a += sol[0]; b2 += sol[1]; for (let k = 0; k < use.length; k++) Rk[k] += sol[2 + k];
          rms = Math.sqrt(r2 / Math.max(1, wsum)); npts = wsum;
          if (Math.hypot(sol[0], sol[1]) < 0.05) break;
        }
        const mv = Math.hypot(a - x, b2 - y);
        x = a; y = b2;
        if (mv < 0.1) break;
      }
      return { x, y, rms, npts };
    }
    const fits = [];
    const seen = [];
    for (const c of cands.concat([{ x: bestS.x, y: bestS.y }])) {
      if (seen.some((q2) => Math.hypot(q2.x - c.x, q2.y - c.y) < 2)) continue; seen.push(c);
      const rf = ringFit(c);
      if (isFinite(rf.rms) && rf.npts > 30 && tipOK(rf.x, rf.y) && Math.hypot(rf.x - c.x, rf.y - c.y) < 0.08 * w) fits.push(rf);
    }
    let centerMethod = 'symmetry';
    if (fits.length) {
      // cluster converged fits; independent starts agreeing on a centre is strong evidence
      const tol = Math.max(4, 0.006 * w);
      const clusters = [];
      for (const ft of fits) {
        const cl = clusters.find((c) => Math.hypot(c.x - ft.x, c.y - ft.y) < tol);
        if (cl) { cl.m.push(ft); cl.x = cl.m.reduce((a2, q2) => a2 + q2.x, 0) / cl.m.length; cl.y = cl.m.reduce((a2, q2) => a2 + q2.y, 0) / cl.m.length; }
        else clusters.push({ x: ft.x, y: ft.y, m: [ft] });
      }
      clusters.forEach((c) => { const rr = c.m.map((q2) => q2.rms).sort((a2, b3) => a2 - b3); c.rms = rr[rr.length >> 1]; c.score = c.m.length / (c.rms + 2) * prior(c.x, c.y); if (friedel && Math.hypot(c.x - friedel.x, c.y - friedel.y) < Math.max(5, 0.005 * w)) c.score *= 1 + friedel.votes / 10; });
      clusters.sort((a2, b3) => b3.score - a2.score);
      const top = clusters[0];
      if (DP.DEBUG) console.log('clusters', clusters.map((c) => [(c.x * f).toFixed(0), (c.y * f).toFixed(0), c.m.length, c.rms.toFixed(1), c.score.toFixed(3)].join(',')).join(' | '));
      // accept ring fit when supported by >1 start, or when its residual is small (sharp rings)
      if ((top.m.length > 1 || top.rms < 0.007 * w) && prior(top.x, top.y) > 0.3) { bestS = { x: top.x, y: top.y }; centerMethod = 'ring-fit'; }
    }
    if (friedel && friedel.votes >= 20 && prior(friedel.x, friedel.y) > 0.3) { bestS = { x: friedel.x, y: friedel.y }; centerMethod = 'spot-pair symmetry'; }
    if (DP.DEBUG) console.log('friedel', friedel && [Math.round(friedel.x * f), Math.round(friedel.y * f), friedel.votes, friedel.spots].join(','));
    const cx = bestS.x, cy = bestS.y, cur = nccAt(gbp, cx, cy);
    // confidence: do the independent estimates agree with the chosen centre?
    const alts = [fB, fL].concat(friedel && friedel.votes >= 10 ? [friedel] : []);
    const spread = Math.max(0, ...alts.map((a) => Math.hypot(a.x - cx, a.y - cy)).sort((a, b) => a - b).slice(0, 2));
    const centerConfidence = spread < 0.015 * w ? 'high' : 'low';
    const useBP = Math.hypot(cx - fB.x, cy - fB.y) < Math.hypot(cx - fL.x, cy - fL.y);
    const totB = sharp(fB.x, fB.y), totL = sharp(fL.x, fL.y);
    if (DP.DEBUG) console.log('centre log', (cLog.x * f).toFixed(0), (cLog.y * f).toFixed(0), cLog.q.toFixed(3), 'bp', (cBP.x * f).toFixed(0), (cBP.y * f).toFixed(0), cBP.q.toFixed(3), 'scores', totB.toFixed(3), totL.toFixed(3), '->', useBP ? 'bp' : 'log', (cx * f).toFixed(1), (cy * f).toFixed(1), cur.toFixed(3));


      return { cx, cy, cur, centerMethod, centerConfidence };
    }
    let cx, cy, centerQuality, centerMethod, centerConfidence = 'manual';
    if (opts.center) { cx = (opts.center.x + 0.5) / f - 0.5; cy = (opts.center.y + 0.5) / f - 0.5; centerQuality = null; centerMethod = 'manual'; }
    else { const fc = findCenter(); cx = fc.cx; cy = fc.cy; centerQuality = fc.cur; centerMethod = fc.centerMethod; centerConfidence = fc.centerConfidence; }

    // stopper direction (angle from centre to the stopper's mass)
    if (stopperArea) {
      let sx = 0, sy = 0, k = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (stopper[y * w + x]) { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) || 1; sx += dx / r; sy += dy / r; k++; }
      if (k) stopperAngle = Math.atan2(sy, sx);
    }

    // --- radial profile (median, IQR) via per-bin histograms ---
    const [lo, hi] = percentiles(g, [0.05, 99.95], mask);
    const NQ = 512, qs = (NQ - 1) / (hi - lo || 1);
    const RB = Math.ceil(rMaxAll) + 2;
    const hist = new Uint32Array(RB * NQ), cnt = new Uint32Array(RB), rsum = new Float64Array(RB);
    const rOf = new Float32Array(N);
    for (let y = 0; y < h; y++) { const dy = y - cy; for (let x = 0; x < w; x++) {
      const i = y * w + x, dx = x - cx, r = Math.sqrt(dx * dx + dy * dy); rOf[i] = r;
      if (mask[i]) continue;
      const b = Math.round(r); let q = Math.round((g[i] - lo) * qs); q = q < 0 ? 0 : q >= NQ ? NQ - 1 : q;
      hist[b * NQ + q]++; cnt[b]++; rsum[b] += g[i];
    } }
    const med = new Float32Array(RB), sig = new Float32Array(RB), mean = new Float32Array(RB), cover = new Float32Array(RB);
    for (let b = 0; b < RB; b++) {
      const n = cnt[b]; cover[b] = n / Math.max(1, 2 * Math.PI * Math.max(b, 0.5));
      if (!n) continue;
      mean[b] = rsum[b] / n;
      let c = 0, q25 = -1, q50 = -1, q75 = -1;
      for (let q = 0; q < NQ; q++) { c += hist[b * NQ + q]; if (q25 < 0 && c >= 0.25 * n) q25 = q; if (q50 < 0 && c >= 0.5 * n) q50 = q; if (c >= 0.75 * n) { q75 = q; break; } }
      med[b] = lo + q50 / qs; sig[b] = Math.max(0.5 / qs, (q75 - q25) / qs / 1.349);
    }
    // valid radial range
    let rMin = 0; for (let b = 1; b < RB; b++) if (cover[b] > 0.35 && cnt[b] > 8) { rMin = b; break; }
    rMin = Math.max(rMin, Math.round(0.02 * w));
    let rMax = rMin; for (let b = rMin; b < RB; b++) if (cover[b] > 0.25) rMax = b;
    // smooth median profile for spot background
    const medS = Float32Array.from(med);
    for (let b = rMin + 1; b < rMax; b++) medS[b] = (med[b - 1] + 2 * med[b] + med[b + 1]) / 4;

    // background: lower convex hull of log(profile) vs log(r)
    const prof = []; for (let b = rMin; b <= rMax; b++) prof.push([Math.log(b), Math.log(Math.max(1e-3, medS[b] - lo + 1)), b]);
    const hull = [];
    for (const pnt of prof) {
      while (hull.length >= 2) { const a = hull[hull.length - 2], b2 = hull[hull.length - 1]; if ((b2[0] - a[0]) * (pnt[1] - a[1]) - (b2[1] - a[1]) * (pnt[0] - a[0]) <= 0) hull.pop(); else break; }
      hull.push(pnt);
    }
    const bg = new Float32Array(RB);
    for (let k = 0; k + 1 < hull.length; k++) {
      const a = hull[k], b2 = hull[k + 1];
      for (let b = a[2]; b <= b2[2]; b++) { const t = (Math.log(b) - a[0]) / (b2[0] - a[0] || 1); bg[b] = Math.exp(a[1] + t * (b2[1] - a[1])) + lo - 1; }
    }
    const resid = new Float32Array(RB); for (let b = rMin; b <= rMax; b++) resid[b] = medS[b] - bg[b];
    // noise level of profile residual
    const hf = []; for (let b = rMin + 2; b < rMax - 2; b++) hf.push(Math.abs(resid[b] - (resid[b - 2] + resid[b - 1] + resid[b + 1] + resid[b + 2]) / 4));
    hf.sort((a, b2) => a - b2); const pn = Math.max(0.3 / qs, 1.4826 * (hf[hf.length >> 1] || 0));

    // --- ring / halo peaks in the profile ---
    const rs = Float32Array.from(resid);
    for (let b = rMin + 2; b <= rMax - 2; b++) rs[b] = (resid[b - 2] + 2 * resid[b - 1] + 3 * resid[b] + 2 * resid[b + 1] + resid[b + 2]) / 9;
    const peaks = [];
    for (let b = rMin + 3; b <= rMax - 3; b++) {
      if (!(rs[b] > rs[b - 1] && rs[b] >= rs[b + 1])) continue;
      // prominence
      let lmin = rs[b], rmin2 = rs[b];
      for (let k = b - 1; k >= rMin; k--) { if (rs[k] > rs[b]) break; lmin = Math.min(lmin, rs[k]); }
      for (let k = b + 1; k <= rMax; k++) { if (rs[k] > rs[b]) break; rmin2 = Math.min(rmin2, rs[k]); }
      const prom = rs[b] - Math.max(lmin, rmin2);
      if (prom < Math.max(4 * pn, 0.015 * (bg[b] - lo + 1), 1.5 / qs * 0 + 0.6)) continue;
      const half = rs[b] - prom / 2;
      let a = b, c = b; while (a > rMin && rs[a] > half) a--; while (c < rMax && rs[c] > half) c++;
      // sub-pixel peak position (parabolic)
      const den = rs[b - 1] - 2 * rs[b] + rs[b + 1];
      const off = den < 0 ? 0.5 * (rs[b - 1] - rs[b + 1]) / den : 0;
      peaks.push({ r: b + off, prom, fwhm: Math.max(1, c - a), height: rs[b], bg: bg[b] - lo, snr: prom / pn });
    }

    // angular profile of an annulus: returns metrics
    function annulusStats(r, halfW) {
      const nb = 180, s = new Float64Array(nb), c = new Float64Array(nb);
      const r0 = Math.max(0, r - halfW), r1 = r + halfW;
      const y0 = Math.max(0, Math.floor(cy - r1)), y1 = Math.min(h - 1, Math.ceil(cy + r1));
      for (let y = y0; y <= y1; y++) { const dy = y - cy; const dxm = Math.sqrt(Math.max(0, r1 * r1 - dy * dy));
        for (let x = Math.max(0, Math.floor(cx - dxm)); x <= Math.min(w - 1, Math.ceil(cx + dxm)); x++) {
          const i = y * w + x; if (mask[i]) continue; const rr = rOf[i]; if (rr < r0 || rr > r1) continue;
          let a = Math.floor((Math.atan2(dy, x - cx) + Math.PI) / (2 * Math.PI) * nb); if (a >= nb) a = nb - 1;
          s[a] += gl[i] - bg[Math.round(rr)]; c[a]++;
        } }
      const vals = []; for (let a = 0; a < nb; a++) if (c[a] >= 2) vals.push(s[a] / c[a]);
      if (vals.length < 20) return { coverage: 0, cv: 9, validFrac: vals.length / nb };
      const m = vals.reduce((p, q) => p + q, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((p, q) => p + (q - m) * (q - m), 0) / vals.length);
      const sorted = vals.slice().sort((p, q) => p - q), medv = sorted[sorted.length >> 1];
      const refv = sorted[Math.floor(sorted.length * 0.9)];
      const coverage = vals.filter((v) => v > 0.35 * refv).length / vals.length;
      return { coverage, cv: sd / Math.max(1e-6, Math.abs(m)), median: medv, mean: m, validFrac: vals.length / nb };
    }

    // --- spots ---
    const es = gl; // light smoothing shared with centre finding
    const spots = [];
    const k = opts.spotSigma;
    const win = Math.max(3, Math.round(0.004 * w));
    const maskD = dilate(mask, w, h, Math.round(0.004 * w));
    for (let y = win; y < h - win; y++) for (let x = win; x < w - win; x++) {
      const i = y * w + x; if (maskD[i]) continue;
      const r = rOf[i]; if (r < rMin || r > rMax) continue;
      const b = Math.round(r);
      const e = es[i] - medS[b];
      if (e < k * sig[b] || e < Math.max(2.5, 0.02 * (p99 - p1))) continue;
      // local contrast against a surrounding ring (rejects gradients at mask edges)
      let ringS = 0, ringN = 0, ringMax = -Infinity;
      for (let q = 0; q < 16; q++) { const ax = Math.round(x + 2 * win * Math.cos(q * Math.PI / 8)), ay = Math.round(y + 2 * win * Math.sin(q * Math.PI / 8)); if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue; const j = ay * w + ax; if (mask[j]) { ringN = -99; break; } ringS += es[j]; ringN++; ringMax = Math.max(ringMax, es[j]); }
      if (ringN < 8) continue;
      const eLoc = es[i] - ringS / ringN;
      if (eLoc < Math.max(0.6 * k * sig[b], 2) || es[i] - ringMax < 0.25 * eLoc) continue;
      let isMax = true;
      for (let dy = -win; dy <= win && isMax; dy++) for (let dx = -win; dx <= win; dx++) { if (!dx && !dy) continue; const j = i + dy * w + dx; if (es[j] > es[i] || (es[j] === es[i] && j < i)) { isMax = false; break; } }
      if (!isMax) continue;
      // weighted centroid
      let sx = 0, sy = 0, sw = 0, area = 0;
      for (let dy = -win; dy <= win; dy++) for (let dx = -win; dx <= win; dx++) {
        const j = i + dy * w + dx, v = es[j] - medS[Math.round(rOf[j])] - e / 2;
        if (v > 0) { sx += v * dx; sy += v * dy; sw += v; area++; }
      }
      const px = x + (sw ? sx / sw : 0), py = y + (sw ? sy / sw : 0);
      spots.push({ x: px, y: py, r: Math.hypot(px - cx, py - cy), snr: e / sig[b], amp: e, area });
    }
    spots.sort((a, b2) => b2.snr - a.snr);
    if (spots.length > 400) spots.length = 400;
    // drop spots that are part of broad blobs (area saturating the window)
    const fullWin = (2 * win + 1) * (2 * win + 1);
    let spotList = spots.filter((s) => s.area < 0.8 * fullWin);

    // --- classify profile peaks ---
    const features = [];
    const preset = opts.preset;
    const allowSpots = preset !== 'amorphous';
    const allowRings = preset !== 'single';
    const usedSpot = new Set();
    const rClear = rMin + Math.round(0.03 * w);
    for (const pk of peaks) {
      if (pk.r < rClear) continue; // glow/saturation edge next to the stopper, not diffraction
      const st = annulusStats(pk.r, Math.max(1.5, pk.fwhm / 2));
      if (st.validFrac < 0.5) continue; // ring mostly outside the image or under the mask
      const relW = pk.fwhm / pk.r;
      let kind;
      if (relW > 0.09 && st.coverage > 0.5) kind = 'halo';
      else if (st.coverage > 0.6 && st.cv < 1.0) kind = 'ring';
      else kind = null; // decide below with spots
      const onRing = spotList.filter((s) => Math.abs(s.r - pk.r) < Math.max(2, 0.6 * pk.fwhm, 0.015 * pk.r));
      if (!kind && onRing.length >= 6) kind = 'spotty';
      if (!kind && pk.snr > 10 && st.coverage > 0.25 && relW < 0.06) kind = 'spotty'; // strong partial ring (spots too dense/bright to separate)
      if (!kind) continue;
      if (kind === 'halo' && preset === 'single') continue;
      if ((kind === 'ring' || kind === 'spotty') && preset === 'single' && onRing.length < 6) continue;
      if (preset === 'amorphous' && kind !== 'halo') continue;
      if (kind !== 'halo') onRing.forEach((s) => usedSpot.add(s));
      features.push({ kind, r: pk.r, fwhm: pk.fwhm, snr: pk.snr, prom: pk.prom, coverage: st.coverage, cv: st.cv, points: kind === 'spotty' ? onRing.map((s) => ({ x: s.x, y: s.y })) : [] });
    }
    // merge ring-type features that describe the same ring (keep the stronger)
    features.sort((a, b2) => a.r - b2.r);
    for (let i = features.length - 1; i > 0; i--) {
      const A = features[i - 1], B = features[i];
      const ringA = A.kind !== 'pair' && A.kind !== 'spot', ringB = B.kind !== 'pair' && B.kind !== 'spot';
      const tolR = Math.max(3, (A.kind === 'halo' || B.kind === 'halo' ? 0.5 : 0.25) * Math.max(A.fwhm, B.fwhm), 0.02 * B.r);
      if (ringA && ringB && B.r - A.r < tolR) { const keep = (A.snr || 0) >= (B.snr || 0) ? A : B; if (keep === A) features.splice(i, 1); else features.splice(i - 1, 1); }
    }
    // spotty rings from spot radius clusters not caught by the profile
    let rest = spotList.filter((s) => !usedSpot.has(s));
    if (allowRings) {
      const byR = rest.slice().sort((a, b2) => a.r - b2.r);
      let grp = [];
      const flush = () => {
        if (grp.length >= 6) {
          const angs = grp.map((s) => Math.atan2(s.y - cy, s.x - cx)).sort((a, b2) => a - b2);
          let maxGap = 0; for (let q = 0; q < angs.length; q++) { const gp = (q + 1 < angs.length ? angs[q + 1] : angs[0] + 2 * Math.PI) - angs[q]; maxGap = Math.max(maxGap, gp); }
          if (2 * Math.PI - maxGap > Math.PI / 2) {
            const rr = grp.map((s) => s.r).sort((a, b2) => a - b2)[grp.length >> 1];
            features.push({ kind: 'spotty', r: rr, fwhm: Math.max(2, 0.01 * rr), snr: grp[0].snr, coverage: 0, cv: 0, points: grp.map((s) => ({ x: s.x, y: s.y })) });
            grp.forEach((s) => usedSpot.add(s));
          }
        }
        grp = [];
      };
      for (const s of byR) { if (grp.length && s.r - grp[grp.length - 1].r > Math.max(2, 0.012 * s.r)) flush(); grp.push(s); }
      flush();
      rest = rest.filter((s) => !usedSpot.has(s));
    }
    // Friedel pairs
    if (allowSpots) {
      const paired = new Set();
      const cand = [];
      for (let a = 0; a < rest.length; a++) for (let b2 = a + 1; b2 < rest.length; b2++) {
        const A = rest[a], B = rest[b2];
        const mx2 = A.x + B.x - 2 * cx, my2 = A.y + B.y - 2 * cy;
        const err = Math.hypot(mx2, my2), tol = Math.max(3, 0.03 * (A.r + B.r) / 2);
        if (err < tol && Math.abs(A.r - B.r) < tol) cand.push([err / tol - 0.02 * Math.min(A.snr, B.snr) / k, a, b2]);
      }
      cand.sort((p, q) => p[0] - q[0]);
      for (const [, a, b2] of cand) {
        if (paired.has(a) || paired.has(b2)) continue;
        paired.add(a); paired.add(b2);
        const A = rest[a], B = rest[b2];
        features.push({ kind: 'pair', r: Math.hypot(A.x - B.x, A.y - B.y) / 2, fwhm: 0, snr: Math.min(A.snr, B.snr), points: [{ x: A.x, y: A.y }, { x: B.x, y: B.y }] });
      }
      // unpaired strong spots (partner may be hidden by the stopper)
      rest.forEach((s, idx) => { if (!paired.has(idx) && s.snr > 2 * k) features.push({ kind: 'spot', r: s.r, fwhm: 0, snr: s.snr, points: [{ x: s.x, y: s.y }] }); });
    }

    // convert to original pixel coordinates
    const C = { x: toOrig(cx), y: toOrig(cy) };
    const out = features.map((ft, i) => ({
      id: 'f' + (i + 1), kind: ft.kind, r: ft.r * f, fwhm: ft.fwhm * f, snr: ft.snr, coverage: ft.coverage, cv: ft.cv,
      points: ft.points.map((p) => ({ x: toOrig(p.x), y: toOrig(p.y) })), source: 'auto',
    }));
    out.sort((a, b2) => a.r - b2.r);
    out.forEach((ft, i) => { ft.id = 'f' + (i + 1); });
    const profile = [];
    for (let b = rMin; b <= rMax; b++) profile.push([b * f, med[b], bg[b], resid[b]]);
    return {
      center: C, features: out, stopperAngle, rMin: rMin * f, rMax: rMax * f, profile,
      workScale: f, centerQuality, centerMethod, centerConfidence, stopperTip: stopperTip ? { x: toOrig(stopperTip.x), y: toOrig(stopperTip.y) } : null, ms: Date.now() - t0, spotsFound: spots.length,
    };
  }

  function solve3(A, B) {
    const M = A.map((r, i) => r.concat([B[i]]));
    for (let c = 0; c < 3; c++) { let piv = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; if (Math.abs(M[piv][c]) < 1e-12) return null; [M[c], M[piv]] = [M[piv], M[c]]; for (let r = 0; r < 3; r++) if (r !== c) { const f2 = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f2 * M[c][k]; } }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  function solveN(A, B) {
    const n = B.length, M = A.map((r, i) => Array.from(r).concat([B[i]]));
    for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; if (Math.abs(M[piv][c]) < 1e-12) return null; [M[c], M[piv]] = [M[piv], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f2 = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f2 * M[c][k]; } }
    return M.map((r, i) => r[n] / r[i]);
  }

  // radial profile about a given centre (for manual feature snapping / polar view)
  function radialProfile(gray, W, H, cx, cy, step) {
    step = step || 1;
    const R = Math.ceil(Math.hypot(W, H)), s = new Float64Array(R + 1), c = new Float64Array(R + 1);
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const r = Math.round(Math.hypot(x - cx, y - cy)); s[r] += gray[y * W + x]; c[r]++; }
    const out = new Float32Array(R + 1); for (let r = 0; r <= R; r++) out[r] = c[r] ? s[r] / c[r] : NaN;
    return out;
  }

  // snap a clicked point to the local intensity maximum
  function snapSpot(gray, W, H, x, y, rad) {
    rad = rad || Math.max(4, Math.round(0.006 * W));
    let bx = Math.round(x), by = Math.round(y), bv = -Infinity;
    for (let yy = Math.max(0, by - rad); yy <= Math.min(H - 1, by + rad); yy++) for (let xx = Math.max(0, bx - rad); xx <= Math.min(W - 1, bx + rad); xx++) {
      let v = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = xx + dx, Y = yy + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) { v += gray[Y * W + X]; n++; } }
      v /= n; if (v > bv) { bv = v; bx = xx; by = yy; }
    }
    // centroid refinement
    let sx = 0, sy = 0, sw = 0; const r2 = Math.max(2, Math.round(rad / 2));
    let mn = Infinity; for (let yy = by - r2; yy <= by + r2; yy++) for (let xx = bx - r2; xx <= bx + r2; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) mn = Math.min(mn, gray[yy * W + xx]);
    for (let yy = by - r2; yy <= by + r2; yy++) for (let xx = bx - r2; xx <= bx + r2; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) { const v = gray[yy * W + xx] - mn; sx += v * xx; sy += v * yy; sw += v; }
    return sw ? { x: sx / sw, y: sy / sw } : { x: bx, y: by };
  }

  DP.percentiles = percentiles;
  DP.detectScaleBar = detectScaleBar;
  DP.analyze = analyze;
  DP.radialProfile = radialProfile;
  DP.snapSpot = snapSpot;
  DP._blur = blur;
  DP._downsample = downsample;
})(typeof globalThis !== 'undefined' ? (globalThis.DP = globalThis.DP || {}) : {});
