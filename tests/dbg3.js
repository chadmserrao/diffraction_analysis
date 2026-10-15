const DP = require('./load.js'); const fs = require('fs');
(async () => { for (const f of fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)) {
  const b = fs.readFileSync(f); const im = await DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  DP.OCR_DEBUG = 1; const sb = DP.detectScaleBar(im.gray, im.width, im.height); console.log(f.split('/').pop(), JSON.stringify(sb)); } })();
