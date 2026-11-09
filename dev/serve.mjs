// Tiny static server for dev/preview.html  (node dev/serve.mjs)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
http.createServer((req, res) => {
  const name = req.url.split('?')[0] === '/' ? 'preview.html' : req.url.split('?')[0].slice(1);
  const file = path.join(here, path.basename(name));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(5173, () => console.log('http://localhost:5173'));
