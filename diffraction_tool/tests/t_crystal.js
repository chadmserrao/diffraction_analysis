const DP = require('./load.js'); const fs = require('fs'); const C = DP.crystal;
const mp = JSON.parse(fs.readFileSync(process.argv[2])).data;
for (const x of mp.slice(0, 20)) {
  const st = { id: x.material_id, name: x.formula_pretty, crystalSystem: x.symmetry.crystal_system, lattice: x.structure.lattice.matrix, sites: x.structure.sites.map((s) => ({ el: s.species[0].element, f: s.abc })) };
  const cv = C.conventionalize(st), p = C.params(cv.lattice);
  const r = C.reflections(cv, 0.1).slice(0, 5).map((q) => q.label + ' ' + q.d.toFixed(4) + ' I' + q.I.toFixed(2));
  console.log(x.formula_pretty.padEnd(6), x.symmetry.symbol.padEnd(8), 'n', st.sites.length, '->', cv.sites.length, 'a,b,c', [p.a, p.b, p.c].map((v) => v.toFixed(3)).join(','), [p.alpha, p.beta, p.gamma].map((v) => v.toFixed(1)).join(','), cv.indexNote || '', '|', r.join(' | '));
}
