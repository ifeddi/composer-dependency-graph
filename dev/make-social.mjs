// Generates LinkedIn-sized artwork as SVG (render to PNG with headless Chrome, see README/dev notes):
//   node dev/make-social.mjs   ->  docs/images/linkedin-cover.svg (1920x1080, 16:9)
//                                  docs/images/linkedin-post.svg  (1200x627, 1.91:1)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images');
const C = { root: '#8b5cf6', direct: '#3b82f6', trans: '#14b8a6', dev: '#f5a524', red: '#ef4444', node: '#121829', text: '#e6e9f2', muted: '#8a93ab' };

// Design space is 1200 wide; height is 627 (post) or 675 (cover, scaled 1.6x to 1920x1080).
function svg(W, H, pxW, pxH) {
  const dy = Math.round(H / 2 - 310);              // keep content vertically centered
  const node = (x, y, w, name, ver, color, glow) =>
    `<g ${glow ? 'filter="url(#glow)"' : ''}><rect x="${x}" y="${y}" width="${w}" height="52" rx="10" fill="${C.node}" stroke="${color}" stroke-width="${glow ? 2.4 : 1.6}"/></g>` +
    `<text x="${x + 15}" y="${y + 23}" font-size="14" font-weight="600" fill="${C.text}">${name}</text>` +
    `<text x="${x + 15}" y="${y + 41}" font-size="12" fill="${C.muted}" font-family="Consolas, 'Cascadia Mono', monospace">${ver}</text>`;
  const edge = (x1, y1, x2, y2, color, dash) => {
    const c = (x2 - x1) / 2;
    return `<path d="M${x1} ${y1} C${x1 + c} ${y1},${x2 - c} ${y2},${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="url(#a-${color.slice(1)})"/>`;
  };
  // columns
  const rx = 60, dx = 470, tx = 900, w1 = 190, w2 = 205, w3 = 215;
  const rows = [300, 372, 444, 516];
  const direct = [
    ['symfony/console', 'v6.4.8', C.direct], ['doctrine/orm', '3.6.9', C.direct],
    ['guzzlehttp/guzzle', '7.8.1', C.direct], ['phpunit/phpunit', '10.5.20', C.dev],
  ];
  const trans = [
    [276, 'psr/log', '3.0.0'], [348, 'symfony/string', 'v6.4.8'], [420, 'doctrine/dbal', '3.8.4'], [492, 'psr/http-message', '2.0'],
  ];
  const rootY = 408;
  let g = '';
  // edges root -> direct
  rows.forEach((y, i) => { g += edge(rx + w1, rootY + 26, dx, y + 26, i === 3 ? C.dev : C.direct, i === 3 ? '2 5' : ''); });
  // edges direct -> transitive
  const links = [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3]];
  links.forEach(([a, b]) => { g += edge(dx + w2, rows[a] + 26, tx, trans[b][0] + 26, a === 3 ? C.dev : C.trans, a === 3 ? '2 5' : ''); });
  // conflict
  g += `<path d="M${dx + w2} ${rows[1] + 26} C${dx + w2 + 160} ${rows[1] - 10},${tx - 60} ${rows[3] + 70},${tx} ${trans[3][0] + 40}" fill="none" stroke="${C.red}" stroke-width="2" stroke-dasharray="7 5" opacity=".9"/>`;
  g += node(rx, rootY, w1, 'my-app/shop', 'root project', C.root, true);
  direct.forEach((d, i) => { g += node(dx, rows[i], w2, d[0], d[1], d[2]); });
  trans.forEach((t) => { g += node(tx, t[0], w3, t[1], t[2], C.trans); });

  const marker = (col) => `<marker id="a-${col.slice(1)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L10 5L0 9z" fill="${col}"/></marker>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${W} ${H}" font-family="'Segoe UI', system-ui, -apple-system, Roboto, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0e17"/><stop offset="1" stop-color="#1a1336"/></linearGradient>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#bba8ff"/></linearGradient>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#1b2136"/></pattern>
    <filter id="glow" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    ${[C.direct, C.trans, C.dev].map(marker).join('')}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#dots)"/>
  <g transform="translate(0 ${dy})">
    <text x="60" y="108" font-size="60" font-weight="700" fill="url(#title)">Composer Dependency Graph</text>
    <text x="62" y="152" font-size="24" fill="${C.muted}">See which packages constrain each other — before you run composer update.</text>
    <g font-size="15" font-weight="600">
      <rect x="62" y="180" width="270" height="32" rx="16" fill="#1a2140" stroke="${C.direct}"/><text x="197" y="201" text-anchor="middle" fill="#9cc0ff">Interactive graph inside PhpStorm</text>
      <rect x="344" y="180" width="130" height="32" rx="16" fill="#10282a" stroke="${C.trans}"/><text x="409" y="201" text-anchor="middle" fill="#6fe0d2">Free · MIT</text>
    </g>
    ${g}
  </g>
</svg>
`;
}

fs.writeFileSync(path.join(out, 'linkedin-cover.svg'), svg(1200, 675, 1920, 1080));
fs.writeFileSync(path.join(out, 'linkedin-post.svg'), svg(1200, 627, 1200, 627));
console.log('wrote linkedin-cover.svg, linkedin-post.svg');
