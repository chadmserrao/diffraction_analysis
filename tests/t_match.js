const DP = require('./load.js'); const fs = require('fs'); const path = require('path');
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'src', 'library_refl.js'), 'utf8'));
const CSN = ['triclinic', 'monoclinic', 'orthorhombic', 'tetragonal', 'trigonal', 'hexagonal', 'cubic'];
const lib = DP.LIBRARY_ROWS.map(([id, formula, sg, cs, eh, theo, lat, sf]) => { const pre = DP.LIBRARY_REFL[id]; const sites = []; for (let i = 0; i < sf.length; i += 4) sites.push({ el: sf[i], f: sf.slice(i + 1, i + 4) });
  return { id, name: formula, sg, crystalSystem: CSN[cs], theoretical: !!theo, ehull: eh, els: [...new Set(sites.map((s) => s.el))], lattice: [lat.slice(0, 3), lat.slice(3, 6), lat.slice(6, 9)], sites, reflPre: pre.r.map(([d, I, h, k, l, m]) => ({ d, I, hkl: [h, k, l], mult: m, label: '{' + DP.crystal.fmtHKL([h, k, l]) + '}' })) }; });
function run(title, feats, els) {
  const pool = els ? lib.filter((p) => p.els.every((e) => els.includes(e))) : lib;
  const t0 = Date.now(); const r = DP.crystal.matchPhases(feats, pool, { tol: 0.03 }); const dt = Date.now() - t0;
  console.log('==', title, els ? els.join(',') : 'ALL', pool.length, 'phases', dt + 'ms');
  r.slice(0, 5).forEach((x) => console.log('  ', x.phase.name, x.phase.sg, x.nMatched + '/' + x.nFeatures, 'err', (x.meanErr * 100).toFixed(1) + '%', 'score', x.score.toFixed(3), x.zone ? 'zone [' + x.zone.uvw + ']' : '', Object.values(x.assign).map((a) => a.label).join(' ')));
  const au = r.findIndex((x) => x.phase.name === 'Au'); if (title.startsWith('Au')) console.log('   Au rank', au);
}
const auF = [0.2050, 0.1433, 0.1224, 0.1167, 0.1012, 0.0909, 0.0820, 0.0776].map((d, i) => ({ id: 'a' + i, kind: 'spotty', d }));
run('Au standard (spotty rings)', auF, null);
run('Au standard (spotty rings)', auF, ['Au', 'Ag', 'Cu', 'Al']);
// Na single spot pair (user slides: Na {200} 0.213) + carbon halos
const naF = [{ id: 'h1', kind: 'halo', d: 0.207, dErr: 0.1 }, { id: 'h2', kind: 'halo', d: 0.120, dErr: 0.1 }, { id: 'p1', kind: 'pair', d: 0.214, vec: [100, 0] }];
run('Na pair + C halos', naF, ['Na', 'C', 'O', 'F', 'P', 'H']);
// Na [100] zone: 110 (0.301) and 200 (0.212) spots at 45 deg
const z = [{ id: 'p1', kind: 'pair', d: 0.2104, vec: [300, 0] }, { id: 'p2', kind: 'pair', d: 0.2976, vec: [150, 150] }];
run('Na [001] zone: {200} + {110} at 45deg', z, ['Na', 'O', 'C', 'F']);
