const DP = require('./load.js'); const fs = require('fs');
(async () => {
  const files = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean); const out = [];
  for (const f of files) { const b = fs.readFileSync(f); const im = await DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    const sb = DP.detectScaleBar(im.gray, im.width, im.height); out.push({ file: f, sb }); }
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
})();
