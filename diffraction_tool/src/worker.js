// Web Worker: decode + analyse one image per message. Core modules (DP.*) are prepended at build time.
/* global DP */
async function decodeAny(name, buf) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'dm3' || ext === 'dm4') { const r = DP.readDM(buf); r.kind = 'dm'; r.bits = 32; return r; }
  if (ext === 'tif' || ext === 'tiff') { const r = await DP.readTIFF(buf); r.kind = 'tiff'; return r; }
  // PNG/JPG/BMP via the browser's decoder
  const bmp = await createImageBitmap(new Blob([buf]));
  const oc = new OffscreenCanvas(bmp.width, bmp.height), cx = oc.getContext('2d');
  cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data, N = bmp.width * bmp.height, gray = new Float32Array(N);
  for (let i = 0; i < N; i++) gray[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  return { width: bmp.width, height: bmp.height, gray, bits: 8, kind: 'raster' };
}
function toDisplay(img) {
  const N = img.gray.length, out = new Uint8ClampedArray(N);
  if (img.bits === 8) { for (let i = 0; i < N; i++) out[i] = img.gray[i]; return out; }
  // raw data: percentile stretch + square-root gamma so faint rings are visible
  const [lo, hi] = DP.percentiles(img.gray, [0.1, 99.9]);
  const sc = 1 / (hi - lo || 1);
  for (let i = 0; i < N; i++) { const v = Math.min(1, Math.max(0, (img.gray[i] - lo) * sc)); out[i] = Math.round(255 * Math.sqrt(v)); }
  return out;
}
function thumb(disp, W, H, T) {
  const s = Math.max(W, H) / T, tw = Math.max(1, Math.round(W / s)), th = Math.max(1, Math.round(H / s)), out = new Uint8ClampedArray(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let a = 0, n = 0; const x0 = Math.floor(x * s), y0 = Math.floor(y * s), x1 = Math.min(W, Math.floor((x + 1) * s)), y1 = Math.min(H, Math.floor((y + 1) * s));
    for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) { a += disp[yy * W + xx]; n++; }
    out[y * tw + x] = n ? a / n : 0;
  }
  return { data: out, w: tw, h: th };
}
self.onmessage = async (ev) => {
  const { id, name, buffer, opts, want } = ev.data;
  try {
    const img = await decodeAny(name, buffer);
    const res = { id, width: img.width, height: img.height, kind: img.kind, bits: img.bits, dmCal: img.calibration || null, meta: img.meta || null };
    const disp = toDisplay(img);
    const transfer = [];
    if (want.analyze) {
      const sb = img.kind === 'dm' ? null : DP.detectScaleBar(img.gray, img.width, img.height);
      res.sb = sb;
      res.an = DP.analyze(img.gray, img.width, img.height, Object.assign({ scaleBar: sb }, opts || {}));
      const t = thumb(disp, img.width, img.height, 160); res.thumb = t; transfer.push(t.data.buffer);
    }
    if (want.display) { res.display = disp; transfer.push(disp.buffer); }
    self.postMessage(res, transfer);
  } catch (e) {
    self.postMessage({ id, error: (e && e.message) || String(e) });
  }
};
