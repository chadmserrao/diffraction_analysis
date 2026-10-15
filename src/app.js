/* Diffraction Annotator: UI. Core analysis lives in DP.* (imageproc.js, crystal.js). */
(function () {
  'use strict';
  const DP = window.DP;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { pair: 'Spot pair', spot: 'Single spot', ring: 'Ring (polycrystalline)', spotty: 'Spotty ring', halo: 'Diffuse halo (amorphous)' };
  const PALETTE = ['#ffffff', '#ffc000', '#ff3b30', '#34c759', '#00b0f0', '#ff66cc', '#ff9500', '#a78bfa', '#7cfc00', '#40e0d0', '#ffd1dc', '#f4a261', '#9ad0ff', '#e9c46a', '#c77dff', '#b5e48c'];
  const EXT = ['tif', 'tiff', 'dm3', 'dm4', 'png', 'jpg', 'jpeg', 'bmp'];

  // ---------------- settings (persisted) ----------------
  const DEFAULT_SETTINGS = {
    elements: [], useLibrary: true, onlyExperimental: false, excludeGases: true, tol: 3, autoAssign: true,
    customLists: [
      { id: 'c-pg', name: 'Pseudo-graphite', enabled: true, amorphousOK: true, rows: [{ label: '{002}', d: 0.37 }, { label: '{100}', d: 0.212 }, { label: '{110}', d: 0.123 }] },
      { id: 'c-ice', name: 'Vitreous ice', enabled: false, amorphousOK: true, rows: [{ label: 'halo', d: 0.37 }, { label: 'halo 2', d: 0.214 }] },
    ],
    style: {
      font: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif', fontSize: 34, legendBg: 'none', legendSwatch: 'none', showD: 'measured', dDigits: 3,
      markerSize: 14, lineWidth: 3, arcSpan: 90, arcMode: 'auto', arcAngle: 45, showCenter: false, labelMarks: false,
      scaleBar: 'off', exportRegion: 'full', exportScale: 1,
    },
    labelStyles: {}, apiKey: '', rememberKey: false, preferred: [],
  };
  let SET;
  try { SET = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('dpa-settings') || '{}')); SET.style = Object.assign({}, DEFAULT_SETTINGS.style, SET.style || {}); }
  catch (e) { SET = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
  const saveSettings = () => { const c = Object.assign({}, SET); if (!SET.rememberKey) c.apiKey = ''; localStorage.setItem('dpa-settings', JSON.stringify(c)); };

  // ---------------- state ----------------
  const S = { images: [], cur: -1, tool: 'select', view: { z: 1, x: 0, y: 0 }, disp: null, selFeat: null, polar: false, gamma: 1, white: 255, mpPhases: [], mpStatus: 'unknown' };
  let uid = 0;

  // ---------------- worker pool ----------------
  const coreSrc = $('dp-core').textContent, workerSrc = $('dp-worker').textContent;
  if (!DP.snapSpot) new Function(coreSrc)(); // core helpers (spot snapping) are also needed on the page
  const workerURL = URL.createObjectURL(new Blob([coreSrc, '\n', workerSrc], { type: 'text/javascript' }));
  const NW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const pool = [];
  for (let i = 0; i < NW; i++) { const w = new Worker(workerURL); w.busy = false; w.jobs = {}; w.onmessage = (ev) => { const j = w.jobs[ev.data.id]; delete w.jobs[ev.data.id]; w.busy = false; j && j(ev.data); pump(); }; pool.push(w); }
  const queue = [];
  let jobId = 0;
  function runJob(file, opts, want, priority) {
    return new Promise((resolve) => { const job = { file, opts, want, resolve }; if (priority) queue.unshift(job); else queue.push(job); pump(); });
  }
  function pump() {
    for (const w of pool) {
      if (w.busy || !queue.length) continue;
      const j = queue.shift(); w.busy = true;
      const id = ++jobId; w.jobs[id] = j.resolve;
      j.file.arrayBuffer().then((buf) => w.postMessage({ id, name: j.file.name, buffer: buf, opts: j.opts, want: j.want }, [buf]))
        .catch((e) => { w.busy = false; delete w.jobs[id]; j.resolve({ error: e.message }); pump(); });
    }
  }

  // ---------------- loading files ----------------
  function addFiles(list) {
    const files = list.filter((f) => EXT.includes((f.name.split('.').pop() || '').toLowerCase()));
    files.sort((a, b) => (a.relPath || a.webkitRelativePath || a.name).localeCompare(b.relPath || b.webkitRelativePath || b.name, undefined, { numeric: true }));
    // DM exports often come as .dm4 + .tif pairs: keep both, they are separate entries
    for (const f of files) {
      const path = f.relPath || f.webkitRelativePath || f.name;
      if (S.images.some((im) => im.path === path)) continue;
      const im = { id: ++uid, file: f, name: f.name, path, status: 'queued', features: [], preset: 'auto', legend: null };
      const saved = pendingProject && pendingProject[path];
      if (saved) Object.assign(im, restoreImage(saved));
      S.images.push(im);
    }
    $('empty').style.display = S.images.length ? 'none' : '';
    renderFiles();
    processAll();
    if (S.cur < 0 && S.images.length) select(0);
  }
  async function processAll() {
    const todo = S.images.filter((im) => im.status === 'queued');
    let done = 0; const total = todo.length;
    const tick = () => { const pct = total ? (100 * done) / total : 0; $('progress').style.width = (done < total ? pct : 0) + '%'; setStatus(done < total ? `Analysing ${done}/${total}…` : `${S.images.length} image(s)`); };
    tick();
    await Promise.all(todo.map(async (im) => {
      im.status = 'working'; renderFileItem(im);
      const r = await runJob(im.file, { preset: im.preset }, { analyze: true });
      applyAnalysis(im, r, !!im.restored);
      done++; tick(); renderFileItem(im);
      if (S.images[S.cur] === im) { loadDisplay(im); renderAll(); }
    }));
  }
  function applyAnalysis(im, r, keepEdits) {
    if (r.error) { im.status = 'error'; im.error = r.error; return; }
    im.status = 'done'; im.W = r.width; im.H = r.height; im.kind = r.kind; im.bits = r.bits;
    if (r.thumb) im.thumbURL = grayToURL(r.thumb.data, r.thumb.w, r.thumb.h);
    im.sb = r.sb || null; im.dmCal = r.dmCal;
    if (!keepEdits || !im.cal) im.cal = chooseCalibration(im);
    const an = r.an;
    im.profile = an.profile; im.stopperAngle = an.stopperAngle; im.rMin = an.rMin; im.rMax = an.rMax;
    if (!keepEdits || !im.center) { im.center = an.center; im.centerMethod = an.centerMethod; im.centerQuality = an.centerQuality; im.centerConfidence = an.centerConfidence; }
    const manual = (im.features || []).filter((f) => f.source === 'manual');
    if (!keepEdits || !im.features.length) im.features = an.features.map((f) => Object.assign({ visible: true, assign: null, custom: '' }, f)).concat(manual);
    im.features.forEach((f, i) => { if (!f.uid) f.uid = 'u' + (++uid); });
    recomputeD(im);
    if (SET.autoAssign && !keepEdits) autoAssign(im);
    im.restored = false;
  }
  function chooseCalibration(im) {
    if (im.dmCal && im.dmCal.scale > 0) {
      const u = (im.dmCal.units || '').replace('µ', 'u');
      let s = im.dmCal.scale; // reciprocal-space units per pixel
      if (u === '1/nm' || u === 'nm-1' || u === 'nm^-1' || u === '1 /nm') return { scale: s, source: 'DM metadata', unit: '1/nm', ok: true };
      if (u === '1/A' || u === '1/Å') return { scale: s * 10, source: 'DM metadata', unit: '1/nm', ok: true };
      if (u === '1/um') return { scale: s / 1000, source: 'DM metadata', unit: '1/nm', ok: true };
      return { scale: s, source: 'DM metadata (' + u + ')', unit: u, ok: false, realSpace: /nm|um|A/.test(u) };
    }
    const sb = im.sb;
    if (sb && sb.value && sb.lengthPx) {
      const unit = sb.unit || '1/nm';
      return { scale: sb.value / sb.lengthPx, source: 'scale bar', unit, value: sb.value, lengthPx: sb.lengthPx, ok: sb.confidence >= 0.5 && unit === '1/nm', realSpace: unit === 'nm', confidence: sb.confidence };
    }
    if (sb && sb.lengthPx) return { scale: null, source: 'scale bar (label unreadable)', lengthPx: sb.lengthPx, ok: false };
    return { scale: null, source: 'none', ok: false };
  }
  function recomputeD(im) {
    const c = im.center, sc = im.cal && im.cal.scale;
    for (const f of im.features) {
      if ((f.kind === 'pair') && f.points.length === 2) f.r = Math.hypot(f.points[0].x - f.points[1].x, f.points[0].y - f.points[1].y) / 2;
      else if (f.kind === 'spot' && f.points.length) f.r = Math.hypot(f.points[0].x - c.x, f.points[0].y - c.y);
      f.q = sc ? f.r * sc : null; f.d = f.q ? 1 / f.q : null;
      f.dErr = f.kind === 'halo' ? Math.min(0.15, (f.fwhm || 0) / Math.max(1, f.r) / 2) : 0;
      if (f.kind === 'pair' && f.points.length === 2) f.vec = [f.points[0].x - f.points[1].x, f.points[0].y - f.points[1].y];
    }
  }
  function grayToURL(data, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d'), id = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = data[i]; id.data[4 * i + 3] = 255; }
    cx.putImageData(id, 0, 0); return c.toDataURL('image/jpeg', 0.85);
  }
  // folder drag & drop (recursive)
  async function entriesToFiles(items) {
    const out = [];
    const walk = (entry, path) => new Promise((res) => {
      if (entry.isFile) entry.file((f) => { f.relPath = path + f.name; out.push(f); res(); }, () => res());
      else if (entry.isDirectory) {
        const rd = entry.createReader(); const all = [];
        const more = () => rd.readEntries(async (ents) => { if (!ents.length) { for (const e of all) await walk(e, path + entry.name + '/'); res(); } else { all.push(...ents); more(); } }, () => res());
        more();
      } else res();
    });
    for (const it of items) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) await walk(e, ''); }
    return out;
  }
  function setStatus(t) { $('status').textContent = t; }
  function toast(msg, ms) { const t = $('toast'); t.innerHTML = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, ms || 4000); }

  // ---------------- phases ----------------
  // phases that are gases at room temperature (solid only at very low T): not expected in TEM samples
  const GAS = new Set(['H', 'H2', 'N', 'N2', 'O', 'O2', 'O3', 'F', 'F2', 'Cl', 'Cl2', 'CO2', 'CO', 'CH4', 'NH3', 'NO', 'NO2', 'N2O', 'SO2', 'H2S', 'HF', 'HCl', 'SiH4', 'PH3', 'C2H2', 'C2H4', 'C2H6', 'CF4', 'SF6', 'B2H6']);
  const CSN = ['triclinic', 'monoclinic', 'orthorhombic', 'tetragonal', 'trigonal', 'hexagonal', 'cubic'];
  let LIB = null;
  function library() {
    if (LIB) return LIB;
    LIB = (DP.LIBRARY_ROWS || []).map((r) => {
      const [id, formula, sg, cs, eh, theo, lat, sf] = r;
      const pre = DP.LIBRARY_REFL && DP.LIBRARY_REFL[id];
      const els = Array.from(new Set(sf.filter((x, i) => i % 4 === 0)));
      return { id, name: formula, formula, sg, crystalSystem: CSN[cs], ehull: eh, theoretical: !!theo, els, latFlat: lat, sitesFlat: sf, source: 'library',
        indexNote: pre && pre.n ? 'indices refer to the primitive cell' : '',
        reflPre: pre ? pre.r.map(([d, I, h, k, l, m, Is]) => ({ d, I, Ispot: Is, hkl: [h, k, l], mult: m, label: '{' + DP.crystal.fmtHKL([h, k, l]) + '}', members: [] })) : null };
    });
    return LIB;
  }
  function withStructure(ph) { // lazily expand library structure (needed for zone-axis checks)
    if (ph.sites || !ph.latFlat) return ph;
    const L = ph.latFlat, sites = [];
    for (let i = 0; i < ph.sitesFlat.length; i += 4) sites.push({ el: ph.sitesFlat[i], f: ph.sitesFlat.slice(i + 1, i + 4) });
    ph.lattice = [L.slice(0, 3), L.slice(3, 6), L.slice(6, 9)]; ph.sites = sites; return ph;
  }
  function phasePool() {
    const sel = new Set(SET.elements);
    const pool = [];
    if (SET.useLibrary) for (const ph of library()) {
      if (sel.size && !ph.els.every((e) => sel.has(e))) continue;
      if (SET.onlyExperimental && ph.theoretical) continue;
      if (SET.excludeGases !== false && GAS.has(ph.formula)) continue;
      pool.push(ph);
    }
    for (const ph of S.mpPhases) { if (!sel.size || ph.els.every((e) => sel.has(e))) pool.push(ph); }
    for (const c of SET.customLists) if (c.enabled) pool.push({ id: c.id, name: c.name, dlist: c.rows.filter((r) => r.d > 0), amorphousOK: c.amorphousOK, source: 'custom', els: [] });
    const pref = new Set(SET.preferred || []);
    pool.forEach((p) => { p.preferred = pref.has(p.id); });
    // disambiguate polymorph names (e.g. two Na phases) with the space group
    const counts = {}; pool.forEach((p) => { counts[p.name] = (counts[p.name] || 0) + 1; });
    pool.forEach((p) => { p.display = counts[p.name] > 1 && p.sg ? `${p.name} (${p.sg})` : p.name; });
    return pool;
  }
  function featsForMatch(im) {
    return im.features.filter((f) => f.visible !== false && f.d).map((f) => ({ id: f.uid, kind: f.kind, d: f.d, dErr: f.dErr, vec: f.vec }));
  }
  function runMatch(im) {
    if (!im || !im.cal || !im.cal.scale) return [];
    const feats = featsForMatch(im);
    const pool = phasePool().map((p) => (p.dlist ? p : withStructure(p)));
    im.matches = DP.crystal.matchPhases(feats, pool, { tol: SET.tol / 100 });
    return im.matches;
  }
  // greedy cover: best phase explains what it can, the next phase explains the rest ...
  function autoAssign(im) {
    const res = runMatch(im);
    im.features.forEach((f) => { if (f.assign && f.assign.auto) f.assign = null; });
    const open = new Set(im.features.filter((f) => !f.assign && !f.custom).map((f) => f.uid));
    let used = 0;
    const restricted = SET.elements.length > 0; // without chosen elements, only custom lists are applied automatically
    for (const r of res) {
      if (!open.size || used >= 4) break;
      if (!restricted && !r.phase.dlist) continue;
      const take = Object.keys(r.assign).filter((u) => open.has(u));
      if (!take.length) continue;
      // require the phase to explain crystalline features, not only halos
      const onlyHalo = take.every((u) => (im.features.find((f) => f.uid === u) || {}).kind === 'halo');
      if (onlyHalo && !r.phase.amorphousOK) continue;
      if (r.score < 0.15 && !r.phase.dlist) continue;
      for (const u of take) { const f = im.features.find((x) => x.uid === u); const a = r.assign[u]; f.assign = { phase: r.phase.display || r.phase.name, phaseId: r.phase.id, label: a.label, dRef: a.dRef, err: a.err, auto: true }; open.delete(u); }
      used++;
    }
  }
  function assignFromResult(im, r, onlyUnassigned) {
    for (const u in r.assign) {
      const f = im.features.find((x) => x.uid === u); if (!f) continue;
      if (onlyUnassigned && f.assign && !f.assign.auto) continue;
      const a = r.assign[u]; f.assign = { phase: r.phase.display || r.phase.name, phaseId: r.phase.id, label: a.label, dRef: a.dRef, err: a.err, auto: false };
      f.custom = '';
    }
  }
  function featureLabel(f) {
    if (f.custom) return f.custom;
    if (f.assign) return (f.assign.phase + ' ' + (f.assign.label || '')).trim();
    return f.d ? 'd = ' + f.d.toFixed(SET.style.dDigits) + ' nm' : KIND[f.kind];
  }
  function labelStyle(label, idx) {
    let st = SET.labelStyles[label];
    if (!st) {
      const usedColors = new Set(Object.values(SET.labelStyles).map((s) => s.color));
      const color = PALETTE.find((c) => !usedColors.has(c)) || PALETTE[(idx || 0) % PALETTE.length];
      st = { color, shape: 'circle', dash: 'solid', ringMark: 'arc' };
      SET.labelStyles[label] = st; saveSettings();
    }
    return st;
  }
  // legend entries for an image: one per label, in order of increasing d-spacing? (keep order of first appearance by radius)
  function legendEntries(im) {
    const groups = new Map();
    for (const f of im.features.slice().sort((a, b) => a.r - b.r)) {
      if (f.visible === false) continue;
      const lb = featureLabel(f);
      if (!groups.has(lb)) groups.set(lb, []);
      groups.get(lb).push(f);
    }
    // each label keeps its saved colour across images; clashes inside one image get the next free colour
    const used = new Set();
    let i = 0;
    const out = Array.from(groups.entries()).map(([label, fs]) => {
      const ds = fs.map((f) => f.d).filter(Boolean);
      const dMeas = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
      const dRef = fs[0].assign ? fs[0].assign.dRef : null;
      const saved = labelStyle(label, i++);
      let style = saved;
      if (used.has(saved.color.toLowerCase())) { const free = PALETTE.find((c) => !used.has(c)); if (free) style = Object.assign({}, saved, { color: free }); }
      used.add(style.color.toLowerCase());
      return { label, feats: fs, dMeas, dRef, style };
    });
    return out;
  }
  function legendText(e) {
    const st = SET.style; const dg = st.dDigits;
    if (/^d = /.test(e.label)) return e.label;
    if (st.showD === 'measured' && e.dMeas) return `${e.label} | ${e.dMeas.toFixed(dg)} nm`;
    if (st.showD === 'reference' && e.dRef) return `${e.label} | ${e.dRef.toFixed(dg)} nm`;
    if (/^d = /.test(e.label)) return e.label;
    return e.label;
  }

  // ---------------- display ----------------
  const cv = $('cv'), ov = $('ov'), world = $('world'), stage = $('stage');
  let baseImageData = null;
  async function loadDisplay(im) {
    if (!im || im.status !== 'done') return;
    if (S.disp && S.disp.id === im.id) return;
    const r = await runJob(im.file, {}, { display: true }, true);
    if (r.error || S.images[S.cur] !== im) return;
    S.disp = { id: im.id, data: r.display, W: r.width, H: r.height };
    cv.width = r.width; cv.height = r.height;
    ov.setAttribute('width', r.width); ov.setAttribute('height', r.height); ov.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    baseImageData = null; paintImage(); fit(); renderOverlay();
    if (S.polar) renderPolar();
  }
  function lut() {
    const L = new Uint8ClampedArray(256), g = S.gamma, wl = S.white;
    for (let i = 0; i < 256; i++) L[i] = Math.round(255 * Math.pow(Math.min(1, i / wl), 1 / g));
    return L;
  }
  function paintImage() {
    if (!S.disp) return;
    const { data, W, H } = S.disp, cx = cv.getContext('2d');
    if (!baseImageData) baseImageData = cx.createImageData(W, H);
    const L = lut(), o = baseImageData.data;
    for (let i = 0, j = 0; i < data.length; i++, j += 4) { const v = L[data[i]]; o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255; }
    cx.putImageData(baseImageData, 0, 0);
  }
  function applyView() { world.style.transform = `translate(${S.view.x}px, ${S.view.y}px) scale(${S.view.z})`; }
  function fit() {
    const im = S.images[S.cur]; if (!im || !im.W) return;
    const r = stage.getBoundingClientRect(), z = Math.min(r.width / im.W, r.height / im.H) * 0.97;
    S.view = { z, x: (r.width - im.W * z) / 2, y: (r.height - im.H * z) / 2 }; applyView();
  }
  const toImg = (ev) => { const r = stage.getBoundingClientRect(); return { x: (ev.clientX - r.left - S.view.x) / S.view.z, y: (ev.clientY - r.top - S.view.y) / S.view.z }; };

  // ---------------- overlay (shared by screen + export) ----------------
  function arcAngles(im) {
    const st = SET.style, span = st.arcSpan * Math.PI / 180;
    let mid;
    if (st.arcMode === 'auto' && im.stopperAngle != null) mid = im.stopperAngle + Math.PI + st.arcAngle * Math.PI / 180;
    else mid = st.arcAngle * Math.PI / 180;
    return [mid - span / 2, mid + span / 2];
  }
  function dashArray(dash, lw) { return dash === 'dashed' ? `${4 * lw} ${2.5 * lw}` : dash === 'dotted' ? `0.1 ${2.2 * lw}` : 'none'; }
  const measureCtx = document.createElement('canvas').getContext('2d');
  function textWidth(t, px) { measureCtx.font = `${px}px ${SET.style.font}`; return measureCtx.measureText(t).width; }
  function niceBar(scale, widthPx) {
    const target = (widthPx * 0.2) * scale; // 1/nm
    const p = Math.pow(10, Math.floor(Math.log10(target))), m = target / p;
    const v = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
    return { value: v, px: v / scale };
  }
  function buildOverlay(im, o) {
    o = o || {};
    const W = im.W, st = SET.style, U = W / 1000;
    const lw = st.lineWidth * U, ms = st.markerSize * U, fpx = st.fontSize * U;
    const c = im.center, parts = [];
    const [a0, a1] = arcAngles(im);
    const entries = legendEntries(im);
    for (const e of entries) {
      const col = e.style.color, da = dashArray(e.style.dash, lw), cap = e.style.dash === 'dotted' ? 'round' : 'butt';
      for (const f of e.feats) {
        const sel = !o.export && S.selFeat === f.uid;
        const common = `fill="none" stroke="${col}" stroke-width="${sel ? lw * 1.8 : lw}" stroke-dasharray="${da}" stroke-linecap="${cap}" data-f="${f.uid}"`;
        const isRing = f.kind === 'ring' || f.kind === 'halo' || (f.kind === 'spotty' && e.style.ringMark !== 'circles');
        if (isRing) {
          const R = f.r, full = st.arcSpan >= 359;
          if (full) parts.push(`<circle cx="${c.x}" cy="${c.y}" r="${R}" ${common}/>`);
          else {
            const x0 = c.x + R * Math.cos(a0), y0 = c.y + R * Math.sin(a0), x1 = c.x + R * Math.cos(a1), y1 = c.y + R * Math.sin(a1);
            parts.push(`<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R.toFixed(1)} ${R.toFixed(1)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" ${common}/>`);
          }
          if (st.labelMarks) { const am = (a0 + a1) / 2; parts.push(`<text x="${c.x + (R + fpx * 0.3) * Math.cos(am)}" y="${c.y + (R + fpx * 0.3) * Math.sin(am)}" fill="${col}" font-size="${fpx * 0.6}" font-family='${st.font}'>${esc(e.label)}</text>`); }
        } else {
          for (const p of f.points) {
            if (e.style.shape === 'square') parts.push(`<rect x="${p.x - ms}" y="${p.y - ms}" width="${2 * ms}" height="${2 * ms}" ${common}/>`);
            else if (e.style.shape !== 'none') parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${ms}" ${common}/>`);
            if (st.labelMarks) parts.push(`<text x="${p.x + ms * 1.2}" y="${p.y - ms * 1.2}" fill="${col}" font-size="${fpx * 0.6}" font-family='${st.font}'>${esc(e.label)}</text>`);
          }
        }
        if (!o.export) { // wide invisible hit target for clicking
          if (isRing) parts.push(`<circle cx="${c.x}" cy="${c.y}" r="${f.r}" fill="none" stroke="transparent" stroke-width="${Math.max(lw * 4, 8 / S.view.z)}" data-f="${f.uid}" class="hit"/>`);
          else for (const p of f.points) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${ms * 1.3}" fill="transparent" data-f="${f.uid}" class="hit"/>`);
        }
      }
    }
    if (st.showCenter || (!o.export && S.tool === 'center')) {
      const k = ms * 0.8; parts.push(`<path d="M${c.x - k} ${c.y}H${c.x + k}M${c.x} ${c.y - k}V${c.y + k}" stroke="#ffeb3b" stroke-width="${lw * 0.7}"/>`);
    }
    // legend
    if (entries.length) {
      const reg = o.region || { x: 0, y: 0, w: W, h: im.H };
      const lh = fpx * 1.22, pad = fpx * 0.35;
      const sw = st.legendSwatch === 'marker' ? fpx * 1.1 : 0;
      const texts = entries.map(legendText);
      const bw = Math.max(...texts.map((t) => textWidth(t, fpx))) + sw + 2 * pad, bh = entries.length * lh + 2 * pad - (lh - fpx);
      let lx, ly;
      if (im.legend) { lx = im.legend.x * W; ly = im.legend.y * im.H; }
      else {
        // pick the corner farthest (in angle) from the ring arcs, avoiding the scale bar corner
        const mid = (a0 + a1) / 2, corners = [[0, 0, -3 * Math.PI / 4], [1, 0, -Math.PI / 4], [1, 1, Math.PI / 4], [0, 1, 3 * Math.PI / 4]];
        const sbc = im.sb ? [im.sb.x0 < W / 2 ? 0 : 1, im.sb.y0 < im.H / 2 ? 0 : 1] : [0, 1];
        let best = null;
        for (const [cxn, cyn, ang] of corners) {
          let dA = Math.abs(((ang - mid) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
          if (cxn === sbc[0] && cyn === sbc[1]) dA -= 10;
          if (!best || dA > best.dA) best = { dA, cxn, cyn };
        }
        lx = best.cxn ? reg.x + reg.w - bw - 0.03 * reg.w : reg.x + 0.03 * reg.w;
        ly = best.cyn ? reg.y + reg.h - bh - 0.03 * reg.h : reg.y + 0.03 * reg.h;
      }
      lx = Math.min(Math.max(lx, reg.x), reg.x + reg.w - bw); ly = Math.min(Math.max(ly, reg.y), reg.y + reg.h - bh);
      const g = [];
      if (st.legendBg !== 'none') g.push(`<rect x="0" y="0" width="${bw}" height="${bh}" rx="${pad * 0.6}" fill="${st.legendBg === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)'}"/>`);
      entries.forEach((e, i) => {
        const y = pad + i * lh + fpx * 0.82;
        if (sw) g.push(`<circle cx="${pad + sw * 0.4}" cy="${y - fpx * 0.3}" r="${fpx * 0.28}" fill="none" stroke="${e.style.color}" stroke-width="${lw}" stroke-dasharray="${dashArray(e.style.dash, lw)}"/>`);
        g.push(`<text x="${pad + sw}" y="${y}" fill="${e.style.color}" font-size="${fpx}" font-family='${st.font}'>${esc(texts[i])}</text>`);
      });
      parts.push(`<g id="legend" class="legend-drag" transform="translate(${lx.toFixed(1)} ${ly.toFixed(1)})">${!o.export ? `<rect x="0" y="0" width="${bw}" height="${bh}" fill="transparent"/>` : ''}${g.join('')}</g>`);
    }
    // optional redrawn scale bar
    if (st.scaleBar === 'on' && im.cal && im.cal.scale) {
      const reg = o.region || { x: 0, y: 0, w: W, h: im.H };
      const nb = niceBar(im.cal.scale, reg.w), bx = reg.x + 0.04 * reg.w, by = reg.y + reg.h - 0.05 * reg.h;
      parts.push(`<rect x="${bx}" y="${by}" width="${nb.px}" height="${lw * 1.6}" fill="#fff"/><text x="${bx}" y="${by - fpx * 0.3}" fill="#fff" font-size="${fpx}" font-family='${st.font}'>${nb.value} 1/nm</text>`);
    }
    return parts.join('');
  }
  function renderOverlay() {
    const im = S.images[S.cur];
    if (!im || im.status !== 'done' || !S.disp || S.disp.id !== im.id) { ov.innerHTML = ''; return; }
    ov.innerHTML = buildOverlay(im, {});
  }

  // ---------------- polar view ----------------
  function renderPolar() {
    const im = S.images[S.cur], pc = $('pcv');
    if (!im || !S.disp || S.disp.id !== im.id) return;
    const r = stage.getBoundingClientRect(); pc.width = Math.round(r.width); pc.height = Math.round(r.height);
    const { data, W, H } = S.disp, c = im.center;
    const rMax = Math.min(im.rMax || Math.hypot(W, H) / 2, Math.hypot(W, H));
    const NT = 720, NR = Math.min(900, Math.round(rMax));
    const img = new Float32Array(NT * NR);
    const med = new Float32Array(NR);
    for (let j = 0; j < NR; j++) {
      const rr = (j + 0.5) * rMax / NR, row = [];
      for (let i = 0; i < NT; i++) {
        const th = i / NT * 2 * Math.PI, x = Math.round(c.x + rr * Math.cos(th)), y = Math.round(c.y + rr * Math.sin(th));
        const v = x >= 0 && y >= 0 && x < W && y < H ? data[y * W + x] : NaN; img[j * NT + i] = v; if (v === v) row.push(v);
      }
      row.sort((a, b) => a - b); med[j] = row.length ? row[row.length >> 1] : 0;
    }
    const res = new Float32Array(NT * NR); const all = [];
    for (let j = 0; j < NR; j++) for (let i = 0; i < NT; i++) { const v = img[j * NT + i]; res[j * NT + i] = v === v ? v - med[j] * 0.85 : 0; if (v === v && (i + j) % 7 === 0) all.push(res[j * NT + i]); }
    all.sort((a, b) => a - b); const lo = all[Math.floor(all.length * 0.02)] || 0, hi = all[Math.floor(all.length * 0.995)] || 1;
    const cx = pc.getContext('2d'), id = cx.createImageData(NT, NR);
    for (let k = 0; k < NT * NR; k++) { const v = Math.max(0, Math.min(255, 255 * (res[k] - lo) / (hi - lo))); id.data[4 * k] = id.data[4 * k + 1] = id.data[4 * k + 2] = v; id.data[4 * k + 3] = 255; }
    const tmp = document.createElement('canvas'); tmp.width = NT; tmp.height = NR; tmp.getContext('2d').putImageData(id, 0, 0);
    const mL = 60, mB = 30, pw = pc.width - mL - 150, ph = pc.height - mB - 20;
    cx.fillStyle = '#0b0c0f'; cx.fillRect(0, 0, pc.width, pc.height);
    cx.imageSmoothingEnabled = true; cx.drawImage(tmp, mL, 10, pw, ph);
    cx.fillStyle = '#9aa1b2'; cx.font = '12px sans-serif';
    cx.fillText('azimuth →  (0–360°)', mL, pc.height - 8);
    const sc = im.cal && im.cal.scale;
    for (let k = 0; k <= 5; k++) { const rr = rMax * k / 5, y = 10 + ph * k / 5; cx.fillText(sc ? (rr * sc).toFixed(1) + ' 1/nm' : Math.round(rr) + ' px', 4, y + 4); }
    for (const e of legendEntries(im)) for (const f of e.feats) {
      const y = 10 + ph * f.r / rMax; cx.strokeStyle = e.style.color; cx.fillStyle = e.style.color; cx.lineWidth = 1.5;
      if (f.kind === 'ring' || f.kind === 'halo' || f.kind === 'spotty') { cx.setLineDash(f.kind === 'halo' ? [6, 4] : []); cx.beginPath(); cx.moveTo(mL, y); cx.lineTo(mL + pw, y); cx.stroke(); cx.setLineDash([]); }
      for (const p of f.points) { const th = (Math.atan2(p.y - c.y, p.x - c.x) + 2 * Math.PI) % (2 * Math.PI), rr = Math.hypot(p.x - c.x, p.y - c.y); cx.beginPath(); cx.arc(mL + pw * th / (2 * Math.PI), 10 + ph * rr / rMax, 6, 0, 2 * Math.PI); cx.stroke(); }
      cx.fillText(legendText(e).slice(0, 24), mL + pw + 6, y + 4);
    }
  }

  // ---------------- file list ----------------
  function fileChips(im) {
    if (im.status === 'queued') return '<span class="chip">queued</span>';
    if (im.status === 'working') return '<span class="chip">analysing…</span>';
    if (im.status === 'error') return `<span class="chip bad" title="${esc(im.error)}">error</span>`;
    const ch = [];
    const cal = im.cal || {};
    if (cal.realSpace) ch.push('<span class="chip bad" title="The scale bar is in real-space units: this looks like an image, not a diffraction pattern">real-space image?</span>');
    else if (!cal.scale) ch.push('<span class="chip bad" title="No calibration found: use the Calibrate tool">no calibration</span>');
    else if (!cal.ok) ch.push('<span class="chip warn" title="Check the calibration value">check scale</span>');
    else ch.push(`<span class="chip ok" title="Calibration from ${esc(cal.source)}">${cal.source === 'scale bar' ? cal.value + ' 1/nm bar' : 'DM cal'}</span>`);
    const n = im.features.filter((f) => f.visible !== false).length;
    const kinds = new Set(im.features.map((f) => f.kind));
    ch.push(`<span class="chip">${n} feature${n === 1 ? '' : 's'}</span>`);
    const type = kinds.has('halo') && (kinds.has('pair') || kinds.has('spot')) ? 'amorph.+spots' : kinds.has('ring') || kinds.has('spotty') ? (kinds.has('halo') ? 'rings+halo' : 'rings') : kinds.has('pair') || kinds.has('spot') ? 'spots' : kinds.has('halo') ? 'amorphous' : 'no features';
    ch.push(`<span class="chip">${type}</span>`);
    if (im.centerMethod === 'manual') ch.push('<span class="chip ok">centre set</span>');
    else if (im.centerConfidence === 'low') ch.push('<span class="chip warn" title="Independent centre estimates disagree (typical for faint, broad halos). Spot-pair d-spacings are unaffected; check rings and single spots.">check centre</span>');
    return ch.join('');
  }
  function renderFileItem(im) {
    const li = document.querySelector(`#files li[data-id="${im.id}"]`); if (!li) return renderFiles();
    li.innerHTML = `${im.thumbURL ? `<img src="${im.thumbURL}" alt="">` : '<div class="ph"></div>'}<div><div class="nm">${esc(im.name)}</div><div class="chips">${fileChips(im)}</div></div>`;
    li.classList.toggle('sel', S.images[S.cur] === im);
  }
  function renderFiles() {
    $('files').innerHTML = S.images.map((im) => `<li data-id="${im.id}" title="${esc(im.path)}"></li>`).join('');
    S.images.forEach(renderFileItem);
  }
  function select(i) {
    if (i < 0 || i >= S.images.length) return;
    S.cur = i; S.selFeat = null;
    const im = S.images[i];
    document.querySelectorAll('#files li').forEach((li) => li.classList.toggle('sel', +li.dataset.id === im.id));
    $('selPreset').value = im.preset || 'auto';
    $('toolbar').style.display = '';
    if (!S.disp || S.disp.id !== im.id) { ov.innerHTML = ''; const cx = cv.getContext('2d'); cx.clearRect(0, 0, cv.width, cv.height); }
    loadDisplay(im); renderAll();
  }

  // ---------------- right panels ----------------
  let tab = 'features';
  function renderAll() { renderPanel(); renderOverlay(); if (S.polar) renderPolar(); const im = S.images[S.cur]; if (im) renderFileItem(im); }
  function renderPanel() {
    ['features', 'phases', 'style'].forEach((t) => { $('tab-' + t).style.display = t === tab ? '' : 'none'; });
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'features') renderFeatures(); else if (tab === 'phases') renderPhases(); else renderStyle();
  }
  function renderFeatures() {
    const el = $('tab-features'), im = S.images[S.cur];
    if (!im) { el.innerHTML = '<p class="small">Open a folder to begin.</p>'; return; }
    if (im.status !== 'done') { el.innerHTML = `<p class="small">${im.status === 'error' ? 'Could not read this file: ' + esc(im.error) : 'Analysing…'}</p>`; return; }
    const cal = im.cal || {};
    const calVal = cal.scale ? (cal.source === 'scale bar' ? `${cal.value} 1/nm over ${cal.lengthPx} px` : `${cal.scale.toPrecision(5)} 1/nm per px`) : 'not calibrated';
    let h = `<div class="card"><h3>Calibration</h3>
      <div class="row"><span>${esc(calVal)}</span><span class="small">(${esc(cal.source || '')})</span></div>
      ${cal.realSpace ? '<div class="small" style="color:var(--bad)">The scale bar is in real-space units (nm). This looks like an image, not a diffraction pattern.</div>' : ''}
      ${cal.source === 'scale bar' || cal.lengthPx ? `<div class="row"><label>Bar value</label><input type="number" step="any" id="calValue" value="${cal.value || ''}"> <span class="small">1/nm over</span> <input type="number" id="calPx" value="${cal.lengthPx || ''}"> <span class="small">px</span></div>` : ''}
      ${!cal.ok && cal.scale ? '<div class="small" style="color:var(--warn)">Please confirm the bar value above.</div>' : ''}
      <div class="row"><button id="btnCalTool">Calibrate by clicking…</button>${im.dmCal ? '<button id="btnCalDM">Use DM metadata</button>' : ''}${im.sb && im.sb.value ? '<button id="btnCalBar">Use scale bar</button>' : ''}</div>
      <div class="small">d = 1 / (distance from centre in 1/nm). For a spot pair, the distance is half the spot-to-spot separation, which does not depend on the centre.</div></div>`;
    h += `<div class="card"><h3>Centre</h3><div class="row"><span>x ${im.center.x.toFixed(1)}, y ${im.center.y.toFixed(1)}</span><span class="small">${esc(im.centerMethod || '')}</span></div>${im.centerConfidence === 'low' && im.centerMethod !== 'manual' ? '<div class="small" style="color:var(--warn)">Low confidence: independent estimates disagree. Turn on Centre ✚ and compare with the rings; click Set centre if needed.</div>' : ''}
      <div class="row"><button id="btnSetCenter">Set centre by clicking</button><button id="btnReanalyse" title="Re-run detection with the current centre and sample type">Re-detect features</button><button id="btnAutoCenter">Auto centre</button></div></div>`;
    const feats = im.features.slice().sort((a, b) => a.r - b.r);
    h += `<div class="card"><h3>Features <span class="small" style="text-transform:none;letter-spacing:0">(${feats.length})</span></h3>
      <div class="row"><button id="btnAutoAssign" title="Match all features against the selected phases">Auto-identify</button><button id="btnClearAssign">Clear labels</button><button id="btnHideWeak" title="Hide features with low signal">Hide weak</button></div>`;
    if (!feats.length) h += '<p class="small">No features detected. Use + Spot or + Ring on the image, or change the sample type.</p>';
    for (const f of feats) {
      const lb = featureLabel(f), st = labelStyle(lb);
      const cands = im.cal && im.cal.scale && f.d ? DP.crystal.candidatesFor(f.d, phasePool(), { tol: SET.tol / 100 * (f.kind === 'halo' ? 2 : 1), max: 10 }) : [];
      const curKey = f.assign ? f.assign.phase + '|' + f.assign.label : '';
      const opts = ['<option value="">— unassigned —</option>'].concat(cands.map((cd, i) => { const key = (cd.phase.display || cd.phase.name) + '|' + cd.label; return `<option value="${i}" ${key === curKey ? 'selected' : ''}>${esc((cd.phase.display || cd.phase.name) + ' ' + cd.label)}  ${cd.dRef.toFixed(4)} nm (${cd.err >= 0 ? '+' : ''}${(cd.err * 100).toFixed(1)}%)</option>`; }));
      if (f.assign && !cands.some((cd) => (cd.phase.display || cd.phase.name) + '|' + cd.label === curKey)) opts.splice(1, 0, `<option value="keep" selected>${esc(f.assign.phase + ' ' + f.assign.label)}</option>`);
      h += `<div class="feat ${S.selFeat === f.uid ? 'sel' : ''} ${f.visible === false ? 'hidden' : ''}" data-f="${f.uid}">
        <div class="top"><span class="swatch" style="background:${st.color}"></span>
          <select data-act="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <span style="flex:1"></span>
          <input type="checkbox" data-act="vis" ${f.visible !== false ? 'checked' : ''} title="Show"><button class="x" data-act="del" title="Delete">✕</button></div>
        <div class="row"><span class="d">${f.d ? 'd = ' + f.d.toFixed(4) + ' nm' : 'r = ' + f.r.toFixed(1) + ' px'}</span><span class="small">${f.q ? f.q.toFixed(3) + ' 1/nm' : ''}${f.kind === 'halo' && f.fwhm && im.cal && im.cal.scale ? ' · FWHM ' + (f.fwhm * im.cal.scale).toFixed(2) + ' 1/nm' : ''}${f.snr ? ' · SNR ' + f.snr.toFixed(0) : ''}${f.source === 'manual' ? ' · manual' : ''}</span></div>
        <div class="row"><select data-act="assign" style="flex:1">${opts.join('')}</select></div>
        <div class="row"><input type="text" data-act="custom" placeholder="Custom label (overrides)" value="${esc(f.custom || '')}" style="flex:1"></div>
      </div>`;
      f._cands = cands;
    }
    h += '</div>';
    el.innerHTML = h;
  }

  function renderPhases() {
    const el = $('tab-phases'), im = S.images[S.cur];
    const lib = library();
    const pool = phasePool();
    let h = `<div class="card"><h3>Candidate phases</h3>
      <div class="row"><button class="primary" id="btnPT">Choose elements…</button><button id="btnClearEls">All elements</button></div>
      <div class="row">${SET.elements.length ? SET.elements.map((e) => `<span class="chip ok">${e}</span>`).join('') : '<span class="small">No elements chosen: searching the whole built-in library (' + lib.length + ' phases).</span>'}</div>
      <div class="row"><label><input type="checkbox" id="chkLib" ${SET.useLibrary ? 'checked' : ''}> Built-in library</label><span class="small">${lib.length} Materials Project phases${DP.LIBRARY_META ? ', built ' + esc(DP.LIBRARY_META.built) : ''}</span></div>
      <div class="row"><label><input type="checkbox" id="chkExp" ${SET.onlyExperimental ? 'checked' : ''}> Only experimentally observed phases</label></div>
      <div class="row"><label><input type="checkbox" id="chkGas" ${SET.excludeGases !== false ? 'checked' : ''}> Exclude molecular gases (O₂, N₂, F₂, CO₂ …)</label></div>
      <div class="row"><label>Tolerance</label><input type="number" id="numTol" min="0.5" max="10" step="0.5" value="${SET.tol}"> <span class="small">% in d-spacing (scale-bar calibration is typically good to ~1–2%)</span></div>
      <div class="small">${pool.length} phases in the current search.</div></div>`;
    h += `<div class="card"><h3>Materials Project (live)</h3><div class="small" id="mpStatus">${mpStatusText()}</div>
      <div class="row"><button id="btnMP" ${S.mpStatus === 'ok' && SET.elements.length ? '' : 'disabled'}>Search MP for the chosen elements</button></div></div>`;
    h += '<div class="card"><h3>Custom d-spacing lists</h3><div class="small">For references that are not crystal structures (e.g. turbostratic carbon halos) or your own values.</div>';
    SET.customLists.forEach((c, i) => {
      h += `<div class="feat" data-cl="${i}"><div class="top"><input type="checkbox" data-act="clOn" ${c.enabled ? 'checked' : ''}><input type="text" data-act="clName" value="${esc(c.name)}" style="flex:1"><button class="x" data-act="clDel">✕</button></div>
        <div class="row"><label style="min-width:0"><input type="checkbox" data-act="clAm" ${c.amorphousOK ? 'checked' : ''}> may label diffuse halos</label></div>
        <div class="row"><input type="text" data-act="clRows" style="flex:1" value="${esc(c.rows.map((r) => `${r.label}=${r.d}`).join(', '))}" title="label=d(nm), comma separated"></div></div>`;
    });
    h += '<div class="row"><button id="btnAddCL">Add list</button><span class="small">Format: {100}=0.212, {110}=0.123</span></div></div>';
    if (im && im.status === 'done') {
      const res = im.cal && im.cal.scale ? runMatch(im) : [];
      h += `<div class="card"><h3>Best matches for this image</h3>${!im.cal || !im.cal.scale ? '<p class="small">Calibrate the image first.</p>' : ''}
        <table class="res"><tr><th>Phase</th><th>Fit</th><th>Err</th><th></th></tr>`;
      if (res.length > 1 && res[1].score > 0.95 * res[0].score && res[0].phase.name !== res[1].phase.name) h += `<div class="small" style="color:var(--warn);margin-bottom:6px">Ambiguous: several phases fit about equally well${featsForMatch(im).filter((f) => f.kind !== 'halo').length <= 2 ? ' (only one or two crystalline d-spacings were measured)' : ''}. Choose elements, star the phases you expect, or pick per feature.</div>`;
      res.slice(0, 25).forEach((r, i) => {
        const ph = r.phase;
        h += `<tr data-r="${i}"><td><b>${esc(ph.display || ph.name)}</b>${ph.sg ? ' <span class="small">' + esc(ph.sg) + '</span>' : ''}${ph.theoretical ? ' <span class="chip warn" title="Predicted, not experimentally observed">theor.</span>' : ''}${ph.indexNote ? ' <span class="chip" title="' + esc(ph.indexNote) + '">prim.</span>' : ''}
          <div class="small">${Object.values(r.assign).slice(0, 4).map((a) => esc(a.label)).join(' ')}${r.zone ? ' · zone [' + r.zone.uvw.join(' ') + ']' : ''}${ph.id && /^mp-/.test(ph.id) ? ` · <a href="https://next-gen.materialsproject.org/materials/${esc(ph.id)}" target="_blank" rel="noopener">${esc(ph.id)}</a>` : ''}</div></td>
          <td>${r.nMatched}/${r.nFeatures}</td><td>${(r.meanErr * 100).toFixed(1)}%${r.scale && Math.abs(r.scale - 1) > 0.002 ? '<div class="small" title="Common scale factor absorbed (calibration or DFT lattice error)">×' + r.scale.toFixed(3) + '</div>' : ''}</td><td style="white-space:nowrap"><button data-act="star" data-r="${i}" title="Preferred phase: ranked first when it fits" class="${ph.preferred ? 'on' : ''}">★</button> <button data-act="apply" data-r="${i}">Apply</button></td></tr>`;
      });
      h += '</table><div class="small">Fit = features explained by the phase. Ranking also penalises strong ring reflections that are missing and, with ≥2 spot pairs, checks the angle between them (zone axis).</div></div>';
    }
    el.innerHTML = h;
  }
  function mpStatusText() {
    if (S.mpStatus === 'ok') return 'Connected through the local helper (serve.py).';
    if (S.mpStatus === 'checking') return 'Checking for the local helper…';
    return 'Browsers cannot call the Materials Project API directly. To search it live, start the helper in a terminal: <span class="kbd">python3 serve.py</span> and open the page it prints. The built-in library works without it.';
  }
  function renderStyle() {
    const el = $('tab-style'), st = SET.style, im = S.images[S.cur];
    const fonts = [['Calibri, Carlito, "Segoe UI", Arial, sans-serif', 'Calibri'], ['Arial, Helvetica, sans-serif', 'Arial'], ['Helvetica, Arial, sans-serif', 'Helvetica'], ['"Segoe UI", Arial, sans-serif', 'Segoe UI'], ['"Times New Roman", Times, serif', 'Times New Roman'], ['Georgia, serif', 'Georgia'], ['"Courier New", monospace', 'Courier New']];
    let h = `<div class="card"><h3>Legend</h3>
      <div class="row"><label>Font</label><select id="stFont">${fonts.map(([v, n]) => `<option value='${v}' ${v === st.font ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row"><label>Size</label><input type="range" id="stFontSize" min="12" max="80" value="${st.fontSize}"><span class="small">${st.fontSize}</span></div>
      <div class="row"><label>Background</label><select id="stBg"><option value="none" ${st.legendBg === 'none' ? 'selected' : ''}>None</option><option value="dark" ${st.legendBg === 'dark' ? 'selected' : ''}>Dark box</option><option value="light" ${st.legendBg === 'light' ? 'selected' : ''}>Light box</option></select></div>
      <div class="row"><label>Symbol</label><select id="stSw"><option value="none" ${st.legendSwatch === 'none' ? 'selected' : ''}>Coloured text only</option><option value="marker" ${st.legendSwatch === 'marker' ? 'selected' : ''}>Marker + text</option></select></div>
      <div class="row"><label>d-spacing</label><select id="stShowD"><option value="measured" ${st.showD === 'measured' ? 'selected' : ''}>Measured</option><option value="reference" ${st.showD === 'reference' ? 'selected' : ''}>Reference (database)</option><option value="none" ${st.showD === 'none' ? 'selected' : ''}>Hide</option></select><select id="stDig">${[2, 3, 4].map((d) => `<option ${d === st.dDigits ? 'selected' : ''}>${d}</option>`).join('')}</select><span class="small">decimals</span></div>
      <div class="row"><label><input type="checkbox" id="stLabelMarks" ${st.labelMarks ? 'checked' : ''}> Label each marker</label></div>
      <div class="row"><button id="btnLegendReset">Reset legend position</button><span class="small">Drag the legend on the image to move it.</span></div></div>`;
    h += `<div class="card"><h3>Markers</h3>
      <div class="row"><label>Spot circle size</label><input type="range" id="stMs" min="4" max="40" value="${st.markerSize}"></div>
      <div class="row"><label>Line width</label><input type="range" id="stLw" min="1" max="10" step="0.5" value="${st.lineWidth}"></div>
      <div class="row"><label>Ring arc</label><select id="stSpan">${[[45, '1/8 circle'], [90, 'Quarter circle'], [180, 'Half circle'], [360, 'Full circle']].map(([v, n]) => `<option value="${v}" ${+st.arcSpan === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row"><label>Arc position</label><select id="stArcMode"><option value="auto" ${st.arcMode === 'auto' ? 'selected' : ''}>Relative to beam stop</option><option value="fixed" ${st.arcMode === 'fixed' ? 'selected' : ''}>Fixed angle</option></select><input type="range" id="stArcAng" min="-180" max="180" value="${st.arcAngle}" title="Rotate arcs"></div>
      <div class="row"><label><input type="checkbox" id="stCenter" ${st.showCenter ? 'checked' : ''}> Show centre in export</label></div></div>`;
    if (im && im.status === 'done') {
      h += '<div class="card"><h3>Colours & line styles</h3><div class="small">Styles follow the label, so "Na {200}" looks the same in every image.</div>';
      legendEntries(im).forEach((e, i) => {
        const s = e.style;
        h += `<div class="row" data-lb="${esc(e.label)}"><input type="color" data-act="color" value="${s.color}"><span style="flex:1;color:${s.color}">${esc(e.label)}</span>
          <select data-act="dash">${['solid', 'dashed', 'dotted'].map((d) => `<option ${s.dash === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
          <select data-act="shape" title="Spot marker">${['circle', 'square', 'none'].map((d) => `<option ${s.shape === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
          ${e.feats.some((f) => f.kind === 'spotty') ? `<select data-act="ringMark" title="Spotty ring marker"><option value="arc" ${s.ringMark !== 'circles' ? 'selected' : ''}>arc</option><option value="circles" ${s.ringMark === 'circles' ? 'selected' : ''}>circle spots</option></select>` : ''}</div>`;
      });
      h += '</div>';
    }
    h += `<div class="card"><h3>Export</h3>
      <div class="row"><label>Region</label><select id="stRegion"><option value="full" ${st.exportRegion === 'full' ? 'selected' : ''}>Whole image</option><option value="view" ${st.exportRegion === 'view' ? 'selected' : ''}>Current view (zoom/pan to crop)</option></select></div>
      <div class="row"><label>Resolution</label><select id="stScale">${[[1, 'Full'], [0.5, '1/2'], [0.25, '1/4']].map(([v, n]) => `<option value="${v}" ${+st.exportScale === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row"><label>Scale bar</label><select id="stSB"><option value="off" ${st.scaleBar === 'off' ? 'selected' : ''}>Keep original only</option><option value="on" ${st.scaleBar === 'on' ? 'selected' : ''}>Draw a new one (useful when cropping)</option></select></div></div>`;
    el.innerHTML = h;
  }

  // ---------------- periodic table ----------------
  const PT = [
    ['H', 1, 1], ['He', 18, 1], ['Li', 1, 2], ['Be', 2, 2], ['B', 13, 2], ['C', 14, 2], ['N', 15, 2], ['O', 16, 2], ['F', 17, 2], ['Ne', 18, 2],
    ['Na', 1, 3], ['Mg', 2, 3], ['Al', 13, 3], ['Si', 14, 3], ['P', 15, 3], ['S', 16, 3], ['Cl', 17, 3], ['Ar', 18, 3]];
  const row4 = ['K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr'];
  const row5 = ['Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe'];
  const row6 = ['Cs', 'Ba', 'La', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn'];
  row4.forEach((e, i) => PT.push([e, i + 1, 4])); row5.forEach((e, i) => PT.push([e, i + 1, 5])); row6.forEach((e, i) => PT.push([e, i + 1, 6]));
  ['Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'].forEach((e, i) => PT.push([e, i + 4, 8]));
  function openPT() {
    const inLib = new Set(); library().forEach((p) => p.els.forEach((e) => inLib.add(e)));
    const cells = [];
    for (let r = 1; r <= 8; r++) for (let c = 1; c <= 18; c++) {
      const e = PT.find((x) => x[1] === c && x[2] === r);
      cells.push(e ? `<button data-el="${e[0]}" class="${SET.elements.includes(e[0]) ? 'sel' : ''} ${inLib.has(e[0]) ? 'lib' : 'nolib'}" title="${inLib.has(e[0]) ? 'In built-in library' : 'Not in built-in library (use live MP search)'}">${e[0]}</button>` : '<span class="gap"></span>');
    }
    modal(`<h2 style="margin:0 0 4px">Elements in the sample</h2><div class="small">Phases made only of the chosen elements are searched. Choose none to search everything. Faded elements are not in the built-in library.</div>
      <div class="ptable">${cells.join('')}</div><div class="row"><button id="ptClear">Clear</button><span style="flex:1"></span><button class="primary" id="ptDone">Done</button></div>`);
    $('modal').onclick = (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.el) { const e = b.dataset.el; const i = SET.elements.indexOf(e); if (i >= 0) SET.elements.splice(i, 1); else SET.elements.push(e); b.classList.toggle('sel'); }
      if (b.id === 'ptClear') { SET.elements = []; document.querySelectorAll('.ptable button').forEach((x) => x.classList.remove('sel')); }
      if (b.id === 'ptDone') { saveSettings(); closeModal(); const im = S.images[S.cur]; if (im && SET.autoAssign) { autoAssign(im); } renderAll(); }
    };
  }
  function modal(html) { $('modal').innerHTML = html; $('modalBg').style.display = 'flex'; }
  function closeModal() { $('modalBg').style.display = 'none'; $('modal').onclick = null; }
  $('modalBg').addEventListener('mousedown', (ev) => { if (ev.target === $('modalBg')) closeModal(); });
  function help() {
    modal(`<div style="max-width:680px"><h2 style="margin-top:0">How it works</h2>
      <ol><li><b>Open a folder.</b> Every TIFF/PNG/JPG/DM3/DM4 is analysed in the background. Nothing leaves your computer.</li>
      <li><b>Calibration</b> comes from the burned-in scale bar (its length and label are read automatically) or, for DM files, the metadata. Check the chip next to each file.</li>
      <li><b>Centre</b> is found from the symmetry of the pattern and refined by fitting circles to the rings. Use <i>Centre</i> to set it by hand.</li>
      <li><b>Features</b> are classified per ring or spot, so mixed patterns work: diffuse halos (amorphous), sharp rings (polycrystalline), spotty rings, spot pairs (single crystal) and single spots whose partner is hidden by the beam stop.</li>
      <li><b>Identify</b>: choose the elements in <i>Phases</i>. Each feature's d-spacing is matched against Materials Project structures (kinematic electron intensities; absent reflections removed). With two or more spot pairs the angle between them is checked and a zone axis reported.</li>
      <li><b>Style & export</b>: colours follow labels across images. Drag the legend. Export PNG/SVG, copy to the clipboard for PowerPoint, or export every image at once.</li></ol>
      <p><b>d-spacing:</b> d = 1/g, where g is the distance from the centre in 1/nm. Measuring across two opposite spots gives 2g, so halve it first.</p>
      <p><b>Shortcuts:</b> <span class="kbd">V</span> select, <span class="kbd">S</span> add spot, <span class="kbd">R</span> add ring, <span class="kbd">C</span> centre, <span class="kbd">K</span> calibrate, <span class="kbd">F</span> fit, <span class="kbd">P</span> polar view, <span class="kbd">Del</span> delete feature, <span class="kbd">↑/↓</span> previous/next image.</p>
      <div class="row"><span style="flex:1"></span><button class="primary" onclick="document.getElementById('modalBg').style.display='none'">Close</button></div></div>`);
  }

  // ---------------- re-analysis ----------------
  async function reanalyse(im, center) {
    const keepCal = im.cal && im.cal.source === 'manual' ? im.cal : null;
    const manual = im.features.filter((f) => f.source === 'manual');
    im.status = 'working'; renderFileItem(im); renderPanel();
    const r = await runJob(im.file, { preset: im.preset, center: center || null }, { analyze: true }, true);
    im.features = [];
    applyAnalysis(im, r, false);
    if (keepCal) im.cal = keepCal;
    im.features = im.features.filter((f) => f.source !== 'manual').concat(manual);
    recomputeD(im); if (SET.autoAssign) autoAssign(im);
    renderAll();
  }

  // ---------------- interactions ----------------
  function setTool(t) {
    S.tool = t; document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    const hints = { select: 'Drag to pan · scroll to zoom · drag the legend to move it · click a marker to select it', spot: 'Click a diffraction spot. Its Friedel partner (opposite the centre) is added automatically if visible.', ring: 'Click anywhere on a ring or halo. The radius snaps to the nearest intensity peak.', center: 'Click the pattern centre (the direct beam). Features are re-detected around it.', calib: 'Click one end of a known length (e.g. the scale bar), then the other end.' };
    $('hint').textContent = hints[t]; $('hint').style.display = S.images.length ? '' : 'none';
    stage.style.cursor = t === 'select' ? 'grab' : 'crosshair';
    calibClicks = []; renderOverlay();
  }
  let drag = null, calibClicks = [];
  stage.addEventListener('wheel', (ev) => {
    if (S.polar) return; ev.preventDefault();
    const r = stage.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const k = Math.exp(-ev.deltaY * 0.0015), z = Math.min(20, Math.max(0.02, S.view.z * k)), kk = z / S.view.z;
    S.view.x = mx - (mx - S.view.x) * kk; S.view.y = my - (my - S.view.y) * kk; S.view.z = z; applyView();
  }, { passive: false });
  stage.addEventListener('mousedown', (ev) => {
    const im = S.images[S.cur]; if (!im || im.status !== 'done' || S.polar) return;
    const p = toImg(ev);
    if (ev.button === 1 || (ev.button === 0 && ev.altKey)) { drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y }; return; }
    if (ev.button !== 0) return;
    const leg = ev.target.closest && ev.target.closest('#legend');
    if (S.tool === 'select') {
      if (leg) { const tr = leg.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/); drag = { kind: 'legend', ox: p.x - +tr[1], oy: p.y - +tr[2] }; return; }
      const hit = ev.target.dataset && ev.target.dataset.f;
      if (hit) { S.selFeat = hit; renderAll(); scrollToFeat(hit); return; }
      drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y }; stage.style.cursor = 'grabbing'; return;
    }
    if (!S.disp) return;
    if (S.tool === 'spot') addSpot(im, p);
    else if (S.tool === 'ring') addRing(im, p);
    else if (S.tool === 'center') { setTool('select'); reanalyse(im, { x: p.x, y: p.y }); }
    else if (S.tool === 'calib') {
      calibClicks.push(p);
      if (calibClicks.length === 1) { ov.insertAdjacentHTML('beforeend', `<circle cx="${p.x}" cy="${p.y}" r="${6 / S.view.z}" fill="#5aa9ff"/>`); return; }
      const [a, b] = calibClicks; const len = Math.hypot(a.x - b.x, a.y - b.y); calibClicks = [];
      const v = parseFloat(prompt(`Length clicked: ${len.toFixed(1)} px.\nWhat is this length in 1/nm?`, im.sb && im.sb.value ? im.sb.value : '5'));
      if (v > 0) { im.cal = { scale: v / len, source: 'manual', value: v, lengthPx: +len.toFixed(1), ok: true, unit: '1/nm' }; recomputeD(im); if (SET.autoAssign) autoAssign(im); }
      setTool('select'); renderAll();
    }
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    if (drag.kind === 'pan') { S.view.x = drag.vx + ev.clientX - drag.sx; S.view.y = drag.vy + ev.clientY - drag.sy; applyView(); }
    else if (drag.kind === 'legend') { const im = S.images[S.cur], p = toImg(ev); im.legend = { x: (p.x - drag.ox) / im.W, y: (p.y - drag.oy) / im.H }; renderOverlay(); }
  });
  window.addEventListener('mouseup', () => { if (drag) { drag = null; stage.style.cursor = S.tool === 'select' ? 'grab' : 'crosshair'; } });
  function scrollToFeat(u) { if (tab !== 'features') return; const el = document.querySelector(`#tab-features .feat[data-f="${u}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
  function localStats(data, W, H, x, y, r) {
    const vals = []; for (let yy = Math.max(0, Math.round(y - r)); yy <= Math.min(H - 1, Math.round(y + r)); yy++) for (let xx = Math.max(0, Math.round(x - r)); xx <= Math.min(W - 1, Math.round(x + r)); xx++) { const d = Math.hypot(xx - x, yy - y); if (d > r * 0.6 && d <= r) vals.push(data[yy * W + xx]); }
    vals.sort((a, b) => a - b); const m = vals[vals.length >> 1] || 0; const mad = vals.length ? vals.map((v) => Math.abs(v - m)).sort((a, b) => a - b)[vals.length >> 1] : 0;
    return { m, s: 1.4826 * mad + 1 };
  }
  function addSpot(im, p) {
    const { data, W, H } = S.disp, rad = Math.max(4, Math.round(0.006 * W));
    const a = DP.snapSpot(data, W, H, p.x, p.y, rad);
    const c = im.center, q0 = { x: 2 * c.x - a.x, y: 2 * c.y - a.y };
    let feat;
    if (q0.x >= 0 && q0.y >= 0 && q0.x < W && q0.y < H) {
      const b = DP.snapSpot(data, W, H, q0.x, q0.y, rad * 2);
      const st = localStats(data, W, H, b.x, b.y, rad * 3), peak = data[Math.round(b.y) * W + Math.round(b.x)];
      if (peak > st.m + 4 * st.s && Math.hypot(b.x - q0.x, b.y - q0.y) < rad * 2.5) feat = { kind: 'pair', points: [a, b] };
    }
    if (!feat) feat = { kind: 'spot', points: [a] };
    Object.assign(feat, { uid: 'u' + (++uid), source: 'manual', visible: true, assign: null, custom: '', fwhm: 0, r: 0 });
    im.features.push(feat); recomputeD(im);
    if (SET.autoAssign) autoAssign(im);
    S.selFeat = feat.uid; renderAll();
  }
  function addRing(im, p) {
    const c = im.center, r0 = Math.hypot(p.x - c.x, p.y - c.y);
    let best = r0, bv = -Infinity;
    for (const [r, , , res] of im.profile || []) if (Math.abs(r - r0) < Math.max(6, 0.04 * r0) && res > bv) { bv = res; best = r; }
    const feat = { kind: 'ring', r: best, fwhm: 0, points: [], uid: 'u' + (++uid), source: 'manual', visible: true, assign: null, custom: '' };
    im.features.push(feat); recomputeD(im); if (SET.autoAssign) autoAssign(im);
    S.selFeat = feat.uid; renderAll();
  }
  document.addEventListener('keydown', (ev) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const im = S.images[S.cur];
    const k = ev.key.toLowerCase();
    if (k === 'v') setTool('select'); else if (k === 's') setTool('spot'); else if (k === 'r') setTool('ring'); else if (k === 'c') setTool('center'); else if (k === 'k') setTool('calib');
    else if (k === 'f') fit(); else if (k === 'p') togglePolar();
    else if (k === 'arrowdown' || k === 'arrowright') { ev.preventDefault(); select(Math.min(S.images.length - 1, S.cur + 1)); }
    else if (k === 'arrowup' || k === 'arrowleft') { ev.preventDefault(); select(Math.max(0, S.cur - 1)); }
    else if ((k === 'delete' || k === 'backspace') && im && S.selFeat) { im.features = im.features.filter((f) => f.uid !== S.selFeat); S.selFeat = null; renderAll(); }
    else if (k === 'escape') { setTool('select'); closeModal(); }
  });
  function togglePolar() { S.polar = !S.polar; $('polar').style.display = S.polar ? 'block' : 'none'; $('btnPolar').classList.toggle('on', S.polar); if (S.polar) renderPolar(); }

  // panel events (delegated)
  $('tab-features').addEventListener('change', (ev) => {
    const im = S.images[S.cur]; if (!im) return;
    const t = ev.target;
    if (t.id === 'calValue' || t.id === 'calPx') {
      const v = parseFloat($('calValue').value), px = parseFloat($('calPx').value);
      if (v > 0 && px > 0) { im.cal = Object.assign({}, im.cal, { scale: v / px, value: v, lengthPx: px, ok: true, unit: '1/nm', source: im.cal.source === 'scale bar' ? 'scale bar' : 'manual' }); recomputeD(im); if (SET.autoAssign) autoAssign(im); renderAll(); }
      return;
    }
    const fe = t.closest('.feat'); if (!fe) return;
    const f = im.features.find((x) => x.uid === fe.dataset.f); if (!f) return;
    const act = t.dataset.act;
    if (act === 'kind') { f.kind = t.value; if (f.kind === 'spot' && f.points.length > 1) f.points = f.points.slice(0, 1); recomputeD(im); }
    else if (act === 'vis') f.visible = t.checked;
    else if (act === 'assign') {
      if (t.value === '') f.assign = null;
      else if (t.value !== 'keep') { const cd = f._cands[+t.value]; f.assign = { phase: cd.phase.display || cd.phase.name, phaseId: cd.phase.id, label: cd.label, dRef: cd.dRef, err: cd.err, auto: false }; f.custom = ''; }
    } else if (act === 'custom') f.custom = t.value.trim();
    renderAll();
  });
  $('tab-features').addEventListener('click', (ev) => {
    const im = S.images[S.cur]; if (!im) return;
    const t = ev.target, id = t.id;
    if (id === 'btnCalTool') return setTool('calib');
    if (id === 'btnCalDM') { im.cal = chooseCalibration(Object.assign({}, im, { sb: null })); recomputeD(im); renderAll(); return; }
    if (id === 'btnCalBar') { im.cal = chooseCalibration(Object.assign({}, im, { dmCal: null })); recomputeD(im); renderAll(); return; }
    if (id === 'btnSetCenter') return setTool('center');
    if (id === 'btnReanalyse') return reanalyse(im, im.centerMethod === 'manual' ? im.center : null);
    if (id === 'btnAutoCenter') return reanalyse(im, null);
    if (id === 'btnAutoAssign') { im.features.forEach((f) => { if (f.assign) f.assign.auto = true; }); autoAssign(im); renderAll(); return; }
    if (id === 'btnClearAssign') { im.features.forEach((f) => { f.assign = null; f.custom = ''; }); renderAll(); return; }
    if (id === 'btnHideWeak') { const snrs = im.features.map((f) => f.snr || 0).sort((a, b) => a - b); const thr = Math.max(8, snrs[Math.floor(snrs.length * 0.3)] || 0); im.features.forEach((f) => { if (f.source !== 'manual' && (f.snr || 0) < thr && f.kind !== 'halo') f.visible = false; }); renderAll(); return; }
    if (t.dataset.act === 'del') { const fe = t.closest('.feat'); im.features = im.features.filter((f) => f.uid !== fe.dataset.f); renderAll(); return; }
    const fe = t.closest('.feat'); if (fe && !/SELECT|INPUT|BUTTON|OPTION/.test(t.tagName)) { S.selFeat = fe.dataset.f; renderAll(); }
  });
  $('tab-phases').addEventListener('click', async (ev) => {
    const t = ev.target, im = S.images[S.cur];
    if (t.id === 'btnPT') return openPT();
    if (t.id === 'btnClearEls') { SET.elements = []; saveSettings(); if (im && SET.autoAssign) autoAssign(im); return renderAll(); }
    if (t.id === 'btnAddCL') { SET.customLists.push({ id: 'c-' + Date.now(), name: 'My phase', enabled: true, amorphousOK: false, rows: [] }); saveSettings(); return renderPanel(); }
    if (t.id === 'btnMP') return searchMP();
    if (t.dataset.act === 'clDel') { SET.customLists.splice(+t.closest('[data-cl]').dataset.cl, 1); saveSettings(); return renderAll(); }
    const tr = t.closest('tr[data-r]');
    if (tr && im && im.matches && t.dataset.act === 'star') { const id = im.matches[+tr.dataset.r].phase.id; SET.preferred = SET.preferred || []; const k = SET.preferred.indexOf(id); if (k >= 0) SET.preferred.splice(k, 1); else SET.preferred.push(id); saveSettings(); if (SET.autoAssign) autoAssign(im); return renderAll(); }
    if (tr && im && im.matches) { assignFromResult(im, im.matches[+tr.dataset.r], t.dataset.act !== 'apply'); renderAll(); toast('Labels applied from ' + esc(im.matches[+tr.dataset.r].phase.display || im.matches[+tr.dataset.r].phase.name)); }
  });
  $('tab-phases').addEventListener('change', (ev) => {
    const t = ev.target, im = S.images[S.cur];
    if (t.id === 'chkLib') SET.useLibrary = t.checked;
    else if (t.id === 'chkExp') SET.onlyExperimental = t.checked;
    else if (t.id === 'chkGas') SET.excludeGases = t.checked;
    else if (t.id === 'numTol') SET.tol = Math.max(0.5, parseFloat(t.value) || 3);
    const cl = t.closest('[data-cl]');
    if (cl) {
      const c = SET.customLists[+cl.dataset.cl];
      if (t.dataset.act === 'clOn') c.enabled = t.checked;
      if (t.dataset.act === 'clAm') c.amorphousOK = t.checked;
      if (t.dataset.act === 'clName') c.name = t.value;
      if (t.dataset.act === 'clRows') c.rows = t.value.split(',').map((s) => s.split('=')).filter((p) => p.length === 2 && parseFloat(p[1]) > 0).map(([l, d]) => ({ label: l.trim(), d: parseFloat(d) }));
    }
    saveSettings(); if (im && SET.autoAssign) autoAssign(im); renderAll();
  });
  $('tab-style').addEventListener('input', (ev) => {
    const t = ev.target, st = SET.style, im = S.images[S.cur];
    const map = { stFont: 'font', stFontSize: 'fontSize', stBg: 'legendBg', stSw: 'legendSwatch', stShowD: 'showD', stDig: 'dDigits', stMs: 'markerSize', stLw: 'lineWidth', stSpan: 'arcSpan', stArcMode: 'arcMode', stArcAng: 'arcAngle', stRegion: 'exportRegion', stScale: 'exportScale', stSB: 'scaleBar' };
    if (map[t.id]) { const num = ['fontSize', 'dDigits', 'markerSize', 'lineWidth', 'arcSpan', 'arcAngle', 'exportScale'].includes(map[t.id]); st[map[t.id]] = num ? parseFloat(t.value) : t.value; }
    if (t.id === 'stLabelMarks') st.labelMarks = t.checked;
    if (t.id === 'stCenter') st.showCenter = t.checked;
    const row = t.closest('[data-lb]');
    if (row) { const ls = SET.labelStyles[row.dataset.lb]; if (ls) ls[t.dataset.act] = t.value; }
    saveSettings(); renderOverlay(); if (S.polar) renderPolar();
    if (ev.type === 'input' && t.type === 'range') { const sp = t.nextElementSibling; if (sp && sp.classList.contains('small')) sp.textContent = t.value; }
    if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'color') { if (im) renderFileItem(im); }
  });
  $('tab-style').addEventListener('change', (ev) => { if (ev.target.type === 'color' || ev.target.tagName === 'SELECT') renderStyle(); });
  $('tab-style').addEventListener('click', (ev) => { if (ev.target.id === 'btnLegendReset') { const im = S.images[S.cur]; if (im) { im.legend = null; renderOverlay(); } } });

  // ---------------- export ----------------
  function exportRegion(im) {
    if (SET.style.exportRegion !== 'view') return { x: 0, y: 0, w: im.W, h: im.H };
    const r = stage.getBoundingClientRect();
    const x0 = Math.max(0, -S.view.x / S.view.z), y0 = Math.max(0, -S.view.y / S.view.z);
    const x1 = Math.min(im.W, (r.width - S.view.x) / S.view.z), y1 = Math.min(im.H, (r.height - S.view.y) / S.view.z);
    return { x: Math.round(x0), y: Math.round(y0), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(y1 - y0)) };
  }
  function regionCanvas(disp, reg, scale) {
    const L = lut(), src = document.createElement('canvas'); src.width = reg.w; src.height = reg.h;
    const cx = src.getContext('2d'), id = cx.createImageData(reg.w, reg.h);
    for (let y = 0; y < reg.h; y++) for (let x = 0; x < reg.w; x++) { const v = L[disp.data[(y + reg.y) * disp.W + x + reg.x]], j = 4 * (y * reg.w + x); id.data[j] = id.data[j + 1] = id.data[j + 2] = v; id.data[j + 3] = 255; }
    cx.putImageData(id, 0, 0);
    if (scale === 1) return src;
    const out = document.createElement('canvas'); out.width = Math.round(reg.w * scale); out.height = Math.round(reg.h * scale);
    const o = out.getContext('2d'); o.imageSmoothingQuality = 'high'; o.drawImage(src, 0, 0, out.width, out.height); return out;
  }
  function overlaySVGString(im, reg, w, h) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${reg.x} ${reg.y} ${reg.w} ${reg.h}">${buildOverlay(im, { export: true, region: reg })}</svg>`;
  }
  async function renderExport(im, disp) {
    const reg = exportRegion(im), scale = +SET.style.exportScale || 1;
    const canvas = regionCanvas(disp, reg, scale);
    const svg = overlaySVGString(im, reg, canvas.width, canvas.height);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  const baseName = (im) => im.name.replace(/\.[^.]+$/, '');
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  const toBlob = (c, type) => new Promise((res) => c.toBlob(res, type || 'image/png'));
  async function dispFor(im) {
    if (S.disp && S.disp.id === im.id) return S.disp;
    const r = await runJob(im.file, {}, { display: true }); return { id: im.id, data: r.display, W: r.width, H: r.height };
  }
  function csvRows(im) {
    const rows = [];
    for (const f of im.features.slice().sort((a, b) => a.r - b.r)) {
      if (f.visible === false) continue;
      rows.push([im.path, f.uid, KIND[f.kind], f.r.toFixed(2), f.q ? f.q.toFixed(4) : '', f.d ? f.d.toFixed(5) : '', featureLabel(f), f.assign ? f.assign.phase : '', f.assign ? f.assign.label : '', f.assign && f.assign.dRef ? f.assign.dRef.toFixed(5) : '', f.assign && f.assign.err != null ? (f.assign.err * 100).toFixed(2) : '', im.cal ? im.cal.source : '', im.cal && im.cal.scale ? im.cal.scale.toPrecision(6) : '', im.center.x.toFixed(1), im.center.y.toFixed(1), f.points.map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('; ')]);
    }
    return rows;
  }
  const CSV_HEAD = ['file', 'feature', 'type', 'r_px', 'g_1_per_nm', 'd_nm', 'label', 'phase', 'hkl', 'd_ref_nm', 'error_pct', 'calibration', 'scale_1_per_nm_per_px', 'centre_x', 'centre_y', 'spot_positions_px'];
  const toCSV = (rows) => [CSV_HEAD].concat(rows).map((r) => r.map((v) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
  async function doExport(kind) {
    const im = S.images[S.cur];
    try {
      if (kind === 'png' && im) { const c = await renderExport(im, await dispFor(im)); download(await toBlob(c), baseName(im) + '_annotated.png'); }
      else if (kind === 'svg' && im) {
        const disp = await dispFor(im), reg = exportRegion(im), c = regionCanvas(disp, reg, 1);
        const href = c.toDataURL('image/png');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${reg.w}" height="${reg.h}" viewBox="${reg.x} ${reg.y} ${reg.w} ${reg.h}"><image x="${reg.x}" y="${reg.y}" width="${reg.w}" height="${reg.h}" xlink:href="${href}" href="${href}"/>${buildOverlay(im, { export: true, region: reg })}</svg>`;
        download(new Blob([svg], { type: 'image/svg+xml' }), baseName(im) + '_annotated.svg');
      } else if (kind === 'csv' && im) download(new Blob([toCSV(csvRows(im))], { type: 'text/csv' }), baseName(im) + '_features.csv');
      else if (kind === 'csvall') download(new Blob([toCSV(S.images.filter((x) => x.status === 'done').flatMap(csvRows))], { type: 'text/csv' }), 'diffraction_features.csv');
      else if (kind === 'zip') {
        const done = S.images.filter((x) => x.status === 'done'); const files = [];
        for (let i = 0; i < done.length; i++) {
          setStatus(`Exporting ${i + 1}/${done.length}…`);
          const x = done[i], c = await renderExport(x, await dispFor(x));
          files.push({ name: x.path.replace(/\.[^.]+$/, '') + '_annotated.png', data: new Uint8Array(await (await toBlob(c)).arrayBuffer()) });
        }
        files.push({ name: 'diffraction_features.csv', data: new TextEncoder().encode(toCSV(done.flatMap(csvRows))) });
        files.push({ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(projectJSON(), null, 1)) });
        download(DP.makeZip(files), 'diffraction_annotated.zip'); setStatus(`${S.images.length} image(s)`);
      } else if (kind === 'project') download(new Blob([JSON.stringify(projectJSON(), null, 1)], { type: 'application/json' }), 'diffraction_project.json');
      else if (kind === 'loadproject') $('inProject').click();
    } catch (e) { toast('Export failed: ' + esc(e.message), 6000); console.error(e); }
  }
  async function copyImage() {
    const im = S.images[S.cur]; if (!im || im.status !== 'done') return;
    try {
      const c = await renderExport(im, await dispFor(im));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(c) })]);
      toast('Copied. Paste into PowerPoint with Cmd/Ctrl+V.');
    } catch (e) { toast('Copy failed (' + esc(e.message) + '). Use Export → PNG instead.', 6000); }
  }

  // ---------------- project save / load ----------------
  let pendingProject = null;
  function projectJSON() {
    const images = {};
    for (const im of S.images) if (im.status === 'done') images[im.path] = { cal: im.cal, center: im.center, centerMethod: im.centerMethod, centerConfidence: im.centerConfidence, preset: im.preset, legend: im.legend, features: im.features.map((f) => { const c = Object.assign({}, f); delete c._cands; return c; }) };
    return { app: 'diffraction-annotator', version: 1, saved: new Date().toISOString(), settings: { style: SET.style, labelStyles: SET.labelStyles, elements: SET.elements, customLists: SET.customLists, tol: SET.tol, preferred: SET.preferred }, images };
  }
  function restoreImage(saved) { return { cal: saved.cal, center: saved.center, centerMethod: saved.centerMethod, preset: saved.preset || 'auto', legend: saved.legend, features: saved.features || [], restored: true }; }
  $('inProject').addEventListener('change', async () => {
    const f = $('inProject').files[0]; if (!f) return;
    try {
      const pj = JSON.parse(await f.text());
      if (pj.settings) { Object.assign(SET, pj.settings); SET.style = Object.assign({}, DEFAULT_SETTINGS.style, pj.settings.style || {}); saveSettings(); }
      pendingProject = pj.images || {};
      let n = 0;
      for (const im of S.images) { const s = pendingProject[im.path]; if (s) { Object.assign(im, restoreImage(s)); recomputeD(im); im.restored = false; n++; } }
      toast(`Project loaded. ${n} open image(s) restored; others restore when their folder is opened.`);
      renderAll();
    } catch (e) { toast('Could not read project: ' + esc(e.message)); }
    $('inProject').value = '';
  });

  // ---------------- Materials Project (via local helper) ----------------
  async function checkMP() {
    if (!/^https?:$/.test(location.protocol)) { S.mpStatus = 'none'; return; }
    S.mpStatus = 'checking';
    try { const r = await fetch('mp/ping'); const j = await r.json(); S.mpStatus = j.ok ? 'ok' : 'none'; } catch (e) { S.mpStatus = 'none'; }
    if (tab === 'phases') renderPanel();
  }
  async function searchMP() {
    const els = SET.elements.slice(0, 8);
    const systems = [];
    for (let m = 1; m < (1 << els.length); m++) systems.push(els.filter((e, i) => m & (1 << i)).sort().join('-'));
    toast('Searching Materials Project…', 20000);
    try {
      const fields = 'material_id,formula_pretty,symmetry,energy_above_hull,theoretical,structure';
      const found = [];
      for (let i = 0; i < systems.length; i += 40) {
        const url = 'mp/materials/summary/?' + new URLSearchParams({ chemsys: systems.slice(i, i + 40).join(','), energy_above_hull_max: '0.1', _fields: fields, _limit: '1000' });
        const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
        found.push(...(await r.json()).data);
      }
      const libIds = new Set(library().map((p) => p.id));
      let added = 0;
      for (const d of found) {
        if (libIds.has(d.material_id) || S.mpPhases.some((p) => p.id === d.material_id)) continue;
        if (d.structure.sites.some((s) => s.species.length !== 1)) continue;
        const sites = d.structure.sites.map((s) => ({ el: s.species[0].element, f: s.abc.map((x) => x - Math.floor(x)) }));
        S.mpPhases.push({ id: d.material_id, name: d.formula_pretty, formula: d.formula_pretty, sg: d.symmetry.symbol, crystalSystem: (d.symmetry.crystal_system || '').toLowerCase(), ehull: d.energy_above_hull, theoretical: d.theoretical, els: Array.from(new Set(sites.map((s) => s.el))), lattice: d.structure.lattice.matrix, sites, source: 'MP live' });
        added++;
      }
      toast(`Materials Project: ${found.length} phases found, ${added} new (not in the built-in library).`);
      const im = S.images[S.cur]; if (im && SET.autoAssign) autoAssign(im); renderAll();
    } catch (e) { toast('Materials Project search failed: ' + esc(e.message), 8000); }
  }

  // ---------------- wiring ----------------
  $('btnOpenFolder').onclick = $('btnOpenFolder2').onclick = () => $('inFolder').click();
  $('btnOpenFiles').onclick = () => $('inFiles').click();
  $('inFolder').onchange = () => { addFiles(Array.from($('inFolder').files)); $('inFolder').value = ''; };
  $('inFiles').onchange = () => { addFiles(Array.from($('inFiles').files)); $('inFiles').value = ''; };
  $('files').addEventListener('click', (ev) => { const li = ev.target.closest('li'); if (li) select(S.images.findIndex((im) => im.id === +li.dataset.id)); });
  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; renderPanel(); }; });
  $('tools').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setTool(b.dataset.tool); });
  $('btnFit').onclick = fit;
  $('btnPolar').onclick = togglePolar;
  $('btnCenterMark').onclick = () => { SET.style.showCenter = !SET.style.showCenter; $('btnCenterMark').classList.toggle('on', SET.style.showCenter); saveSettings(); renderOverlay(); };
  $('btnCenterMark').classList.toggle('on', SET.style.showCenter);
  $('rngGamma').oninput = () => { S.gamma = parseFloat($('rngGamma').value); paintImage(); };
  $('rngMax').oninput = () => { S.white = parseFloat($('rngMax').value); paintImage(); };
  $('selPreset').onchange = () => { const im = S.images[S.cur]; if (!im) return; im.preset = $('selPreset').value; reanalyse(im, im.centerMethod === 'manual' ? im.center : null); };
  $('selExport').onchange = () => { const v = $('selExport').value; $('selExport').value = ''; if (v) doExport(v); };
  $('btnCopy').onclick = copyImage;
  $('btnHelp').onclick = help;
  stage.addEventListener('dragover', (ev) => { ev.preventDefault(); stage.classList.add('drag'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
  stage.addEventListener('drop', async (ev) => { ev.preventDefault(); stage.classList.remove('drag'); const files = await entriesToFiles(Array.from(ev.dataTransfer.items)); addFiles(files.length ? files : Array.from(ev.dataTransfer.files)); });
  document.body.addEventListener('dragover', (ev) => ev.preventDefault());
  document.body.addEventListener('drop', (ev) => ev.preventDefault());
  window.addEventListener('resize', () => { if (S.polar) renderPolar(); });
  setTool('select'); renderPanel(); checkMP();
  window.DPA = { S, SET, select, runMatch, autoAssign, buildOverlay, legendEntries, addFiles, doExport, renderExport, dispFor }; // debugging hook
})();
