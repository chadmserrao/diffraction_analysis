// The contract between the analysis modules and the UI (ARCHITECTURE.md, "Contract").
// app.js only reads what is listed there, so this test pins every field it relies on:
// the shape, the type, and that coordinates are original-image pixels inside the image.
// Run from the project root:  node tests/check_contract.js   (part of make test)
const DP = require('./load.js'); const fs = require('fs');
const FILE = 'samples/250203_HC_cryo_0.05V_newEL_0003.tif'; // the Au standard: rings and spots
const KINDS = ['halo', 'ring', 'spotty', 'pair', 'spot'];

let fail = 0;
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };
const num = (v) => typeof v === 'number' && Number.isFinite(v);

(async () => {
  if (!fs.existsSync(FILE)) { console.log('NOTHING TESTED: missing', FILE, '(run from the project root)'); process.exit(1); }
  const b = fs.readFileSync(FILE);
  const im = await DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const W = im.width, H = im.height, inside = (p) => num(p.x) && num(p.y) && p.x >= 0 && p.y >= 0 && p.x < W && p.y < H;

  // readTIFF / readDM -> {width, height, gray, bits}
  check(Number.isInteger(W) && Number.isInteger(H) && W > 0 && H > 0, `reader: width and height are positive integers (${W} x ${H})`);
  check(im.gray instanceof Float32Array && im.gray.length === W * H, 'reader: gray is a Float32Array of width x height');

  // detectScaleBar -> null, or {lengthPx, value, unit, ...}
  const sb = DP.detectScaleBar(im.gray, W, H);
  check(sb === null || (num(sb.lengthPx) && sb.lengthPx > 0), 'scale bar: null, or a bar with a positive length in px');
  check(!sb || sb.value === null || (num(sb.value) && sb.value > 0 && typeof sb.unit === 'string'), 'scale bar: a read label has a positive value and a unit');

  // analyze -> {center, features[], profile}
  const a = DP.analyze(im.gray, W, H, { scaleBar: sb });
  check(a.center && inside(a.center), `analysis: centre (${a.center.x.toFixed(1)}, ${a.center.y.toFixed(1)}) is inside the image`);
  check(Array.isArray(a.features) && a.features.length > 0, `analysis: features is a non-empty list (${a.features.length})`);
  const bad = a.features.filter((f) => !(
    /^f\d+$/.test(f.id) && KINDS.includes(f.kind) && num(f.r) && f.r > 0 && f.r < Math.hypot(W, H) &&
    Array.isArray(f.points) && f.points.every(inside)));
  check(bad.length === 0, `analysis: every feature has an id, a known kind, a radius in px and points inside the image${bad.length ? ' (bad: ' + bad.map((f) => f.id).join(' ') + ')' : ''}`);
  check(a.features.every((f, i) => i === 0 || f.r >= a.features[i - 1].r), 'analysis: features are sorted by radius, as the feature panel expects');
  // A spot pair's radius is half the spot-to-spot distance (d = 1/g uses g for one spot, not the pair).
  const pairs = a.features.filter((f) => f.kind === 'pair' && f.points.length === 2);
  const pairErr = Math.max(0, ...pairs.map((f) => Math.abs(f.r - Math.hypot(f.points[0].x - f.points[1].x, f.points[0].y - f.points[1].y) / 2)));
  check(pairs.length === 0 || pairErr < 0.5, `analysis: each spot pair's radius is half its spot-to-spot distance (${pairs.length} pairs, worst ${pairErr.toFixed(2)} px)`);
  check(Array.isArray(a.profile) && a.profile.every((row) => row.length === 4 && row.every(num)), 'analysis: profile rows are [r, median, background, residual]');

  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
