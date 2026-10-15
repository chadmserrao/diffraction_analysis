const DP = require('./load.js'); const fs = require('fs'); DP.DEBUG = 1;
(async () => { for (const f of fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)) {
  const b = fs.readFileSync(f); const im = await DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const sb = DP.detectScaleBar(im.gray, im.width, im.height);
  const an = DP.analyze(im.gray, im.width, im.height, { scaleBar: sb }); console.log(f.split('/').pop(), 'tip', JSON.stringify(an.stopperTip), 'ctr', an.center.x.toFixed(0), an.center.y.toFixed(0), 'ms', an.ms); } })();
