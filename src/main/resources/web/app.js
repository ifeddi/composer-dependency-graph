(function () {
'use strict';

/* ======================================================================================
 * Composer dependency graph UI.
 * Input  : #cg-payload = { data: {root, packages, source, notice, error, dir}, config: {theme, projects, state} }
 * Bridge : window.cgBridge(jsonString)   (Kotlin side: open file, reload, save state ...)
 * ==================================================================================== */

var payload = JSON.parse(document.getElementById('cg-payload').textContent);
var DATA = payload.data || {};
var CFG = payload.config || {};
var $ = function (id) { return document.getElementById(id); };
var SVGNS = 'http://www.w3.org/2000/svg';

document.documentElement.setAttribute('data-theme', CFG.theme === 'light' ? 'light' : 'dark');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function post(msg) { try { if (window.cgBridge) window.cgBridge(JSON.stringify(msg)); } catch (e) { /* ignore */ } }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function entries(o) { return o && typeof o === 'object' ? Object.keys(o).map(function (k) { return [k, o[k]]; }) : []; }

var TYPE_LABEL = {
  root: 'Root package', direct: 'Direct dependency', transitive: 'Transitive dependency', dev: 'Dev dependency',
  platform: 'Platform requirement', unresolved: 'Not installed', orphan: 'Not required by anything'
};

/* ---------------------------------------------------------------------------------------
 * 1. Model
 * ------------------------------------------------------------------------------------- */
var PLATFORM_RE = /^(php(-64bit|-ipv6|-zts|-debug)?|hhvm|ext-[a-z0-9_.-]+|lib-[a-z0-9_.-]+|composer(-plugin-api|-runtime-api)?)$/i;
var M = null;

function buildModel() {
  var nodes = new Map(), list = [], edges = [];
  var jsonOnly = DATA.source === 'json';
  var rootData = DATA.root || {};

  function mk(name, props, register) {
    var n = { id: list.length, name: name, version: '', desc: '', type: 'transitive', out: [], inn: [], depth: -1,
      collapsed: false, parent: null, replaces: [], provides: [], fixed: false };
    for (var k in props) n[k] = props[k];
    list.push(n);
    if (register !== false) nodes.set(name, n);
    return n;
  }

  var rootName = rootData.name || DATA.dirName || 'root project';
  var root = mk(rootName, { type: 'root', isRoot: true, depth: 0, version: rootData.version || '', desc: rootData.description || '', fixed: true }, false);

  (DATA.packages || []).forEach(function (p) {
    if (nodes.has(p.name)) return;
    mk(p.name, {
      version: String(p.version || ''), desc: p.description || '', pkgType: p.type || '', abandoned: p.abandoned || false,
      homepage: p.homepage || '', lockDev: !!p.dev, installed: true,
      replaces: Object.keys(p.replace || {}), provides: Object.keys(p.provide || {})
    });
  });

  // replace / provide: requirements on a name that is not installed itself resolve to the providing package
  var alias = new Map();
  (DATA.packages || []).forEach(function (p) {
    ['replace', 'provide'].forEach(function (k) {
      Object.keys(p[k] || {}).forEach(function (n) {
        if (nodes.has(n) || n === p.name) return;
        if (!alias.has(n)) alias.set(n, []);
        if (alias.get(n).indexOf(p.name) < 0) alias.get(n).push(p.name);
      });
    });
  });

  function ensure(name, type) {
    var n = nodes.get(name);
    if (n) return n;
    return mk(name, { type: type === 'stub' ? 'transitive' : type, fixed: type !== 'stub', stub: type === 'stub' });
  }
  var rootReplaced = new Set(Object.keys(rootData.replace || {}).concat(Object.keys(rootData.provide || {})));
  function resolve(name) {
    if (PLATFORM_RE.test(name)) return [ensure(name, 'platform')];
    if (nodes.has(name)) return [nodes.get(name)];
    if (rootReplaced.has(name)) {
      var rn = ensure(name, 'platform');
      rn.note = 'replaced by root';
      return [rn];
    }
    if (alias.has(name)) return alias.get(name).map(function (a) { return nodes.get(a); });
    return [ensure(name, jsonOnly ? 'stub' : 'unresolved')];
  }
  function addEdge(from, name, constraint, kind) {
    resolve(name).forEach(function (to) {
      if (to === from) return;
      var e = { id: edges.length, from: from, to: to, constraint: String(constraint || ''), kind: kind, via: to.name !== name ? name : null };
      edges.push(e); from.out.push(e); to.inn.push(e);
      if (to.stub && !to.version) to.version = e.constraint;
    });
  }
  function addConflict(from, name, constraint) {
    if (PLATFORM_RE.test(name)) return;
    if (!nodes.has(name) && !alias.has(name)) return;
    addEdge(from, name, constraint, 'conflict');
  }

  entries(rootData.require).forEach(function (r) { addEdge(root, r[0], r[1], 'require'); });
  entries(rootData['require-dev']).forEach(function (r) { addEdge(root, r[0], r[1], 'require-dev'); });
  entries(rootData.conflict).forEach(function (r) { addConflict(root, r[0], r[1]); });
  (DATA.packages || []).forEach(function (p) {
    var n = nodes.get(p.name);
    entries(p.require).forEach(function (r) { addEdge(n, r[0], r[1], 'require'); });
    entries(p.conflict).forEach(function (r) { addConflict(n, r[0], r[1]); });
  });

  // BFS (shortest path from the root) -> depth + parent edge
  var q = [root], i, maxDepth = 0;
  for (i = 0; i < q.length; i++) {
    var u = q[i];
    u.out.forEach(function (e) {
      if (e.kind === 'conflict') return;
      var v = e.to;
      if (v.depth < 0) { v.depth = u.depth + 1; v.parent = e; maxDepth = Math.max(maxDepth, v.depth); q.push(v); }
    });
  }

  // reachability without dev edges of the root => prod vs dev
  var prod = new Set([root]); q = [root];
  for (i = 0; i < q.length; i++) {
    q[i].out.forEach(function (e) { if (e.kind === 'require' && !prod.has(e.to)) { prod.add(e.to); q.push(e.to); } });
  }
  var directReq = new Set();
  root.out.forEach(function (e) { if (e.kind === 'require') directReq.add(e.to); });

  list.forEach(function (n) {
    if (n.isRoot || n.fixed) return;
    if (n.depth < 0) { n.type = 'orphan'; n.depth = maxDepth + 1; return; }
    n.type = directReq.has(n) ? 'direct' : prod.has(n) ? 'transitive' : 'dev';
  });
  list.forEach(function (n) { if (n.fixed && n.depth < 0) n.depth = maxDepth + 1; });

  var counts = { direct: 0, transitive: 0, dev: 0, platform: 0, unresolved: 0, orphan: 0 };
  list.forEach(function (n) { if (counts[n.type] != null) counts[n.type]++; });
  var uniqueDeps = function (n) {
    var s = new Set(); n.inn.forEach(function (e) { if (e.kind !== 'conflict') s.add(e.from); }); return s.size;
  };
  var realCount = counts.direct + counts.transitive + counts.dev + counts.orphan;

  return { nodes: nodes, list: list, edges: edges, root: root, maxDepth: maxDepth, counts: counts, realCount: realCount, uniqueDeps: uniqueDeps };
}

/* ---------------------------------------------------------------------------------------
 * 2. State
 * ------------------------------------------------------------------------------------- */
var saved = CFG.state || {};
var F = {
  transitive: true, dev: true, constraints: null, conflicts: true, platform: false, layout: 'flow'
};
F.conflicts = false;
(function () { var sf = saved.filters || {}; for (var k in F) if (sf[k] != null) F[k] = sf[k]; })();
var sidebarOpen = saved.sidebar != null ? !!saved.sidebar : (window.innerWidth > 760);

var sel = null;            // selected node
var focus = null;          // {node, mode}
var vis = new Set();       // visible nodes
var visEdges = [];         // [{e, p, l}] rendered edges
var nodeEls = new Map();   // node.id -> <g>
var edgeRec = new Map();   // edge.id -> record
var history = [];          // selection history (names)
var view = { x: 0, y: 0, k: 1 };
var bounds = { w: 0, h: 0 };
var searchHits = [], searchIdx = -1;

function saveState() {
  post({ cmd: 'state', value: { filters: F, sidebar: sidebarOpen } });
}

/* ---------------------------------------------------------------------------------------
 * 3. Visibility
 * ------------------------------------------------------------------------------------- */
function allowed(n) {
  switch (n.type) {
    case 'transitive': case 'orphan': return F.transitive;
    case 'dev': return F.dev;
    case 'platform': return F.platform;
    default: return true;
  }
}
function kidsOf(n) {
  var s = new Set();
  n.out.forEach(function (e) { if (e.kind !== 'conflict' && allowed(e.to)) s.add(e.to); });
  return s;
}
function focusSet() {
  var set = new Set([focus.node]);
  function walk(down) {
    var q = [focus.node];
    for (var i = 0; i < q.length; i++) {
      (down ? q[i].out : q[i].inn).forEach(function (e) {
        if (e.kind === 'conflict') return;
        var v = down ? e.to : e.from;
        if (!set.has(v) && (F.platform || v.type !== 'platform')) { set.add(v); q.push(v); }
      });
    }
  }
  if (focus.mode !== 'up') walk(true);
  if (focus.mode !== 'down') walk(false);
  return set;
}
function computeVisible() {
  if (focus) return focusSet();
  var set = new Set([M.root]), q = [M.root];
  for (var i = 0; i < q.length; i++) {
    var u = q[i];
    if (u.collapsed && !u.isRoot) continue;
    u.out.forEach(function (e) {
      if (e.kind === 'conflict') return;
      if (!set.has(e.to) && allowed(e.to)) { set.add(e.to); q.push(e.to); }
    });
  }
  if (F.transitive) M.list.forEach(function (n) { if (n.type === 'orphan') set.add(n); });
  return set;
}

/* ---------------------------------------------------------------------------------------
 * 4. Layout (layered, left -> right by distance from the root; barycenter ordering)
 * ------------------------------------------------------------------------------------- */
var NODE_H = 52, GAP_Y = 14, PAD = 48;
var FONT_NAME = '600 12.5px system-ui, "Segoe UI", sans-serif';
var FONT_VER = '11px ui-monospace, Consolas, monospace';
var mctx = document.createElement('canvas').getContext('2d');
function tw(s, font) { mctx.font = font; return mctx.measureText(s).width; }
function versionText(n) {
  if (n.isRoot) return n.version || 'root project';
  if (n.type === 'unresolved') return 'not installed';
  if (n.type === 'platform') return n.note || n.version || 'platform';
  return n.version || '–';
}
function fitText(s, maxW, font) {
  if (tw(s, font) <= maxW) return s;
  var lo = 1, hi = s.length;
  while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (tw(s.slice(0, mid) + '…', font) <= maxW) lo = mid; else hi = mid - 1; }
  return s.slice(0, lo) + '…';
}

// Column index = longest path from a source among the visible nodes, so (almost) every edge points to the right.
function assignRanks(arr) {
  var state = new Map(), post = [];
  var fwd = function (n) { return n.out.filter(function (e) { return e.kind !== 'conflict' && vis.has(e.to) && e.to !== n; }); };
  var hasIn = function (n) { return n.inn.some(function (e) { return e.kind !== 'conflict' && vis.has(e.from) && e.from !== n; }); };
  var starts = arr.filter(function (n) { return !hasIn(n) && n.type !== 'orphan'; });
  starts.sort(function (a, b) { return (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0); });
  arr.forEach(function (n) { if (starts.indexOf(n) < 0 && n.type !== 'orphan') starts.push(n); }); // cycles
  var back = new Set();
  starts.forEach(function (s) {
    if (state.has(s)) return;
    var stack = [{ n: s, es: fwd(s), i: 0 }];
    state.set(s, 1);
    while (stack.length) {
      var top = stack[stack.length - 1];
      if (top.i < top.es.length) {
        var e = top.es[top.i++], v = e.to;
        if (state.get(v) === 1) back.add(e.id);
        else if (!state.has(v)) { state.set(v, 1); stack.push({ n: v, es: fwd(v), i: 0 }); }
      } else { state.set(top.n, 2); post.push(top.n); stack.pop(); }
    }
  });
  arr.forEach(function (n) { n.rank = 0; });
  for (var i = post.length - 1; i >= 0; i--) {
    var u = post[i];
    fwd(u).forEach(function (e) { if (!back.has(e.id)) e.to.rank = Math.max(e.to.rank, u.rank + 1); });
  }
  var max = 0; arr.forEach(function (n) { if (n.type !== 'orphan') max = Math.max(max, n.rank); });
  arr.forEach(function (n) { if (n.type === 'orphan') n.rank = max + 1; });
}

function layout() {
  var arr = Array.from(vis);
  if (F.layout === 'depth') arr.forEach(function (n) { n.rank = n.depth; }); else assignRanks(arr);
  var depths = Array.from(new Set(arr.map(function (n) { return n.rank; }))).sort(function (a, b) { return a - b; });
  var colOf = new Map(); depths.forEach(function (d, i) { colOf.set(d, i); });
  var cols = depths.map(function () { return []; });
  var rank = { root: 0, direct: 1, dev: 2, transitive: 3, platform: 4, orphan: 5, unresolved: 6 };
  arr.forEach(function (n) { n.col = colOf.get(n.rank); cols[n.col].push(n); n.nbs = []; });
  arr.forEach(function (n) {
    n.out.concat(n.inn).forEach(function (e) {
      if (e.kind === 'conflict') return;
      var m = e.from === n ? e.to : e.from;
      if (vis.has(m) && m !== n) n.nbs.push(m);
    });
  });
  cols.forEach(function (c) {
    c.sort(function (a, b) { return (rank[a.type] - rank[b.type]) || a.name.localeCompare(b.name); });
    c.forEach(function (n, i) { n.idx = i; });
  });
  function pos(n) { return (n.idx + 0.5) / cols[n.col].length; }
  function sweep(ci, dir) {
    var c = cols[ci];
    var keyed = c.map(function (n) {
      var s = 0, k = 0;
      n.nbs.forEach(function (m) { if (dir < 0 ? m.col < ci : m.col > ci) { s += pos(m); k++; } });
      return { n: n, b: k ? s / k : pos(n) };
    });
    keyed.sort(function (a, b) { return (a.b - b.b) || (a.n.idx - b.n.idx); });
    keyed.forEach(function (o, i) { o.n.idx = i; c[i] = o.n; });
  }
  if (arr.length < 3000) {
    for (var it = 0; it < 4; it++) {
      for (var ci = 1; ci < cols.length; ci++) sweep(ci, -1);
      for (ci = cols.length - 2; ci >= 0; ci--) sweep(ci, 1);
    }
  }

  var colW = cols.map(function (c) {
    var w = 0;
    c.forEach(function (n) {
      n.kids = focus ? null : kidsOf(n);
      n.hasKids = !!n.kids && n.kids.size > 0 && !n.isRoot;
      var need = Math.max(tw(n.name, FONT_NAME), tw(versionText(n), FONT_VER)) + 30 + (n.hasKids ? 34 : 0);
      w = Math.max(w, need);
    });
    return clamp(w, 150, 380);
  });
  var gapX = F.constraints ? 150 : 110;
  var x = PAD, maxCount = 0;
  cols.forEach(function (c) { maxCount = Math.max(maxCount, c.length); });
  var totalH = maxCount * (NODE_H + GAP_Y) - GAP_Y;
  cols.forEach(function (c, ci) {
    var colH = c.length * (NODE_H + GAP_Y) - GAP_Y;
    var y0 = PAD + (totalH - colH) / 2;
    c.forEach(function (n, i) { n.w = colW[ci]; n.h = NODE_H; n.x = x; n.y = y0 + i * (NODE_H + GAP_Y); });
    x += colW[ci] + gapX;
  });
  bounds = { w: x - gapX + PAD, h: totalH + PAD * 2 };
}

/* ---------------------------------------------------------------------------------------
 * 5. Rendering
 * ------------------------------------------------------------------------------------- */
var svg = $('svg'), vp = $('vp');
var EDGE_TYPES = ['root', 'direct', 'transitive', 'dev', 'platform', 'unresolved', 'orphan'];

function renderDefs() {
  var h = '';
  EDGE_TYPES.concat(['conflict']).forEach(function (t) {
    var cls = t === 'conflict' ? 'ah k-conflict' : 'ah t-' + t;
    h += '<marker id="ah-' + t + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path class="' + cls + '" d="M0 1 L10 5 L0 9 z"/></marker>';
  });
  $('defs').innerHTML = h;
}

function edgePath(e) {
  var a = e.from, b = e.to;
  var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
  if (b.col > a.col) {
    var c = Math.max(40, (x2 - x1) / 2);
    return 'M' + x1 + ' ' + y1 + ' C' + (x1 + c) + ' ' + y1 + ',' + (x2 - c) + ' ' + y2 + ',' + x2 + ' ' + y2;
  }
  // same column / backwards edge: leave on the right, enter on the left, loop around
  var out = 60;
  return 'M' + x1 + ' ' + y1 + ' C' + (x1 + out) + ' ' + (y1 - 50) + ',' + (x2 - out) + ' ' + (y2 - 50) + ',' + x2 + ' ' + y2;
}

function render(anchor) {
  var before = null;
  if (anchor && anchor.x != null && vis.has(anchor)) before = { x: anchor.x * view.k + view.x, y: anchor.y * view.k + view.y };

  vis = computeVisible();
  // visible edges
  var es = [];
  M.edges.forEach(function (e) {
    if (!vis.has(e.from) || !vis.has(e.to)) return;
    // conflict edges are noisy: unless "Show conflicts" is on, only the selected package's own conflicts are drawn
    if (e.kind === 'conflict' && !F.conflicts && !(sel && (e.from === sel || e.to === sel))) return;
    es.push(e);
  });
  if (F.constraints === null) F.constraints = es.length <= 60;
  $('f-constraints').checked = F.constraints;
  layout();

  var eh = '', lh = '', nh = '';
  es.forEach(function (e) {
    var t = e.kind === 'conflict' ? 'conflict' : e.to.type;
    var kcls = 'k-' + e.kind;
    eh += '<path class="edge ' + kcls + ' t-' + e.to.type + '" data-e="' + e.id + '" d="' + edgePath(e) + '" marker-end="url(#ah-' + t + ')"><title>' +
      esc(e.from.name + (e.kind === 'conflict' ? ' conflicts with ' : ' requires ') + e.to.name + (e.constraint ? '  ' + e.constraint : '') + (e.via ? '  (via ' + e.via + ')' : '')) + '</title></path>';
    if (e.constraint) {
      // label sits just before the target node: fan-out edges are well separated there
      var lx = e.to.x - 12, ly = e.to.y + e.to.h / 2 - 5;
      if (e.to.col <= e.from.col) { lx = e.to.x - 12; ly = e.to.y + e.to.h / 2 - 5; }
      lh += '<text class="lbl ' + kcls + '" data-e="' + e.id + '" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '">' +
        esc((e.kind === 'conflict' ? '⊘ ' : '') + e.constraint) + '</text>';
    }
  });
  Array.from(vis).forEach(function (n) {
    var nameTxt = fitText(n.name, n.w - 28 - (n.hasKids ? 34 : 0), FONT_NAME);
    var tip = n.name + '\n' + versionText(n) + (n.desc ? '\n' + n.desc : '') + (n.type !== 'root' ? '\n[' + TYPE_LABEL[n.type] + ']' : '');
    nh += '<g class="node t-' + n.type + '" data-i="' + n.id + '" transform="translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')">' +
      '<title>' + esc(tip) + '</title>' +
      '<rect class="nb" width="' + n.w.toFixed(1) + '" height="' + n.h + '" rx="9"/>' +
      '<text class="nn" x="14" y="22">' + esc(nameTxt) + '</text>' +
      '<text class="nv" x="14" y="39">' + esc(versionText(n)) + (n.abandoned ? ' · abandoned' : '') + '</text>';
    if (n.hasKids) {
      var hidden = 0; n.kids.forEach(function (k) { if (!vis.has(k)) hidden++; });
      var label = n.collapsed ? '+' + (hidden || n.kids.size) : '−';
      nh += '<g class="chev" data-chev="' + n.id + '" transform="translate(' + (n.w - 32) + ',' + (n.h / 2 - 10) + ')">' +
        '<rect class="cb" width="26" height="20" rx="6"/><text x="13" y="14">' + label + '</text></g>';
    }
    nh += '</g>';
  });
  $('edges').innerHTML = eh;
  $('labels').innerHTML = lh;
  $('nodes').innerHTML = nh;
  svg.classList.toggle('show-labels', !!F.constraints);

  nodeEls.clear(); edgeRec.clear(); visEdges = [];
  Array.prototype.forEach.call($('nodes').children, function (g) { nodeEls.set(+g.getAttribute('data-i'), g); });
  var lblByEdge = new Map();
  Array.prototype.forEach.call($('labels').children, function (t) { lblByEdge.set(+t.getAttribute('data-e'), t); });
  Array.prototype.forEach.call($('edges').children, function (p) {
    var id = +p.getAttribute('data-e');
    var rec = { e: M.edges[id], p: p, l: lblByEdge.get(id) || null };
    edgeRec.set(id, rec); visEdges.push(rec);
  });

  if (before) {
    view.x = before.x - anchor.x * view.k; view.y = before.y - anchor.y * view.k;
    applyView();
  }
  applySelection();
  markSearch();
  renderFocusBar();
  renderStats();
  $('empty').hidden = true;
}

function applySelection() {
  svg.classList.toggle('has-sel', !!(sel && vis.has(sel)) && !focus);
  nodeEls.forEach(function (g) { g.classList.remove('sel', 'rel'); });
  visEdges.forEach(function (r) { r.p.classList.remove('rel', 'path'); if (r.l) r.l.classList.remove('rel'); });
  if (!sel || !vis.has(sel)) return;
  nodeEls.get(sel.id).classList.add('sel', 'rel');
  visEdges.forEach(function (r) {
    if (r.e.from === sel || r.e.to === sel) {
      r.p.classList.add('rel'); if (r.l) r.l.classList.add('rel');
      var other = r.e.from === sel ? r.e.to : r.e.from;
      var g = nodeEls.get(other.id); if (g) g.classList.add('rel');
    }
  });
  for (var n = sel; n && n.parent; n = n.parent.from) {
    var rec = edgeRec.get(n.parent.id);
    if (rec) { rec.p.classList.add('rel', 'path'); if (rec.l) rec.l.classList.add('rel'); }
    var pg = nodeEls.get(n.parent.from.id); if (pg) pg.classList.add('rel');
  }
}

/* ---------------------------------------------------------------------------------------
 * 6. Pan / zoom
 * ------------------------------------------------------------------------------------- */
function applyView() {
  vp.setAttribute('transform', 'translate(' + view.x.toFixed(2) + ',' + view.y.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
  $('zoom').textContent = Math.round(view.k * 100) + '%';
}
function stageSize() { var r = svg.getBoundingClientRect(); return { w: r.width, h: r.height }; }
function zoomAt(factor, cx, cy) {
  var s = stageSize();
  if (cx == null) { cx = s.w / 2; cy = s.h / 2; }
  var k = clamp(view.k * factor, 0.08, 2.5);
  var f = k / view.k;
  view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.k = k;
  applyView();
}
var anim = null;
function animateTo(t) {
  if (anim) cancelAnimationFrame(anim);
  var from = { x: view.x, y: view.y, k: view.k }, t0 = performance.now(), D = 260;
  function step(now) {
    var p = clamp((now - t0) / D, 0, 1), e = 1 - Math.pow(1 - p, 3);
    view.x = from.x + (t.x - from.x) * e; view.y = from.y + (t.y - from.y) * e; view.k = from.k + (t.k - from.k) * e;
    applyView();
    anim = p < 1 ? requestAnimationFrame(step) : null;
  }
  anim = requestAnimationFrame(step);
}
function fit(animate) {
  var s = stageSize();
  var side = $('dp').hidden ? 0 : 340;   // keep the graph clear of the details panel
  var k = clamp(Math.min((s.w - side) / bounds.w, s.h / bounds.h), 0.08, 1.2);
  var t = { k: k, x: (s.w - side - bounds.w * k) / 2, y: (s.h - bounds.h * k) / 2 };
  if (animate) animateTo(t); else { view = t; applyView(); }
}
function initialView() {
  var s = stageSize();
  var k = Math.min(s.w / bounds.w, s.h / bounds.h);
  if (k >= 0.38) { fit(false); return; }
  // large graph: start readable, anchored on the root
  var r = M.root;
  view = { k: 0.75, x: 30 - r.x * 0.75, y: s.h / 2 - (r.y + r.h / 2) * 0.75 };
  applyView();
}
function centerOn(n, k) {
  if (!n || n.x == null) return;
  var s = stageSize();
  var kk = k || Math.max(view.k, 0.8);
  var dpw = $('dp').hidden ? 0 : 330;
  animateTo({ k: kk, x: (s.w - dpw) / 2 - (n.x + n.w / 2) * kk, y: s.h / 2 - (n.y + n.h / 2) * kk });
}

/* ---------------------------------------------------------------------------------------
 * 7. Selection / navigation
 * ------------------------------------------------------------------------------------- */
function ensureAllowed(n) {
  var changed = false;
  if (!allowed(n)) {
    if (n.type === 'transitive' || n.type === 'orphan') F.transitive = true;
    else if (n.type === 'dev') F.dev = true;
    else if (n.type === 'platform') F.platform = true;
    syncFilterUI(); changed = true;
  }
  return changed;
}
function reveal(n) {
  var changed = false;
  if (focus && !focusSet().has(n)) { focus = null; changed = true; }
  changed = ensureAllowed(n) || changed;
  if (!focus) {
    for (var e = n.parent; e; e = e.from.parent) {
      var a = e.from;
      changed = ensureAllowed(a) || changed;
      if (a.collapsed && !a.isRoot) { a.collapsed = false; changed = true; }
    }
  }
  if (!vis.has(n)) changed = true;
  if (changed) render();
}
function selectNode(n, opts) {
  opts = opts || {};
  if (n && !n.isRoot && opts.reveal !== false) reveal(n);
  else if (n && n.isRoot && !vis.has(n)) render();
  if (n && sel !== n && opts.history !== false) { history.push(n.name); if (history.length > 60) history.shift(); }
  var prev = sel;
  sel = n || null;
  var hasConf = function (x) { return !!x && x.out.concat(x.inn).some(function (e) { return e.kind === 'conflict'; }); };
  if (!F.conflicts && prev !== sel && (hasConf(prev) || hasConf(sel))) render();
  applySelection();
  renderDetails();
  if (n && opts.center) centerOn(n);
}
function nodeByName(name) { return M.nodes.get(name) || null; }

function setFocus(n, mode) {
  focus = n ? { node: n, mode: mode } : null;
  render();
  if (n) { sel = n; applySelection(); renderDetails(); fit(true); }
}
function renderFocusBar() {
  var fb = $('focusbar');
  if (!focus) { fb.hidden = true; return; }
  var label = focus.mode === 'up' ? 'Dependents of' : focus.mode === 'down' ? 'Dependencies of' : 'Dependents & dependencies of';
  fb.innerHTML = '<span>' + label + ' <b>' + esc(focus.node.name) + '</b> · ' + (vis.size - 1) + ' related</span>' +
    '<button class="btn" data-act="fup">Dependents</button><button class="btn" data-act="fdown">Dependencies</button>' +
    '<button class="btn" data-act="fboth">Both</button><button class="btn pri" data-act="fclear">Show all</button>';
  fb.hidden = false;
}

/* ---------------------------------------------------------------------------------------
 * 8. Details panel
 * ------------------------------------------------------------------------------------- */
function listRows(items, conflict) {
  var LIM = 40, h = '';
  items.slice(0, LIM).forEach(function (it) {
    h += '<div class="li' + (conflict ? ' conf' : '') + '" data-go="' + esc(it.node.name) + '"><span class="dot t-' + it.node.type + '"></span>' +
      '<span class="n" title="' + esc(it.node.name) + '">' + esc(it.node.name) + (it.tag ? '<span class="tag">dev</span>' : '') + '</span>' +
      '<span class="c">' + esc(it.constraint || it.node.version) + '</span></div>';
  });
  if (items.length > LIM) h += '<div class="more" data-more="1">… ' + (items.length - LIM) + ' more</div>';
  return h || '<div class="more">none</div>';
}
function renderDetails() {
  var dp = $('dp');
  if (!sel) { dp.hidden = true; return; }
  var n = sel;
  var req = [], reqBy = [], conf = [], confBy = [];
  n.out.forEach(function (e) {
    if (e.kind === 'conflict') conf.push({ node: e.to, constraint: e.constraint });
    else req.push({ node: e.to, constraint: e.constraint, tag: e.kind === 'require-dev' });
  });
  n.inn.forEach(function (e) {
    if (e.kind === 'conflict') confBy.push({ node: e.from, constraint: e.constraint });
    else reqBy.push({ node: e.from, constraint: e.constraint, tag: e.kind === 'require-dev' });
  });
  var byName = function (a, b) { return a.node.name.localeCompare(b.node.name); };
  [req, reqBy, conf, confBy].forEach(function (a) { a.sort(byName); });
  var platformReq = req.filter(function (r) { return r.node.type === 'platform'; });
  var pkgReq = req.filter(function (r) { return r.node.type !== 'platform'; });

  var chain = [];
  for (var c = n; c; c = c.parent ? c.parent.from : null) chain.unshift(c);

  var h = '<div class="head"><span class="dot t-' + n.type + '"></span><div><div class="nm">' + esc(n.name) + '</div>' +
    '<div class="meta">' + esc(versionText(n)) + ' · ' + esc(TYPE_LABEL[n.type]) + (n.pkgType && n.pkgType !== 'library' ? ' · ' + esc(n.pkgType) : '') + '</div></div>' +
    '<button class="ib x" data-act="close" title="Close (Esc)"><svg viewBox="0 0 16 16"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button></div>';
  if (n.abandoned) h += '<p class="desc" style="color:var(--c-dev)">⚠ Abandoned' + (typeof n.abandoned === 'string' ? ' – use ' + esc(n.abandoned) + ' instead' : '') + '</p>';
  if (n.desc) h += '<p class="desc">' + esc(n.desc) + '</p>';
  h += '<div class="acts">';
  if (!n.isRoot && n.type !== 'platform' && n.type !== 'unresolved') h += '<button class="btn pri" data-act="open">Open composer.json</button>';
  if (n.isRoot) h += '<button class="btn pri" data-act="openroot">Open composer.json</button>';
  if (!n.isRoot && n.type !== 'platform') h += '<button class="btn" data-act="web">Packagist</button>';
  h += '</div><div class="acts">' +
    '<button class="btn" data-act="up" title="Show only the packages that (transitively) require this one">Dependents</button>' +
    '<button class="btn" data-act="down" title="Show only what this package (transitively) requires">Dependencies</button>' +
    '<button class="btn" data-act="both">Both</button>' +
    (history.length > 1 ? '<button class="btn" data-act="back" title="Previous selection (Alt+←)">← Back</button>' : '') + '</div>';

  if (chain.length > 1) {
    h += '<h4>Why is it here? (shortest path)</h4><div class="chain">';
    chain.forEach(function (x, i) { h += (i ? '<i>›</i>' : '') + '<a data-go="' + (x.isRoot ? '' : esc(x.name)) + '" data-root="' + (x.isRoot ? 1 : 0) + '">' + esc(x.isRoot ? 'root' : x.name) + '</a>'; });
    h += '</div>';
  }
  h += '<h4>Required by (' + reqBy.length + ')</h4>' + listRows(reqBy);
  h += '<h4>Requires (' + pkgReq.length + ')</h4>' + listRows(pkgReq);
  if (platformReq.length) h += '<h4>Platform (' + platformReq.length + ')</h4>' + listRows(platformReq);
  if (conf.length) h += '<h4>Conflicts with (' + conf.length + ')</h4>' + listRows(conf, true);
  if (confBy.length) h += '<h4>Restricted by conflict of (' + confBy.length + ')</h4>' + listRows(confBy, true);
  if (n.replaces.length) h += '<h4>Replaces</h4><div class="chain">' + n.replaces.slice(0, 30).map(function (r) { return '<span>' + esc(r) + '</span>'; }).join(', ') + '</div>';
  if (n.provides.length) h += '<h4>Provides</h4><div class="chain">' + n.provides.slice(0, 30).map(function (r) { return '<span>' + esc(r) + '</span>'; }).join(', ') + '</div>';
  dp.innerHTML = h;
  dp.hidden = false;
}

/* ---------------------------------------------------------------------------------------
 * 9. Sidebar, stats, legend
 * ------------------------------------------------------------------------------------- */
function renderLegend() {
  var rows = [['root', 'Root package'], ['direct', 'Direct dependency'], ['transitive', 'Transitive dependency'], ['dev', 'Dev dependency']];
  if (M.counts.platform) rows.push(['platform', 'Platform / replaced']);
  if (M.counts.unresolved) rows.push(['unresolved', 'Not installed']);
  if (M.counts.orphan) rows.push(['orphan', 'Not required by anything']);
  var h = '';
  rows.forEach(function (r) { h += '<li><span class="dot t-' + r[0] + '"></span>' + r[1] + '</li>'; });
  h += '<li><span class="conf"></span>Conflict / Constraint</li>';
  $('legend').innerHTML = h;
}
function renderStats() {
  var c = M.counts;
  var rows = [['Packages', M.realCount], ['Direct', c.direct], ['Transitive', c.transitive], ['Dev only', c.dev], ['Edges', M.edges.length], ['Shown', vis.size]];
  if (c.unresolved) rows.push(['Not installed', c.unresolved]);
  $('stats').innerHTML = rows.map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('');
}
function renderTop() {
  var arr = M.list.filter(function (n) { return n.type !== 'platform'; })
    .map(function (n) { return { n: n, c: M.uniqueDeps(n) }; })
    .sort(function (a, b) { return b.c - a.c || a.n.name.localeCompare(b.n.name); }).slice(0, 10);
  $('top').innerHTML = arr.map(function (o) {
    return '<li data-go="' + esc(o.n.name) + '"><span class="dot t-' + o.n.type + '"></span><span class="n" title="' + esc(o.n.name) + '">' + esc(o.n.name) + '</span><span class="c">' + o.c + '</span></li>';
  }).join('');
}
function syncFilterUI() {
  $('f-transitive').checked = F.transitive; $('f-dev').checked = F.dev; $('f-constraints').checked = !!F.constraints;
  $('f-conflicts').checked = F.conflicts; $('f-platform').checked = F.platform; $('layout').value = F.layout;
  $('side').classList.toggle('collapsed', !sidebarOpen);
}
function setLevels(L) {
  M.list.forEach(function (n) { n.collapsed = !n.isRoot && n.depth >= L; });
  $('levels').value = String(L === Infinity ? 'all' : L);
}
function initLevels() {
  var h = '';
  for (var i = 1; i <= Math.min(M.maxDepth, 8); i++) h += '<option value="' + i + '">Levels: ' + i + '</option>';
  h += '<option value="all">Levels: all</option>';
  $('levels').innerHTML = h;
}

/* ---------------------------------------------------------------------------------------
 * 10. Search
 * ------------------------------------------------------------------------------------- */
function searchNodes(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  var terms = q.split(/\s+/);
  var res = [];
  M.list.forEach(function (n) {
    if (n.isRoot) return;
    var nm = n.name.toLowerCase(), ds = (n.desc || '').toLowerCase(), score = 0, ok = true;
    terms.forEach(function (t) {
      var i = nm.indexOf(t);
      if (i === 0) score += 100; else if (i > 0 && (nm[i - 1] === '/' || nm[i - 1] === '-')) score += 70; else if (i > 0) score += 40;
      else if (ds.indexOf(t) >= 0) score += 8; else ok = false;
    });
    if (ok) res.push({ n: n, s: score - nm.length * 0.1 });
  });
  res.sort(function (a, b) { return b.s - a.s; });
  return res.map(function (r) { return r.n; });
}
function hl(name, q) {
  var terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean), lower = name.toLowerCase(), mark = new Array(name.length).fill(false);
  terms.forEach(function (t) { var i = lower.indexOf(t); if (i >= 0) for (var j = i; j < i + t.length; j++) mark[j] = true; });
  var out = '', open = false;
  for (var i = 0; i < name.length; i++) {
    if (mark[i] && !open) { out += '<b>'; open = true; } else if (!mark[i] && open) { out += '</b>'; open = false; }
    out += esc(name[i]);
  }
  return out + (open ? '</b>' : '');
}
function renderSearch() {
  var q = $('q').value, box = $('sr');
  searchHits = searchNodes(q);
  searchIdx = searchHits.length ? 0 : -1;
  $('qcount').textContent = q.trim() ? searchHits.length + ' found' : '';
  if (!q.trim()) { box.hidden = true; markSearch(); return; }
  var h = '';
  searchHits.slice(0, 40).forEach(function (n, i) {
    h += '<div class="it' + (i === 0 ? ' on' : '') + '" data-i="' + i + '"><span class="dot t-' + n.type + '"></span><span class="nm">' + hl(n.name, q) + '</span>' +
      (vis.has(n) ? '' : '<span class="tg">hidden</span>') + '<span class="vr">' + esc(versionText(n)) + '</span></div>';
  });
  if (searchHits.length > 40) h += '<div class="none">+' + (searchHits.length - 40) + ' more – refine your search</div>';
  box.innerHTML = h || '<div class="none">No package matches “' + esc(q) + '”</div>';
  box.hidden = false;
  markSearch();
}
function markSearch() {
  var set = new Set(), q = $('q').value.trim();
  if (q) searchHits.forEach(function (n) { set.add(n.id); });
  nodeEls.forEach(function (g, id) { g.classList.toggle('match', set.has(id) && set.size <= 60); });
}
function moveSearch(d) {
  if (!searchHits.length) return;
  searchIdx = (searchIdx + d + Math.min(searchHits.length, 40)) % Math.min(searchHits.length, 40);
  Array.prototype.forEach.call($('sr').querySelectorAll('.it'), function (el, i) {
    el.classList.toggle('on', i === searchIdx);
    if (i === searchIdx) el.scrollIntoView({ block: 'nearest' });
  });
}
function pickSearch(i) {
  var n = searchHits[i != null ? i : searchIdx];
  if (!n) return;
  $('sr').hidden = true;
  selectNode(n, { center: true });
}

/* ---------------------------------------------------------------------------------------
 * 11. Events
 * ------------------------------------------------------------------------------------- */
var drag = null;
svg.addEventListener('pointerdown', function (e) {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target };
});
window.addEventListener('pointermove', function (e) {
  if (!drag) return;
  var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; svg.classList.add('panning'); if (anim) { cancelAnimationFrame(anim); anim = null; } }
  if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; applyView(); }
});
window.addEventListener('pointerup', function () {
  if (!drag) return;
  var d = drag; drag = null; svg.classList.remove('panning');
  if (d.moved) return;
  var chev = d.target.closest && d.target.closest('.chev');
  if (chev) {
    var cn = M.list[+chev.getAttribute('data-chev')];
    cn.collapsed = !cn.collapsed; render(cn); return;
  }
  var g = d.target.closest && d.target.closest('.node');
  if (g) selectNode(M.list[+g.getAttribute('data-i')], { reveal: false });
  else { $('sr').hidden = true; selectNode(null); }
});
svg.addEventListener('dblclick', function (e) {
  var g = e.target.closest && e.target.closest('.node');
  if (e.target.closest && e.target.closest('.chev')) return;
  if (g) {
    var n = M.list[+g.getAttribute('data-i')];
    post(n.isRoot ? { cmd: 'open', name: '' } : { cmd: 'open', name: n.name });
  } else fit(true);
});
svg.addEventListener('wheel', function (e) {
  e.preventDefault();
  var r = svg.getBoundingClientRect();
  if (e.shiftKey) { view.x -= (e.deltaY || e.deltaX); applyView(); return; }
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

function doAct(act) {
  var n = sel;
  switch (act) {
    case 'close': selectNode(null); break;
    case 'open': if (n) post({ cmd: 'open', name: n.name }); break;
    case 'openroot': post({ cmd: 'open', name: '' }); break;
    case 'web': if (n) post({ cmd: 'web', name: n.name }); break;
    case 'up': case 'down': case 'both': if (n) setFocus(n, act); break;
    case 'fup': if (focus) setFocus(focus.node, 'up'); break;
    case 'fdown': if (focus) setFocus(focus.node, 'down'); break;
    case 'fboth': if (focus) setFocus(focus.node, 'both'); break;
    case 'fclear': focus = null; render(); if (sel) centerOn(sel); break;
    case 'back':
      history.pop();
      var prev = history.length ? nodeByName(history[history.length - 1]) : null;
      if (prev) selectNode(prev, { center: true, history: false });
      break;
  }
}
document.addEventListener('click', function (e) {
  var t = e.target;
  var act = t.closest && t.closest('[data-act]');
  if (act) { doAct(act.getAttribute('data-act')); return; }
  var go = t.closest && t.closest('[data-go]');
  if (go) {
    if (go.getAttribute('data-root') === '1') { selectNode(M.root, { center: true }); return; }
    var n = nodeByName(go.getAttribute('data-go'));
    if (n) selectNode(n, { center: true });
    return;
  }
  var it = t.closest && t.closest('#sr .it');
  if (it) { pickSearch(+it.getAttribute('data-i')); return; }
  if (!(t.closest && t.closest('.search'))) $('sr').hidden = true;
});

$('q').addEventListener('input', renderSearch);
$('q').addEventListener('focus', function () { if ($('q').value.trim()) renderSearch(); });
$('q').addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSearch(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearch(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); pickSearch(); }
  else if (e.key === 'Escape') {
    e.preventDefault();
    if ($('q').value) { $('q').value = ''; renderSearch(); } else $('q').blur();
  }
});

$('btn-fit').onclick = function () { fit(true); };
$('btn-zin').onclick = function () { zoomAt(1.25); };
$('btn-zout').onclick = function () { zoomAt(0.8); };
$('btn-reload').onclick = function () { post({ cmd: 'reload' }); };
$('btn-side').onclick = function () { sidebarOpen = !sidebarOpen; syncFilterUI(); saveState(); };
$('btn-expand').onclick = function () { setLevels(Infinity); render(); };
$('btn-collapse').onclick = function () { setLevels(1); render(); fit(true); };
$('layout').onchange = function () { F.layout = $('layout').value; render(); fit(true); saveState(); };
$('levels').onchange =function () { var v = $('levels').value; setLevels(v === 'all' ? Infinity : +v); render(); fit(true); };
[['f-transitive', 'transitive'], ['f-dev', 'dev'], ['f-constraints', 'constraints'], ['f-conflicts', 'conflicts'], ['f-platform', 'platform']].forEach(function (p) {
  $(p[0]).onchange = function () { F[p[1]] = $(p[0]).checked; render(); saveState(); };
});

function neighbourKey(dir) {
  if (!sel || !vis.has(sel)) return;
  var n = sel, target = null;
  var vNodes = function (list, pick) { return list.filter(function (e) { return e.kind !== 'conflict' && vis.has(pick(e)); }).map(pick); };
  if (dir === 'right') { var o = vNodes(n.out, function (e) { return e.to; }).filter(function (m) { return m.col > n.col; }); target = o[0]; }
  else if (dir === 'left') {
    var inn = vNodes(n.inn, function (e) { return e.from; });
    target = (n.parent && vis.has(n.parent.from)) ? n.parent.from : inn[0];
  } else {
    var colNodes = Array.from(vis).filter(function (m) { return m.col === n.col; }).sort(function (a, b) { return a.y - b.y; });
    var i = colNodes.indexOf(n);
    target = colNodes[i + (dir === 'down' ? 1 : -1)];
  }
  if (target) selectNode(target, { center: true, reveal: false });
}
document.addEventListener('keydown', function (e) {
  var tag = (e.target.tagName || '').toLowerCase();
  var typing = tag === 'input' || tag === 'select';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').focus(); $('q').select(); return; }
  if (typing) return;
  switch (e.key) {
    case '/': e.preventDefault(); $('q').focus(); $('q').select(); break;
    case 'Escape': if (focus) { doAct('fclear'); } else selectNode(null); break;
    case 'ArrowRight': e.preventDefault(); neighbourKey('right'); break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.altKey) doAct('back'); else neighbourKey('left');
      break;
    case 'ArrowDown': e.preventDefault(); neighbourKey('down'); break;
    case 'ArrowUp': e.preventDefault(); neighbourKey('up'); break;
    case 'Enter': if (sel) doAct(sel.isRoot ? 'openroot' : 'open'); break;
    case '+': case '=': zoomAt(1.25); break;
    case '-': case '_': zoomAt(0.8); break;
    case '0': fit(true); break;
    case ' ': if (sel) { e.preventDefault(); if (sel.hasKids || (sel.kids && sel.kids.size)) { sel.collapsed = !sel.collapsed; render(sel); } } break;
  }
});
var userMoved = false;
['pointerdown', 'wheel', 'keydown'].forEach(function (t) { window.addEventListener(t, function () { userMoved = true; }, { capture: true, passive: true }); });
window.addEventListener('resize', function () { if (!userMoved && M && vis.size) initialView(); });
if (window.ResizeObserver) new ResizeObserver(function () { if (!userMoved && M && vis.size) initialView(); }).observe($('stage'));

/* ---------------------------------------------------------------------------------------
 * 12. Boot
 * ------------------------------------------------------------------------------------- */
function showEmpty(title, text) {
  $('empty').innerHTML = '<div class="box"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p></div>';
  $('empty').hidden = false;
  $('hint').hidden = true;
}
function boot() {
  $('proj').textContent = DATA.dirName ? '· ' + DATA.dirName : '';
  var projs = CFG.projects || [];
  if (projs.length > 1) {
    var ps = $('projsel');
    ps.innerHTML = projs.map(function (p) {
      var label = p.split(/[\\/]/).slice(-2).join('/');
      return '<option value="' + esc(p) + '"' + (p === DATA.dir ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    ps.hidden = false;
    ps.onchange = function () { post({ cmd: 'setDir', path: ps.value }); };
  }
  syncFilterUI();
  renderDefs();

  if (DATA.error) { showEmpty('Nothing to show', DATA.error); return; }
  M = buildModel();
  window.cgModel = M;
  if (DATA.notice) { $('banner').textContent = DATA.notice; $('banner').hidden = false; }
  if (!M.root.out.length && !M.list.length) { showEmpty('Empty project', 'composer.json does not require any package.'); return; }

  renderLegend(); renderTop(); initLevels();
  var total = M.realCount;
  setLevels(total <= 60 ? Infinity : total <= 220 ? 2 : 1);
  render();
  initialView();
}

window.cgSelect = function (name) {
  if (!M) return;
  var n = nodeByName(name);
  if (n) selectNode(n, { center: true });
};
window.cgFit = function () { if (anim) { cancelAnimationFrame(anim); anim = null; } fit(false); };

boot();
})();
