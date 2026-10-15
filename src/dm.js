// Gatan Digital Micrograph DM3/DM4 reader. Returns {width, height, gray, calibration:{scale, units}, tags}.
(function (DP) {
  'use strict';
  const SIZE = { 2: 2, 3: 4, 4: 2, 5: 4, 6: 4, 7: 8, 8: 1, 9: 1, 10: 1, 11: 8, 12: 8 };

  function readDM(buf) {
    const dv = new DataView(buf);
    const ver = dv.getUint32(0, false);
    if (ver !== 3 && ver !== 4) throw new Error('Not a DM3/DM4 file');
    const v4 = ver === 4;
    let p = v4 ? 12 : 8;
    const le = dv.getUint32(p, false) === 1; p += 4;
    const rdLen = () => { let v; if (v4) { v = Number(dv.getBigUint64(p, false)); p += 8; } else { v = dv.getUint32(p, false); p += 4; } return v; };
    const rdSimple = (t) => {
      let v;
      switch (t) {
        case 2: v = dv.getInt16(p, le); break;
        case 3: v = dv.getInt32(p, le); break;
        case 4: v = dv.getUint16(p, le); break;
        case 5: v = dv.getUint32(p, le); break;
        case 6: v = dv.getFloat32(p, le); break;
        case 7: v = dv.getFloat64(p, le); break;
        case 8: v = dv.getUint8(p) !== 0; break;
        case 9: v = dv.getInt8(p); break;
        case 10: v = dv.getUint8(p); break;
        case 11: v = Number(dv.getBigInt64(p, le)); break;
        case 12: v = Number(dv.getBigUint64(p, le)); break;
        default: throw new Error('DM: unknown type ' + t);
      }
      p += SIZE[t];
      return v;
    };

    function readData() {
      const magic = dv.getUint32(p, false); p += 4;
      if (magic !== 0x25252525) throw new Error('DM: bad tag marker');
      const n = rdLen();
      const info = []; for (let i = 0; i < n; i++) info.push(rdLen());
      const t = info[0];
      if (SIZE[t]) return rdSimple(t);
      if (t === 18) { const len = info[1]; let s = ''; for (let i = 0; i < len; i++) { s += String.fromCharCode(dv.getUint16(p, le)); p += 2; } return s; }
      if (t === 15) {
        const nf = info[2]; const out = [];
        for (let i = 0; i < nf; i++) out.push(rdSimple(info[4 + 2 * i]));
        return out;
      }
      if (t === 20) {
        const et = info[1];
        if (SIZE[et]) {
          const count = info[2];
          const res = { __array: true, type: et, count, offset: p };
          if (count <= 512) {
            if (et === 4 || et === 2) { let s = ''; for (let i = 0; i < count; i++) s += String.fromCharCode(dv.getUint16(p + 2 * i, le)); res.text = s; }
            const vals = []; const save = p; for (let i = 0; i < count; i++) vals.push(rdSimple(et)); p = save; res.values = vals;
          }
          p += count * SIZE[et];
          return res;
        }
        if (et === 15) {
          const nf = info[3]; const types = []; for (let i = 0; i < nf; i++) types.push(info[5 + 2 * i]);
          const count = info[4 + 2 * nf];
          const rs = types.reduce((a, b) => a + SIZE[b], 0);
          if (count <= 256) { const out = []; for (let k = 0; k < count; k++) out.push(types.map(rdSimple)); return out; }
          p += rs * count; return { __array: true, struct: true, count };
        }
        throw new Error('DM: unsupported array');
      }
      throw new Error('DM: unsupported type ' + t);
    }

    function readGroup() {
      p += 2; // sorted, open
      const n = rdLen();
      const obj = {}; const list = [];
      for (let i = 0; i < n; i++) {
        const kind = dv.getUint8(p); p += 1;
        const ll = dv.getUint16(p, false); p += 2;
        let label = ''; for (let k = 0; k < ll; k++) label += String.fromCharCode(dv.getUint8(p + k)); p += ll;
        if (v4) p += 8; // tag size
        let val;
        if (kind === 20) val = readGroup();
        else if (kind === 21) val = readData();
        else break;
        if (label) obj[label] = val; else list.push(val);
      }
      if (list.length && !Object.keys(obj).length) return list;
      if (list.length) obj.__items = list;
      return obj;
    }

    const root = readGroup();
    const items = root.ImageList || [];
    let best = null, bestN = -1;
    for (const it of (Array.isArray(items) ? items : [])) {
      const d = it && it.ImageData && it.ImageData.Data;
      if (d && d.__array && d.count > bestN) { bestN = d.count; best = it; }
    }
    if (!best) throw new Error('DM: no image data found');
    const id = best.ImageData;
    const dims = (id.Dimensions || []).map(Number);
    const W = dims[0], H = dims[1] || 1;
    const d = id.Data;
    const N = W * H;
    const gray = new Float32Array(N);
    const dt = id.DataType;
    let q = d.offset;
    if (dt === 23) { // RGBA packed uint32
      for (let i = 0; i < N; i++, q += 4) gray[i] = 0.299 * dv.getUint8(q + (le ? 0 : 3)) + 0.587 * dv.getUint8(q + (le ? 1 : 2)) + 0.114 * dv.getUint8(q + (le ? 2 : 1));
    } else {
      const sz = SIZE[d.type];
      const stride = dt === 3 || dt === 13 ? 2 : 1; // complex: take real part
      const save = p; p = q;
      for (let i = 0; i < N; i++) { gray[i] = rdSimple(d.type); if (stride === 2) p += sz; }
      p = save;
    }
    let cal = null;
    const cd = id.Calibrations && id.Calibrations.Dimension;
    if (Array.isArray(cd) && cd.length) {
      const c0 = cd[0];
      const units = (c0.Units && (c0.Units.text !== undefined ? c0.Units.text : c0.Units)) || '';
      cal = { scale: Number(c0.Scale), origin: Number(c0.Origin || 0), units: String(units) };
    }
    const tags = best.ImageTags || {};
    const txt = (v) => (v && v.text !== undefined ? v.text : v);
    let camLen = null, volt = null, mode = null;
    const mi = tags['Microscope Info'];
    if (mi && typeof mi === 'object') {
      volt = mi.Voltage || null;
      mode = txt(mi['Imaging Mode']) || txt(mi['Operation Mode']) || null;
      camLen = mi['STEM Camera Length'] || mi['Camera Length'] || null;
    }
    return { width: W, height: H, gray, calibration: cal, meta: { voltage: volt, mode, cameraLength: camLen, version: ver } };
  }

  DP.readDM = readDM;
})(typeof globalThis !== 'undefined' ? (globalThis.DP = globalThis.DP || {}) : {});
