// Node helper: load browser modules into globalThis.DP
const fs = require('fs'), path = require('path');
globalThis.DP = globalThis.DP || {};
for (const f of ['tiff.js', 'dm.js', 'imageproc.js', 'ocr_templates.js', 'crystal.js', 'library_data.js']) {
  const p = path.join(__dirname, '..', 'src', f);
  if (fs.existsSync(p)) (0, eval)(fs.readFileSync(p, 'utf8'));
}
module.exports = globalThis.DP;
