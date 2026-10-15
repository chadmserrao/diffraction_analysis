const DP = require('./load.js'); const fs = require('fs');
(async () => {
  for (const f of process.argv.slice(2)) {
    const b = fs.readFileSync(f); const t0 = Date.now();
    const im = await DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    let s = 0; for (let i = 0; i < im.gray.length; i++) s += im.gray[i];
    console.log(im.width, im.height, (s / im.gray.length).toFixed(3), im.gray[1000 * im.width + 1234].toFixed(2), Date.now() - t0, 'ms');
  }
})();
