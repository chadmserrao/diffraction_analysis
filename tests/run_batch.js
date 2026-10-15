// usage: node run_batch.js list.txt out.json [preset]
const DP = require('./load.js'); const fs = require('fs');
(async () => {
  const files = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const f of files) {
    const b = fs.readFileSync(f); const t0 = Date.now();
    try {
      const im = await DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
      const t1 = Date.now();
      const sb = DP.detectScaleBar(im.gray, im.width, im.height);
      const t2 = Date.now();
      const an = DP.analyze(im.gray, im.width, im.height, { scaleBar: sb, preset: process.argv[4] || 'auto' });
      const cal = sb && sb.value ? sb.value / sb.lengthPx : null;
      out.push({ file: f, W: im.width, H: im.height, sb, cal, center: an.center, centerMethod: an.centerMethod, centerConfidence: an.centerConfidence, centerQuality: an.centerQuality, stopperTip: an.stopperTip, stopperAngle: an.stopperAngle, rMin: an.rMin, rMax: an.rMax,
        features: an.features, profile: process.env.NOPROF ? null : an.profile, t: { decode: t1 - t0, bar: t2 - t1, analyze: an.ms } });
      const fs2 = an.features.map((x) => x.kind[0] + ':' + (cal ? (1 / (x.r * cal)).toFixed(3) : x.r.toFixed(0))).join(' ');
      console.log(f.split('/').pop(), 'bar', sb ? sb.lengthPx + ' "' + sb.text + ' ' + sb.unit + '" c=' + sb.confidence.toFixed(2) : 'none', 'ctr', an.center.x.toFixed(1), an.center.y.toFixed(1), (t1 - t0) + '/' + (t2 - t1) + '/' + an.ms + 'ms', fs2);
    } catch (e) { console.log(f, 'ERR', e.stack); }
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
})();
