// Strona z wykresami cen pokemonow na targu (GET /api/market/wykresy).
// Samodzielny HTML: dane wbudowane jako JSON, wykres rysowany w SVG po
// stronie przegladarki, bez zewnetrznych bibliotek.
//
// Forma: wykres rozrzutu cena w ¥ (os log) w czasie dla wybranego gatunku;
// 3 kategorie (zwykly / trenowany / shiny) - kolor + ksztalt znacznika
// (paleta zwalidowana: 3 sloty all-pairs, light i dark), legenda, podpowiedz
// po najechaniu, tabela ofert pod wykresem i lista okazji.

const { CATEGORIES } = require('./pokemonHistory');

// JSON bezpieczny do wstawienia w <script> (zadne "</script>" z danych).
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function renderPokemonChartsPage({ records = [], deals = [], generatedAt = new Date().toISOString() } = {}) {
  const data = {
    generatedAt,
    categories: CATEGORIES,
    records: records.map((r) => [r.ts, r.sp, r.id, r.lvl, r.tr, r.val, r.yen, r.pz, r.sh ? 1 : 0]),
    deals: deals.map((d) => ({
      species: d.species, kind: d.kind, category: d.category, expected: d.expected, ratio: d.ratio,
      basis: d.basis, id: d.offer.id, level: d.offer.level, trainings: d.offer.trainings,
      value: d.offer.value, yen: d.offer.yenPrice,
    })),
  };
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Targ pokemonów - historia cen</title>
<style>
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface-1: #fcfcfb;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a;
  --good: #006300;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d; --surface-1: #1a1a19;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
    --good: #0ca30c;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface-1: #1a1a19;
  --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
  --good: #0ca30c;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text-primary);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 32px 0 8px; }
.sub { color: var(--text-secondary); margin: 0 0 20px; }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.filters { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; margin-bottom: 12px; }
.filters label { color: var(--text-secondary); }
input[type=search], select { font: inherit; color: var(--text-primary); background: var(--page);
  border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; min-width: 0; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; margin: 4px 0 8px; color: var(--text-secondary); }
.legend label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.chart-wrap { position: relative; overflow-x: auto; }
svg { display: block; width: 100%; height: auto; }
.tick { fill: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.tip { position: absolute; pointer-events: none; background: var(--surface-1); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.12); font-size: 12px;
  min-width: 170px; color: var(--text-secondary); }
.tip strong { color: var(--text-primary); font-size: 14px; display: block; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--grid); text-align: right; white-space: nowrap; }
th { color: var(--text-muted); font-weight: 500; }
th:first-child, td:first-child, td.l, th.l { text-align: left; }
td { font-variant-numeric: tabular-nums; }
.empty { color: var(--text-muted); padding: 24px 0; text-align: center; }
.deal-kind { color: var(--good); font-weight: 600; }
button.link { font: inherit; color: var(--series-1); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
</style></head>
<body><main>
<h1>Targ pokemonów - historia cen</h1>
<p class="sub" id="sub"></p>

<h2>Okazje - oferty poniżej rzeczywistej wartości</h2>
<div class="card"><div class="table-wrap"><table id="deals"></table></div></div>

<h2>Historia cen gatunku</h2>
<div class="card">
  <div class="filters">
    <label for="sp">Gatunek</label>
    <input type="search" id="sp" list="species" placeholder="np. Garganacl" autocomplete="off">
    <datalist id="species"></datalist>
  </div>
  <div class="legend" id="legend"></div>
  <div class="chart-wrap"><svg id="chart" role="img" aria-label="Ceny ofert w czasie"></svg><div class="tip" id="tip" hidden></div></div>
  <div class="table-wrap"><table id="offers"></table></div>
</div>
</main>
<script>
const DATA = ${safeJson(data)};
const CAT_LABEL = { zwykly: 'Zwykłe (do 5 treningów)', trenowany: 'Trenowane', shiny: 'Shiny' };
const CAT_VAR = { zwykly: '--series-1', trenowany: '--series-2', shiny: '--series-3' };
const CAT_SHAPE = { zwykly: 'circle', trenowany: 'square', shiny: 'diamond' };
const KIND_LABEL = { 'ponizej-skupu': 'Poniżej skupu', 'ponizej-typowej': 'Poniżej typowej ceny' };
const BASIS_LABEL = { skup: 'wartość skupu', gatunek: 'historia gatunku' };
const fmt = (n) => n == null ? '-' : Number(n).toLocaleString('pl-PL');
const yen = (n) => n == null ? '-' : fmt(n) + ' ¥';
const fmtDate = (ts) => new Date(ts).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

const recs = DATA.records.map(([ts, sp, id, lvl, tr, val, yenP, pz, sh]) => ({ ts, sp, id, lvl, tr, val, yen: yenP, pz, sh: !!sh,
  cat: sh ? 'shiny' : (tr >= 6 ? 'trenowany' : 'zwykly') }));
const bySpecies = new Map();
for (const r of recs) { if (!bySpecies.has(r.sp)) bySpecies.set(r.sp, []); bySpecies.get(r.sp).push(r); }
const speciesList = [...bySpecies.entries()].sort((a, b) => b[1].length - a[1].length).map(([s]) => s);

document.getElementById('sub').textContent = 'Odczyty z ' + bySpecies.size + ' gatunków, ' + recs.length +
  ' obserwacji ofert. Aktualizacja: ' + fmtDate(Date.parse(DATA.generatedAt)) + '.';
const dl = document.getElementById('species');
for (const s of speciesList) dl.appendChild(el('option', { value: s }));

// --- okazje ---
function renderDeals() {
  const t = document.getElementById('deals');
  t.textContent = '';
  if (!DATA.deals.length) { const r = t.insertRow(); const c = r.insertCell(); c.className = 'empty'; c.colSpan = 8;
    c.textContent = 'Brak ofert poniżej rzeczywistej wartości w ostatnim odczycie.'; return; }
  const h = t.createTHead().insertRow();
  ['Gatunek', 'Rodzaj', 'Kategoria', 'Poz.', 'Tren.', 'Cena', 'Wartość rzeczywista', 'Zysk'].forEach((x, i) => { const th = el('th', i < 3 ? { class: 'l' } : {}, x); h.appendChild(th); });
  const b = t.createTBody();
  for (const d of DATA.deals) {
    const r = b.insertRow();
    const c0 = r.insertCell(); const btn = el('button', { class: 'link', type: 'button' }, d.species); btn.onclick = () => select(d.species); c0.appendChild(btn);
    const c1 = r.insertCell(); c1.className = 'l'; c1.appendChild(el('span', { class: 'deal-kind' }, '▼ ' + KIND_LABEL[d.kind]));
    const c2 = r.insertCell(); c2.className = 'l'; c2.textContent = CAT_LABEL[d.category];
    r.insertCell().textContent = d.level; r.insertCell().textContent = d.trainings;
    r.insertCell().textContent = yen(d.yen);
    const ce = r.insertCell(); ce.textContent = yen(d.expected); ce.title = 'Podstawa: ' + BASIS_LABEL[d.basis];
    r.insertCell().textContent = yen(d.expected - d.yen);
  }
}

// --- wykres ---
const hidden = new Set();
let current = null;
function renderLegend() {
  const lg = document.getElementById('legend'); lg.textContent = '';
  for (const c of DATA.categories) {
    const lab = el('label');
    const cb = el('input', { type: 'checkbox' }); cb.checked = !hidden.has(c);
    cb.onchange = () => { cb.checked ? hidden.delete(c) : hidden.add(c); draw(); };
    const sw = svgEl('svg', { width: 12, height: 12, viewBox: '-6 -6 12 12', 'aria-hidden': 'true' });
    sw.appendChild(marker(c, 0, 0, 5)); sw.style.width = '12px';
    lab.append(cb, sw, document.createTextNode(CAT_LABEL[c]));
    lg.appendChild(lab);
  }
}
function marker(cat, x, y, r) {
  const fill = css(CAT_VAR[cat]);
  const common = { fill, stroke: css('--surface-1'), 'stroke-width': 2 };
  if (CAT_SHAPE[cat] === 'square') return svgEl('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1.5, ...common });
  if (CAT_SHAPE[cat] === 'diamond') return svgEl('path', { d: 'M' + x + ' ' + (y - r - 1) + 'L' + (x + r + 1) + ' ' + y + 'L' + x + ' ' + (y + r + 1) + 'L' + (x - r - 1) + ' ' + y + 'Z', ...common });
  return svgEl('circle', { cx: x, cy: y, r, ...common });
}
function niceLogTicks(min, max) {
  const out = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v >= min && v <= max) out.push(v); }
  }
  return out;
}
const compact = (v) => v >= 1e6 ? (v / 1e6).toLocaleString('pl-PL') + ' mln' : v >= 1e3 ? (v / 1e3).toLocaleString('pl-PL') + ' tys.' : String(v);

function draw() {
  const svg = document.getElementById('chart'); svg.textContent = '';
  const tip = document.getElementById('tip'); tip.hidden = true;
  const W = 1000, H = 380, m = { l: 72, r: 16, t: 12, b: 36 };
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const all = (bySpecies.get(current) || []);
  const pts = all.filter((r) => r.yen > 0 && !hidden.has(r.cat));
  if (!pts.length) {
    const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'tick' });
    t.textContent = all.length ? 'Brak ofert w ¥ w wybranych kategoriach' : 'Wybierz gatunek';
    svg.appendChild(t); renderOffers(all); return;
  }
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.yen);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 - x0 < 3600e3) { x0 -= 1800e3; x1 += 1800e3; }
  let y0 = Math.min(...ys) / 1.4, y1 = Math.max(...ys) * 1.4;
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) * (H - m.t - m.b);
  const grid = css('--grid');
  for (const v of niceLogTicks(y0, y1)) {
    svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: grid, 'stroke-width': 1 }));
    const t = svgEl('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'tick' }); t.textContent = compact(v) + ' ¥'; svg.appendChild(t);
  }
  svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: css('--axis'), 'stroke-width': 1 }));
  for (let i = 0; i <= 4; i++) {
    const v = x0 + (x1 - x0) * i / 4;
    const t = svgEl('text', { x: X(v), y: H - m.b + 18, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle', class: 'tick' });
    t.textContent = fmtDate(v); svg.appendChild(t);
  }
  const yl = svgEl('text', { x: 4, y: m.t + 4, class: 'tick' }); yl.textContent = 'cena (skala log.)'; svg.appendChild(yl);
  const deal = new Set(DATA.deals.filter((d) => d.species === current).map((d) => d.id));
  // Oferty z tego samego odczytu i w tej samej cenie leza w jednym miejscu -
  // rozsuwamy je w poziomie, zeby kazda byla widoczna i do najechania.
  const seen = new Map();
  for (const p of pts) {
    const key = p.ts + '|' + p.yen;
    const k = seen.get(key) || 0; seen.set(key, k + 1);
    const g = svgEl('g', { tabindex: 0, role: 'img', 'aria-label': CAT_LABEL[p.cat] + ', ' + yen(p.yen) + ', poziom ' + p.lvl });
    const cx = X(p.ts) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 12, cy = Y(p.yen);
    g.appendChild(svgEl('circle', { cx, cy, r: 12, fill: 'transparent' }));   // obszar najechania 24px
    g.appendChild(marker(p.cat, cx, cy, 5));
    if (deal.has(p.id)) { const t = svgEl('text', { x: cx + 9, y: cy - 8, class: 'tick' }); t.textContent = '▼ okazja'; g.appendChild(t); }
    const show = () => {
      tip.textContent = '';
      tip.appendChild(el('strong', {}, yen(p.yen)));
      for (const line of [CAT_LABEL[p.cat], 'Poziom ' + p.lvl + ', treningi ' + p.tr, 'Wartość (skup): ' + yen(p.val),
        'Cena/wartość: ' + (p.val ? (p.yen / p.val).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : '-'), fmtDate(p.ts)]) tip.appendChild(el('div', {}, line));
      tip.hidden = false;
      // Podpowiedz nad punktem w dolnej polowie (nie wychodzi poza wykres).
      const box = svg.getBoundingClientRect(), s = box.width / W;
      tip.style.left = Math.min(cx * s + 14, box.width - tip.offsetWidth - 4) + 'px';
      tip.style.top = (cy * s > box.height / 2 ? Math.max(cy * s - tip.offsetHeight - 10, 0) : cy * s + 10) + 'px';
    };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
    svg.appendChild(g);
  }
  renderOffers(all);
}

// Tabela ofert gatunku (najnowszy wpis kazdej oferty) - takze oferty tylko za PZ.
function renderOffers(all) {
  const t = document.getElementById('offers'); t.textContent = '';
  const latest = new Map(); for (const r of all) { const p = latest.get(r.id); if (!p || r.ts > p.ts) latest.set(r.id, r); }
  const rows = [...latest.values()].sort((a, b) => b.ts - a.ts);
  if (!rows.length) return;
  const h = t.createTHead().insertRow();
  ['Ostatnio widziana', 'Kategoria', 'Poz.', 'Tren.', 'Cena ¥', 'Cena PZ', 'Wartość (skup)', 'Cena/wartość'].forEach((x, i) => h.appendChild(el('th', i < 2 ? { class: 'l' } : {}, x)));
  const b = t.createTBody();
  for (const r of rows) {
    const tr = b.insertRow();
    [fmtDate(r.ts), CAT_LABEL[r.cat], r.lvl, r.tr, yen(r.yen), r.pz == null ? '-' : fmt(r.pz) + ' PZ', yen(r.val),
      r.yen && r.val ? (r.yen / r.val).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : '-'].forEach((v, i) => { const c = tr.insertCell(); if (i < 2) c.className = 'l'; c.textContent = v; });
  }
}

function select(sp) { current = sp; document.getElementById('sp').value = sp; draw(); document.getElementById('chart').scrollIntoView({ block: 'center' }); }
document.getElementById('sp').addEventListener('change', (e) => { if (bySpecies.has(e.target.value)) { current = e.target.value; draw(); } });
renderLegend(); renderDeals();
current = DATA.deals[0]?.species || speciesList.find((s) => bySpecies.get(s).some((r) => r.yen > 0)) || speciesList[0] || null;
if (current) document.getElementById('sp').value = current;
draw();
</script></body></html>`;
}

module.exports = { renderPokemonChartsPage };
