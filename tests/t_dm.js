const DP = require('./load.js'); const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f);
  try {
    const im = DP.readDM(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    let s = 0, mx = -1e30; for (let i = 0; i < im.gray.length; i++) { s += im.gray[i]; if (im.gray[i] > mx) mx = im.gray[i]; }
    console.log(f.split('/').pop(), im.width, im.height, (s / im.gray.length).toFixed(2), mx, JSON.stringify(im.calibration), JSON.stringify(im.meta));
  } catch (e) { console.log(f, 'ERR', e.message); }
}
