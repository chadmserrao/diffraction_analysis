// Time what the worker runs on each sample pattern, stage by stage, as the median of
// RUNS runs with the spread (min to max). Run from the project root (make bench):
//   node tools/bench.js                     time every pattern in samples/
//   node tools/bench.js --save key.json     also save every result (the answer key)
//   node tools/bench.js --check key.json    also check every result is identical to the key
// The answer key holds the full output of each stage, so a speed-up that changes any
// number (centre, feature, profile, scale bar) fails --check.
const DP = require('../tests/load.js'); const fs = require('fs'); const path = require('path');
const RUNS = Number(process.env.RUNS || 3);
const args = process.argv.slice(2);
const save = args[args.indexOf('--save') + 1], check = args[args.indexOf('--check') + 1];
const doSave = args.includes('--save'), doCheck = args.includes('--check');
const files = fs.readdirSync('samples').filter((f) => /\.tiff?$/i.test(f)).sort().map((f) => path.join('samples', f));

const now = () => Number(process.hrtime.bigint()) / 1e6; // ms
const stat = (xs) => { const s = [...xs].sort((a, b) => a - b); return { median: s[(s.length - 1) >> 1], min: s[0], max: s[s.length - 1] }; };
const fmt = (st) => `${(st.median / 1000).toFixed(3)} s (${(st.min / 1000).toFixed(3)} to ${(st.max / 1000).toFixed(3)})`;

(async () => {
  const results = {}, rows = [];
  const total = { read: [], scaleBar: [], analyze: [], all: [] };
  for (let run = 0; run < RUNS; run++) {
    let sum = { read: 0, scaleBar: 0, analyze: 0 };
    for (const f of files) {
      const b = fs.readFileSync(f), buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
      let t = now(); const im = await DP.readTIFF(buf); const tRead = now() - t;
      t = now(); const sb = DP.detectScaleBar(im.gray, im.width, im.height); const tSb = now() - t;
      t = now(); const an = DP.analyze(im.gray, im.width, im.height, { scaleBar: sb }); const tAn = now() - t;
      sum.read += tRead; sum.scaleBar += tSb; sum.analyze += tAn;
      (rows[files.indexOf(f)] = rows[files.indexOf(f)] || { file: path.basename(f), size: `${im.width} x ${im.height}`, read: [], scaleBar: [], analyze: [] });
      rows[files.indexOf(f)].read.push(tRead); rows[files.indexOf(f)].scaleBar.push(tSb); rows[files.indexOf(f)].analyze.push(tAn);
      if (run === 0) results[path.basename(f)] = { width: im.width, height: im.height, sb, center: an.center, features: an.features, profile: an.profile };
    }
    total.read.push(sum.read); total.scaleBar.push(sum.scaleBar); total.analyze.push(sum.analyze);
    total.all.push(sum.read + sum.scaleBar + sum.analyze);
  }
  console.log(`${files.length} patterns, median of ${RUNS} runs (min to max)\n`);
  for (const r of rows) console.log(`${r.file} (${r.size}): read ${fmt(stat(r.read))}, scale bar ${fmt(stat(r.scaleBar))}, analyze ${fmt(stat(r.analyze))}`);
  const all = stat(total.all).median;
  console.log('\nAll patterns:');
  for (const k of ['read', 'scaleBar', 'analyze']) console.log(`  ${k.padEnd(9)} ${fmt(stat(total[k]))}  ${(100 * stat(total[k]).median / all).toFixed(0)}%`);
  console.log(`  ${'total'.padEnd(9)} ${fmt(stat(total.all))}`);

  const key = JSON.stringify(results);
  if (doSave) { fs.writeFileSync(save, key); console.log('\nSaved the answer key to', save); }
  if (doCheck) {
    const want = JSON.parse(fs.readFileSync(check, 'utf8')), got = JSON.parse(key);
    const diff = Object.keys(want).filter((f) => JSON.stringify(want[f]) !== JSON.stringify(got[f]));
    console.log(diff.length ? `\nFAIL: results differ from ${check} for ${diff.join(', ')}` : `\nPASS: every result is identical to ${check}`);
    process.exit(diff.length ? 1 : 0);
  }
})();
