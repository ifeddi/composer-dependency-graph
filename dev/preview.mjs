// Dev helper: builds a standalone HTML preview of the graph UI from a real Composer project,
// without starting an IDE.   node dev/preview.mjs <composer-project-dir> [dark|light]
// Open the generated dev/preview.html in any browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '..', 'src', 'main', 'resources', 'web');
const dir = path.resolve(process.argv[2] || '.');
const theme = process.argv[3] || 'dark';
const select = process.argv[4] || '';   // optional: package to select after load (used for screenshots)
// argv[6]: "up" | "down" | "both" = focus mode, "fit" = fit whole graph after selecting
const m = process.argv[6] || '';
const mode = m === 'fit' ? "document.getElementById('dp').hidden=true;window.cgFit();" : m ? `document.querySelector('[data-act=${m}]').click();` : '';

const PKG = ['name', 'version', 'description', 'type', 'abandoned', 'homepage', 'require', 'conflict', 'replace', 'provide'];
const ROOT = ['name', 'version', 'description', 'require', 'require-dev', 'conflict', 'replace', 'provide'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const data = { dir, dirName: path.basename(dir) };
const jsonFile = path.join(dir, 'composer.json');
const lockFile = path.join(dir, 'composer.lock');
data.root = fs.existsSync(jsonFile) ? pick(read(jsonFile), ROOT) : {};
data.packages = [];
if (fs.existsSync(lockFile)) {
  const lock = read(lockFile);
  for (const p of lock.packages || []) data.packages.push(pick(p, PKG));
  for (const p of lock['packages-dev'] || []) data.packages.push({ ...pick(p, PKG), dev: true });
  data.source = 'lock';
} else {
  data.source = 'json';
  data.notice = 'composer.lock not found - only direct requirements are shown.';
}

const payload = { data, config: { theme, projects: [], state: m === 'fit' ? { sidebar: false } : {} } };
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8')
  .replace('/*@CSS@*/', () => fs.readFileSync(path.join(web, 'app.css'), 'utf8'))
  .replace('/*@JS@*/', () => fs.readFileSync(path.join(web, 'app.js'), 'utf8'))
  .replace('/*@BRIDGE@*/', () => 'window.cgBridge = function (m) { console.log("bridge", m); };')
  .replace('/*@PAYLOAD@*/', () => JSON.stringify(payload).replace(/</g, '\\u003c'))
  .replace('</body>', () => (select ? `<script>window.cgSelect(${JSON.stringify(select)});${mode}</script>` : '') + '</body>');
const out = path.join(here, process.argv[5] || 'preview.html');
fs.writeFileSync(out, html);
console.log('wrote', out, `(${data.packages.length} packages)`);
