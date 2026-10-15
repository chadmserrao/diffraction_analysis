// Crystallography: conventional cells, reflections (kinematic electron intensities), phase matching.
(function (DP) {
  'use strict';
  const EL = ['X', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr'];
  const Z = {}; EL.forEach((e, i) => { Z[e] = i; });

  // ---- small linear algebra ----
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  function inv3(m) {
    const d = det3(m);
    return [
      [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / d, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / d, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / d],
      [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / d, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / d, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / d],
      [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / d, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / d, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / d]];
  }
  const mul3 = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
  const vmul = (v, m) => [0, 1, 2].map((j) => v[0] * m[0][j] + v[1] * m[1][j] + v[2] * m[2][j]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => Math.sqrt(dot(a, a));
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };

  function latticeFromParams(a, b, c, al, be, ga) {
    const r = Math.PI / 180, ca = Math.cos(al * r), cb = Math.cos(be * r), cg = Math.cos(ga * r), sg = Math.sin(ga * r);
    const cx = cb, cy = (ca - cb * cg) / sg, cz = Math.sqrt(Math.max(0, 1 - cx * cx - cy * cy));
    return [[a, 0, 0], [b * cg, b * sg, 0], [c * cx, c * cy, c * cz]];
  }
  function params(L) {
    const [a, b, c] = L.map(norm), ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (norm(u) * norm(v))))) * 180 / Math.PI;
    return { a, b, c, alpha: ang(L[1], L[2]), beta: ang(L[0], L[2]), gamma: ang(L[0], L[1]) };
  }

  // ---- conventional cell search ----
  // structure: {lattice: 3x3 rows (A), sites: [{el, f:[x,y,z]}], crystalSystem}
  function conventionalize(st) {
    const L = st.lattice, sys = (st.crystalSystem || '').toLowerCase();
    if (st.conventional || !['cubic', 'tetragonal', 'orthorhombic', 'hexagonal', 'trigonal'].includes(sys)) return reduceOnly(st);
    const vecs = [];
    const R = 2;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
      if (!i && !j && !k) continue;
      const v = vmul([i, j, k], L); vecs.push({ n: [i, j, k], v, len: norm(v) });
    }
    vecs.sort((p, q) => p.len - q.len);
    const maxLen = 2.2 * Math.max(...L.map(norm));
    const V = vecs.filter((p) => p.len < maxLen);
    const perp = (p, q) => Math.abs(dot(p.v, q.v)) / (p.len * q.len) < 0.035;
    const eq = (x, y) => Math.abs(x - y) / Math.max(x, y) < 0.02;
    const vol0 = Math.abs(det3(L));
    let best = null;
    const tryM = (a, b, c) => {
      const M = [a.n, b.n, c.n], d = det3(M);
      if (d <= 0) return;
      const allowed = sys === 'cubic' ? [1, 2, 4] : sys === 'tetragonal' ? [1, 2] : sys === 'orthorhombic' ? [1, 2, 4] : [1, 3];
      if (!allowed.includes(Math.round(d)) || Math.abs(d - Math.round(d)) > 1e-6) return;
      const vol = vol0 * d;
      if (!best || vol < best.vol - 1e-6) best = { M, vol };
    };
    for (let x = 0; x < V.length; x++) for (let y = 0; y < V.length; y++) {
      if (x === y) continue;
      const A = V[x], B = V[y];
      if (sys === 'hexagonal' || sys === 'trigonal') {
        if (!eq(A.len, B.len)) continue;
        const cg = dot(A.v, B.v) / (A.len * B.len);
        if (Math.abs(cg + 0.5) > 0.03) continue;
      } else {
        if (!perp(A, B)) continue;
        if ((sys === 'cubic' || sys === 'tetragonal') && !eq(A.len, B.len)) continue;
      }
      for (let z = 0; z < V.length; z++) {
        if (z === x || z === y) continue;
        const C = V[z];
        if (!perp(A, C) || !perp(B, C)) continue;
        if (sys === 'cubic' && !eq(A.len, C.len)) continue;
        tryM(A, B, C);
      }
      if (best && V[x].len > best.vol) break;
    }
    if (!best) return reduceOnly(st);
    let M = best.M;
    if (sys === 'orthorhombic') { // order a <= b <= c
      const rows = M.map((n) => ({ n, len: norm(vmul(n, L)) })).sort((p, q) => p.len - q.len);
      M = rows.map((r) => r.n); if (det3(M) < 0) M = [M[1], M[0], M[2]];
    }
    return transform(st, M, true);
  }
  function reduceOnly(st) {
    const sys = (st.crystalSystem || '').toLowerCase();
    const failed = ['cubic', 'tetragonal', 'orthorhombic', 'hexagonal', 'trigonal'].includes(sys) && !st.conventional;
    return Object.assign({}, st, { conventional: !!st.conventional, indexNote: failed ? 'indices refer to the primitive cell' : '' });
  }

  function transform(st, M, conv) {
    const L = st.lattice, Lc = mul3(M, L), Lci = inv3(Lc);
    const d = Math.round(Math.abs(det3(M)));
    const sites = [];
    const R = Math.max(2, d);
    for (const s of st.sites) {
      const cart0 = vmul(s.f, L);
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
        const cart = [0, 1, 2].map((q) => cart0[q] + i * L[0][q] + j * L[1][q] + k * L[2][q]);
        const f = vmul(cart, Lci).map((x) => { let y = x - Math.floor(x + 1e-6); return Math.abs(y - 1) < 1e-6 ? 0 : y; });
        if (f.some((x) => x < -1e-6 || x >= 1 - 1e-6)) continue;
        if (sites.some((t) => t.el === s.el && t.f.every((x, q) => { const dd = Math.abs(x - f[q]); return dd < 1e-4 || Math.abs(dd - 1) < 1e-4; }))) continue;
        sites.push({ el: s.el, f, occ: s.occ });
      }
    }
    return Object.assign({}, st, { lattice: Lc, sites, conventional: conv, indexNote: '' });
  }

  // ---- scattering ----
  function fe(el, s2) { // screened-Coulomb (Wentzel) electron form factor, s2 = (1/d)^2 in 1/A^2
    const z = Z[el] || 6;
    const a = 0.8853 * 0.529 * Math.pow(z, -1 / 3);
    const k2 = 4 * Math.PI * Math.PI * s2;
    return z / (k2 + 1 / (a * a));
  }

  // ---- reflections ----
  function reflections(stIn, dMinNm, opts) {
    opts = opts || {};
    const st = stIn.lattice ? stIn : null; if (!st) return [];
    const L = st.lattice, G = mul3(L, L.map((r) => r).map((r, i) => r)); // placeholder
    const Gm = [[dot(L[0], L[0]), dot(L[0], L[1]), dot(L[0], L[2])], [dot(L[1], L[0]), dot(L[1], L[1]), dot(L[1], L[2])], [dot(L[2], L[0]), dot(L[2], L[1]), dot(L[2], L[2])]];
    const Gs = inv3(Gm); // reciprocal metric (1/A^2)
    const dMin = dMinNm * 10; // A
    const gmax2 = 1 / (dMin * dMin);
    const par = params(L);
    const hmax = Math.ceil(par.a / dMin) + 1, kmax = Math.ceil(par.b / dMin) + 1, lmax = Math.ceil(par.c / dMin) + 1;
    const all = [];
    const B = 0.5;
    for (let h = -hmax; h <= hmax; h++) for (let k = -kmax; k <= kmax; k++) for (let l = -lmax; l <= lmax; l++) {
      if (!h && !k && !l) continue;
      const hv = [h, k, l];
      const g2 = dot(vmul(hv, Gs), hv);
      if (g2 > gmax2) continue;
      let re = 0, im = 0;
      for (const s of st.sites) {
        const ph = 2 * Math.PI * (h * s.f[0] + k * s.f[1] + l * s.f[2]);
        const fv = fe(s.el, g2) * (s.occ == null ? 1 : s.occ);
        re += fv * Math.cos(ph); im += fv * Math.sin(ph);
      }
      const I = (re * re + im * im) * Math.exp(-B * g2 / 2);
      all.push({ hkl: hv, g2, I });
    }
    let Imax = 0; for (const r of all) Imax = Math.max(Imax, r.I);
    const kept = all.filter((r) => r.I > 1e-5 * Imax);
    // group into families by d and intensity
    kept.sort((p, q) => p.g2 - q.g2 || q.I - p.I);
    const fams = [];
    for (const r of kept) {
      const d = 1 / Math.sqrt(r.g2);
      let fam = null;
      for (let i = fams.length - 1; i >= 0 && Math.abs(fams[i].dA - d) < 1.5e-3 * d + 1e-6; i--) {
        if (Math.abs(fams[i].I1 - r.I) <= 0.03 * Math.max(fams[i].I1, r.I)) { fam = fams[i]; break; }
      }
      if (!fam) { fam = { dA: d, I1: r.I, members: [] }; fams.push(fam); }
      fam.members.push(r.hkl);
    }
    let IrMax = 0;
    for (const f of fams) { f.Iring = f.I1 * f.members.length; IrMax = Math.max(IrMax, f.Iring); }
    const hex = ['hexagonal', 'trigonal'].includes((st.crystalSystem || '').toLowerCase()) && st.conventional;
    const out = fams.map((f) => {
      const rep = pickRep(f.members);
      return {
        d: f.dA / 10, hkl: rep, members: f.members, mult: f.members.length,
        I: f.Iring / IrMax, Ispot: f.I1 / Math.max(...fams.map((q) => q.I1)),
        label: '{' + fmtHKL(rep, hex && opts.fourIndex) + '}',
      };
    }).filter((r) => r.I > (opts.minI || 0.002));
    out.sort((p, q) => q.d - p.d);
    out.Gs = Gs;
    return out;
  }
  function pickRep(ms) {
    let best = null, bs = -Infinity;
    for (const m of ms) {
      const nonneg = m.filter((x) => x >= 0).length;
      const sorted = m[0] >= m[1] && m[1] >= m[2] ? 1 : 0;
      const sc = nonneg * 10 + sorted * 5 - m.filter((x) => x < 0).length + (m[0] >= 0 ? 1 : 0) + m[0] * 0.01 + m[1] * 0.001;
      if (sc > bs) { bs = sc; best = m; }
    }
    return best;
  }
  function fmtHKL(m, four) {
    const f = (x) => (x < 0 ? '̅' + Math.abs(x) : String(x)).replace(/^̅(\d)/, '$1̅');
    const parts = four ? [m[0], m[1], -(m[0] + m[1]), m[2]] : m;
    const big = parts.some((x) => Math.abs(x) > 9);
    return parts.map(f).join(big ? ' ' : '');
  }
  function angleBetween(Gs, a, b) {
    const ga = vmul(a, Gs), c = dot(ga, b) / Math.sqrt(dot(ga, a) * dot(vmul(b, Gs), b));
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  function zoneAxis(a, b) {
    let u = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const g = gcd(gcd(u[0], u[1]), u[2]) || 1; u = u.map((x) => x / g);
    if (u[0] < 0 || (u[0] === 0 && (u[1] < 0 || (u[1] === 0 && u[2] < 0)))) u = u.map((x) => -x);
    return u;
  }

  // ---- phase preparation ----
  const cache = new Map();
  function preparePhase(ph, dMinNm, full) {
    if (ph.reflPre && !full) return Object.assign({}, ph, { refl: ph.reflPre.filter((r) => r.d >= dMinNm) });
    const key = (ph.id || ph.name) + '|' + dMinNm + '|' + (full ? 1 : 0);
    if (cache.has(key)) return cache.get(key);
    let out;
    if (ph.dlist) {
      out = Object.assign({}, ph, { refl: ph.dlist.map((r) => ({ d: r.d, label: r.label || '', I: r.I == null ? 1 : r.I, mult: 1, members: [] })).filter((r) => r.d >= dMinNm) });
    } else {
      const st = conventionalize(ph);
      const refl = reflections(st, dMinNm);
      out = Object.assign({}, ph, { conv: st, refl, Gs: refl.Gs, indexNote: st.indexNote });
    }
    if (cache.size > 400) cache.clear();
    cache.set(key, out);
    return out;
  }

  // ---- matching ----
  // features: [{id, kind, d (nm), dErr (relative)}]; returns ranked phases with per-feature assignments
  function matchPhases(features, phases, opts) {
    opts = Object.assign({ tol: 0.03, minI: 0.01 }, opts || {});
    const feats = features.filter((f) => f.d > 0);
    if (!feats.length) return [];
    const dMin = Math.min(...feats.map((f) => f.d)) * 0.9;
    const dMax = Math.max(...feats.map((f) => f.d)) * 1.1;
    const crystFeats = feats.filter((f) => f.kind !== 'halo');
    const ringFeats = feats.filter((f) => f.kind === 'ring' || f.kind === 'spotty');
    const results = [];
    for (const raw of phases) {
      const ph = preparePhase(raw, Math.max(0.05, dMin * 0.95));
      const amorph = !!(ph.dlist || ph.amorphousOK);
      const refl = ph.refl.filter((r) => r.I >= opts.minI || ph.dlist);
      if (!refl.length) continue;
      const use = amorph ? feats : crystFeats;
      if (!use.length) continue;
      // pass 1: raw matches within tolerance
      const match = (f, scale, tolF) => {
        const sig = Math.max(tolF, f.dErr || 0);
        let best = null, nWin = 0;
        for (const r of refl) {
          const e = (f.d - scale * r.d) / (scale * r.d);
          if (Math.abs(e) > 2 * sig) continue;
          const Iw = f.kind === 'pair' || f.kind === 'spot' ? (r.Ispot != null ? r.Ispot : r.I) : r.I;
          if (Iw >= 0.05 || ph.dlist) nWin++;
          const w = Math.exp(-e * e / (2 * sig * sig)) * (0.5 + 0.5 * Math.sqrt(Math.min(1, Iw)));
          if (!best || w > best.w) best = { w, e, r };
        }
        return best ? Object.assign(best, { nWin: Math.max(1, nWin) }) : null;
      };
      let scale = 1;
      let m1 = use.map((f) => ({ f, m: match(f, 1, opts.tol) })).filter((x) => x.m);
      if (!m1.length) continue;
      // pass 2: with >=3 matched lines, absorb a common scale error (calibration / DFT lattice) and judge ratios
      if (m1.length >= 3 && !ph.dlist) {
        const ratios = m1.map((x) => x.f.d / x.m.r.d).sort((p, q) => p - q);
        scale = Math.min(1 + opts.tol, Math.max(1 - opts.tol, ratios[ratios.length >> 1]));
        const tight = Math.max(0.01, opts.tol / 2.5);
        const m2 = use.map((f) => ({ f, m: match(f, scale, tight) })).filter((x) => x.m);
        if (m2.length >= m1.length - 1) m1 = m2;
        else scale = 1;
      }
      const assign = {};
      let sc = 0; const errs = [];
      for (const { f, m } of m1) {
        sc += m.w / (1 + 0.5 * (m.nWin - 1)); // several candidate lines in the window = weaker evidence
        errs.push(Math.abs((f.d - m.r.d) / m.r.d));
        assign[f.id] = { label: m.r.label, dRef: m.r.d, err: (f.d - m.r.d) / m.r.d, I: m.r.I, members: m.r.members };
      }
      let score = sc / use.length;
      // rings: all strong lines in the observed range should be present, and dense line lists are suspicious
      let missing = 0;
      if (ringFeats.length >= 2 && !ph.dlist) {
        let nPred = 0;
        for (const r of refl) {
          if (r.d * scale < dMin || r.d * scale > dMax) continue;
          if (r.I >= 0.1) nPred++;
          if (r.I > 0.3 && !feats.some((f) => Math.abs(f.d - r.d * scale) / (r.d * scale) < 2 * opts.tol)) missing++;
        }
        score *= Math.sqrt(Math.min(1, (ringFeats.length + 1) / (nPred + 1)));
        score -= 0.08 * Math.min(missing, 4);
      }
      // mild priors: experimentally observed and stable phases first
      if (!ph.dlist) score *= (ph.theoretical ? 0.9 : 1) * Math.exp(-(ph.ehull || 0) / 0.15);
      if (raw.preferred) score *= 1.3;
      const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length;
      results.push({ phase: ph, score, nMatched: m1.length, nFeatures: use.length, meanErr, missing, assign, zone: null, scale });
    }
    results.sort((a, b) => b.score - a.score || a.meanErr - b.meanErr);
    // zone-axis check (angle between two spot pairs) only for the best candidates: it needs full reflection lists
    const pairsAll = feats.filter((f) => f.kind === 'pair' && f.vec);
    if (pairsAll.length >= 2) {
      for (const res of results.slice(0, opts.zoneTop || 25)) {
        const raw = phases.find((p) => p.id === res.phase.id) || res.phase;
        const zr = zoneCheck(res, raw, pairsAll, dMin);
        if (zr) { res.zone = zr.zone; res.score += zr.delta / res.nFeatures; }
      }
      results.sort((a, b) => b.score - a.score || a.meanErr - b.meanErr);
    }
    return results;
  }

  function zoneCheck(res, raw, pairsAll, dMin) {
    const assign = res.assign;
    const pairs = pairsAll.filter((f) => assign[f.id]);
    if (pairs.length < 2 || !raw.sites) return null;
    const fullPh = preparePhase(raw, Math.max(0.05, dMin * 0.95), true);
    const members = (a) => { const m = fullPh.refl.reduce((b, r) => (Math.abs(r.d - a.dRef) < Math.abs(b.d - a.dRef) ? r : b), fullPh.refl[0]); return m ? m.members : []; };
    const [p1, p2] = pairs;
    const meas = Math.acos(Math.max(-1, Math.min(1, (p1.vec[0] * p2.vec[0] + p1.vec[1] * p2.vec[1]) / (Math.hypot(...p1.vec) * Math.hypot(...p2.vec))))) * 180 / Math.PI;
    const measA = Math.min(meas, 180 - meas);
    let bestZ = null;
    for (const a of members(assign[p1.id]).slice(0, 48)) for (const b of members(assign[p2.id]).slice(0, 48)) {
      const ang = angleBetween(fullPh.Gs, a, b), angA = Math.min(ang, 180 - ang);
      const err = Math.abs(angA - measA);
      if (err < 3 && (!bestZ || err < bestZ.err)) { const z = zoneAxis(a, b); if (z.some((x) => x)) bestZ = { err, uvw: z, a, b, meas: measA }; }
    }
    return bestZ ? { zone: bestZ, delta: 0.5 } : { zone: null, delta: -0.3 };
  }

  // per-feature candidate list across phases
  function candidatesFor(d, phases, opts) {
    opts = Object.assign({ tol: 0.03, minI: 0.01, max: 8 }, opts || {});
    const out = [];
    for (const raw of phases) {
      const ph = preparePhase(raw, Math.max(0.05, d * 0.8));
      for (const r of ph.refl) {
        if (r.I < opts.minI && !ph.dlist) continue;
        const e = (d - r.d) / r.d;
        if (Math.abs(e) <= 2 * opts.tol) out.push({ phase: ph, label: r.label, dRef: r.d, err: e, I: r.I });
      }
    }
    out.sort((a, b) => Math.abs(a.err) - Math.abs(b.err));
    return out.slice(0, opts.max);
  }

  DP.crystal = { EL, Z, latticeFromParams, params, conventionalize, reflections, preparePhase, matchPhases, candidatesFor, angleBetween, zoneAxis, fmtHKL };
})(typeof globalThis !== 'undefined' ? (globalThis.DP = globalThis.DP || {}) : {});
