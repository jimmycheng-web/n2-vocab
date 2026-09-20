// 產生 GitHub Pages 用的靜態版本到 docs/（純瀏覽器執行，不需要 Node 伺服器）
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'public');
const out = path.join(__dirname, '..', 'docs');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) {
  let content = fs.readFileSync(path.join(src, f));
  if (f === 'index.html') {
    const v = Date.now().toString(36); // 版本號：避免瀏覽器快取舊檔
    content = content
      .toString()
      .replace('<script src="backend.js"></script>', '<script>window.N2_STATIC = true;</script>\n  <script src="backend.js?v=' + v + '"></script>')
      .replace('<script src="app.js"></script>', '<script src="app.js?v=' + v + '"></script>')
      .replace('href="style.css"', 'href="style.css?v=' + v + '"');
  }
  fs.writeFileSync(path.join(out, f), content);
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('已產生 docs/（GitHub Pages 靜態版）');
