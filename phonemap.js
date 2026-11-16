// Living Farm · phone map. A light contour map of the farm: your spot (GPS, or tapped), survey trees, and trees you mark.
// Contours are drawn from the surveyed 1 m grid (model, not measured). The survey frame is assumed WGS84 until 3 GPS points are walked.
import * as St from './store.js';
import {gpsToFarm, file as fileText, PLANTS as FPLANTS} from './filer.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const E0 = 631050, N0 = 1309585, PX = 4;          // farm frame origin (same as filer.js FRAME), offscreen pixels per metre
const M = {ready: false, grid: null, boundary: [], survey: [], plants: [], own: [], view: {k: 1, ox: 0, oy: 0}, pick: null, spot: null, gps: null, watch: null, off: null, bb: null};
export const state = M;

export async function loadData() {
  if (M.grid) return;
  const [csv, ter, trees, plants] = await Promise.all([
    fetch('data/terrain-grid.csv').then(r => r.ok ? r.text() : ''), fetch('data/terrain.json').then(r => r.ok ? r.json() : null),
    fetch('data/survey-trees.json').then(r => r.ok ? r.json() : null), fetch('data/plants.json').then(r => r.ok ? r.json() : null)]);
  const rows = csv.trim().split('\n').slice(1).map(l => l.split(',')).filter(a => a.length > 3).map(a => ({x: +a[0] - E0, y: +a[1] - N0, z: +a[2]}));
  M.grid = rows; M.boundary = (ter?.boundary || []).map(p => ({x: p[0], y: p[1]}));
  M.survey = (trees?.records || []).filter(r => r.insideCandidateBoundary).map(r => ({id: r.id, x: r.x, y: r.northing, key: r.speciesKey, label: r.label}));
  M.colors = Object.fromEntries((trees?.species || []).map(s => [s.key, s.color]));
  M.plants = (plants?.plants || []).slice().sort((a, b) => a.en.localeCompare(b.en));
  if (rows.length) { const xs = rows.map(r => r.x), ys = rows.map(r => r.y); M.bb = {x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1}; prerender(); }
}

/* contour image: tint by height, a line where the whole metre changes, darker every 5 m. Model from the survey grid, not measured. */
function prerender() {
  const b = M.bb, W = Math.ceil((b.x1 - b.x0) * PX), H = Math.ceil((b.y1 - b.y0) * PX);
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d'); g.fillStyle = '#f6f5ef'; g.fillRect(0, 0, W, H);
  const zs = M.grid.map(r => r.z), zmin = Math.min(...zs), zmax = Math.max(...zs), at = new Map();
  for (const r of M.grid) { at.set(Math.round(r.x - 0.5) + ',' + Math.round(r.y - 0.5), r.z); const t = (r.z - zmin) / ((zmax - zmin) || 1); g.fillStyle = `hsl(${95 - 45 * t} ${38 - 8 * t}% ${88 - 26 * t}%)`; g.fillRect((r.x - 0.5 - b.x0) * PX, (b.y1 - (r.y + 0.5)) * PX, PX + 0.5, PX + 0.5); }
  for (const r of M.grid) {
    const kx = Math.round(r.x - 0.5), ky = Math.round(r.y - 0.5), px = (r.x - 0.5 - b.x0) * PX, py = (b.y1 - (r.y + 0.5)) * PX;
    const edge = (n, vx, vy, w, h) => { if (n == null) return; const a = Math.floor(r.z), bb = Math.floor(n); if (a === bb) return; const lv = Math.max(a, bb); g.fillStyle = lv % 5 === 0 ? 'rgba(80,50,20,.85)' : 'rgba(120,85,45,.45)'; g.fillRect(vx, vy, w, h); };
    edge(at.get((kx + 1) + ',' + ky), px + PX - 0.5, py, lv5(r), PX); edge(at.get(kx + ',' + (ky - 1)), px, py + PX - 0.5, PX, lv5(r));
  }
  M.off = c; M.z = {min: zmin, max: zmax};
}
const lv5 = () => 1;

/* ---------- view ---------- */
function fit(cv) { const b = M.bb, w = b.x1 - b.x0, h = b.y1 - b.y0; const k = Math.min(cv.width / w, cv.height / h); M.view = {k, ox: (cv.width - w * k) / 2 - b.x0 * k, oy: (cv.height - h * k) / 2 + b.y1 * k}; }
const toScr = (x, y) => [x * M.view.k + M.view.ox, M.view.oy - y * M.view.k];
const toFarm = (sx, sy) => [(sx - M.view.ox) / M.view.k, (M.view.oy - sy) / M.view.k];

function draw() {
  const cv = $('#mmCv'); if (!cv || !M.off) return; const g = cv.getContext('2d'), b = M.bb, k = M.view.k;
  g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = '#e9e7da'; g.fillRect(0, 0, cv.width, cv.height);
  g.imageSmoothingEnabled = true; g.drawImage(M.off, b.x0 * k + M.view.ox, M.view.oy - b.y1 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
  if (M.boundary.length) { g.beginPath(); M.boundary.forEach((p, i) => { const [x, y] = toScr(p.x, p.y); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.strokeStyle = '#254f3d'; g.lineWidth = 2; g.setLineDash([8, 5]); g.stroke(); g.setLineDash([]); }
  const r = Math.max(2.5, Math.min(7, k * 0.9));
  for (const t of M.survey) { const [x, y] = toScr(t.x, t.y); g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = (M.colors[t.key] || '#597b45') + 'cc'; g.fill(); }
  for (const t of M.own) { const [x, y] = toScr(t.x, t.y); g.beginPath(); g.arc(x, y, r + 2.5, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#1f7a3a'; g.stroke(); g.beginPath(); g.arc(x, y, r - 1, 0, 7); g.fillStyle = '#1f7a3a'; g.fill(); }
  for (const q of M.tent || []) { const [x, y] = toScr(q.x, q.y); g.beginPath(); g.arc(x, y, r + 4, 0, 7); g.setLineDash([4, 3]); g.lineWidth = 2.5; g.strokeStyle = '#b4691f'; g.stroke(); g.setLineDash([]); g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#b4691f'; g.fillText('?', x, y + 4); }
  for (const c of M.caps || []) { const [x, y] = toScr(c.x, c.y); g.fillStyle = '#c0661b'; g.fillRect(x - 5, y - 5, 10, 10); g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x - 5, y - 5, 10, 10); }
  const dot = (p, col, ring) => { const [x, y] = toScr(p.x, p.y); if (ring) { g.beginPath(); g.arc(x, y, Math.max(8, ring * k), 0, 7); g.fillStyle = col + '22'; g.fill(); } g.beginPath(); g.arc(x, y, 8, 0, 7); g.fillStyle = col; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); };
  if (M.gps?.farm?.inside) dot(M.gps.farm, '#1a6fd1', M.gps.acc);
  if (M.spot) dot(M.spot, '#7a3dc9');
  if (M.pick) { const [x, y] = toScr(M.pick.x, M.pick.y); g.strokeStyle = '#b23a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.moveTo(x, y - 14); g.lineTo(x, y + 14); g.stroke(); g.beginPath(); g.arc(x, y, 10, 0, 7); g.stroke(); }
}

/* ---------- GPS: used where the page may ask for it; otherwise the owner taps "I'm here" ---------- */
function startGps() {
  if (!navigator.geolocation) { M.gpsState = 'none'; return paintStatus(); }
  M.gpsState = 'looking';
  try {
    M.watch = navigator.geolocation.watchPosition(pos => { const c = pos.coords, f = gpsToFarm(c.latitude, c.longitude); M.gps = {farm: f, acc: Math.round(c.accuracy)}; M.gpsState = f.inside ? 'ok' : 'off'; paintStatus(); draw(); },
      e => { M.gpsState = e.code === 1 ? 'denied' : 'none'; paintStatus(); }, {enableHighAccuracy: true, maximumAge: 2000, timeout: 30000});
  } catch { M.gpsState = 'none'; paintStatus(); }
}
export function stopGps() { if (M.watch != null) navigator.geolocation?.clearWatch(M.watch); M.watch = null; }
function paintStatus() {
  const el = $('#mmStatus'); if (!el) return; const s = M.gpsState;
  el.innerHTML = s === 'ok' ? `<b>📍 Blue dot is you</b> · GPS ±${M.gps.acc} m (model, not measured; the survey frame is assumed WGS84 until 3 GPS points are walked)`
    : s === 'off' ? '<b>You seem to be off the surveyed farm.</b> Tap the map to place a spot by hand.'
    : s === 'looking' ? '<b>Finding your spot…</b> You can also tap the map and press “I’m here”.'
    : '<b>GPS is not available in this view.</b> Tap the map where you stand and press “I’m here” (purple dot, told by you).';
}

/* ---------- own tree records ---------- */
export async function loadOwn() { const ev = await St.all(); M.own = ev.filter(e => e.type === 'tree' && e.place).map(e => ({id: e.id, x: e.place.x, y: e.place.y, name: e.data?.name || e.text, h: e.data?.h})); M.tent = tentative(ev); M.caps = ev.filter(e => e.type === 'capture' && e.place && e.media?.length).map(e => ({id: e.id, x: e.place.x, y: e.place.y, text: e.text, at: e.at})); }
/* Possible trees from records: a spot-tagged record with plant words, or a free photo/video/voice record, that is not a stop about a wall, tank or well.
   These are guesses from the owner's own words and spots: drawn dashed, never counted as trees until the owner confirms. */
const DISMISS = 'lf-dismissed-trees';
const dismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISS) || '[]'); } catch { return []; } };
function tentative(ev) {
  const gone = new Set(dismissed()), done = new Set(ev.filter(e => e.type === 'tree').map(e => e.data?.fromCapture).filter(Boolean)), out = [];
  for (const e of ev) {
    if (e.type !== 'capture' || !e.place || gone.has(e.id) || done.has(e.id) || e.data?.stopId) continue;
    const hint = e.data?.hint || ''; if (!['', 'Plant', 'Problem', 'Something else'].includes(hint)) continue;
    const f = e.text ? fileText(e.text) : null, key = f?.plants?.[0] || null;
    if (!key && !e.media?.length) continue;
    if (M.own.some(o => Math.hypot(o.x - e.place.x, o.y - e.place.y) < 1.5)) continue;
    const sv = nearest(e.place.x, e.place.y, M.survey, 3);
    out.push({id: e.id, x: e.place.x, y: e.place.y, text: e.text || '', at: e.at, key, guess: key ? FPLANTS[key]?.en : '', sv});
  }
  return out;
}
const matchPlant = en => en ? M.plants.find(pl => pl.en.toLowerCase().includes(en.toLowerCase()) || en.toLowerCase().includes(pl.en.toLowerCase())) : null;
const nearest = (x, y, list, maxM) => { let best = null, bd = maxM; for (const t of list) { const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } } return best; };
const hazardNote = p => !p ? '' : p.hazard ? `⚠ ${esc(p.hazard.level)}: ${esc(p.hazard.who)}${p.hazard.part ? ' (' + esc(p.hazard.part) + ')' : ''}` : 'Safety: not yet checked';

function paintPanel() {
  const el = $('#mmPanel'); if (!el) return; const p = M.pick;
  if (!p) { el.innerHTML = `<p class="p-small">Tap the map to choose a spot. Tap a grey-green dot to see a survey tree. Green rings are trees you have marked; orange squares are photos and videos; dashed rings with a ? are possible trees from your records.</p>`; return; }
  const sv = p.survey;
  el.innerHTML = `<div class="mm-card"><b>${sv ? 'Survey tree: ' + esc(sv.label) : 'Mark a tree here'}</b>
    <small>x ${p.x.toFixed(1)} m, y ${p.y.toFixed(1)} m from the survey origin${sv ? ' · survey symbol, not field-verified' : ''}</small>
    <label class="p-lbl">Which tree?<select id="mmSp"><option value="">Not sure yet</option>${M.plants.map(pl => `<option value="${esc(pl.k)}">${esc(pl.en)} · ${esc(pl.ml)} · ${esc(pl.sci)}</option>`).join('')}</select></label>
    <p class="p-small" id="mmHz"></p>
    <label class="p-lbl">Height in metres (optional, your estimate)<input id="mmH" inputmode="decimal" placeholder="e.g. 6"></label>
    <label class="p-lbl">Note (optional)<input id="mmNote" placeholder="${sv ? 'Is it there? Is it this species?' : 'e.g. self-grown, leaning, fruiting'}"></label>
    <div class="mm-row"><button class="p-save" id="mmSave">${sv ? 'Confirm I saw it' : 'Save tree'}</button><button id="mmClr">Cancel</button></div></div>`;
  const sel = $('#mmSp'); sel.onchange = () => { $('#mmHz').textContent = hazardNote(M.plants.find(x => x.k === sel.value)); };
  $('#mmClr').onclick = () => { M.pick = null; paintPanel(); draw(); };
  $('#mmSave').onclick = saveTree;
}
async function saveTree() {
  const p = M.pick; if (!p) return; const pl = M.plants.find(x => x.k === $('#mmSp').value), hv = parseFloat($('#mmH').value), note = $('#mmNote').value.trim();
  const name = pl ? pl.en : p.survey ? p.survey.label : 'Tree (species not known)';
  const place = {x: +p.x.toFixed(1), y: +p.y.toFixed(1), label: 'Marked on phone map'};
  try {
    await St.add({type: 'tree', grade: 'seen', text: [name, note].filter(Boolean).join(': '), place,
      data: {key: pl?.k || '', name, status: 'alive', planted: '', source: p.survey ? 'confirmed on phone map (survey symbol ' + p.survey.id + ')' : 'marked on phone map',
        ...(Number.isFinite(hv) ? {h: hv, hBasis: 'estimate (owner guess)'} : {}), speciesBasis: pl ? 'told (owner chose it)' : 'unknown', positionBasis: p.how === 'spot' ? 'told (owner placed my spot)' : p.how === 'gps' ? 'model (GPS, frame assumed)' : 'seen (tapped on map)'}});
  } catch (e) { return toast(e.message); }
  M.pick = null; await loadOwn(); paintPanel(); paintList(); draw(); toast('Tree saved' + (pl ? '' : ' (species not known)'));
}
function paintList() { const el = $('#mmCount'); if (el) el.textContent = `${M.own.length} marked by you · ${M.survey.length} on the survey sheet` + (M.tent?.length ? ` · ${M.tent.length} possible tree${M.tent.length === 1 ? '' : 's'} from your records (dashed, tap to confirm)` : ''); }
function toast(m) { const t = $('#pToast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3000); }

/* ---------- screen ---------- */
export async function openMap(back) {
  const main = $('#pMain'); main.innerHTML = '<p class="p-small">Opening the map…</p>';
  try { await loadData(); await loadOwn(); } catch (e) { main.innerHTML = `<p class="p-small">The map data did not load: ${esc(e.message)}</p><button id="mmBack">← Back</button>`; $('#mmBack').onclick = back; return; }
  if (!M.off) { main.innerHTML = '<p class="p-small">No terrain data is loaded for this farm yet, so there is no contour map to show.</p><button id="mmBack">← Back</button>'; $('#mmBack').onclick = back; return; }
  main.innerHTML = `<header class="p-dh"><button id="mmBack" aria-label="Back">←</button><h2>Farm map</h2></header>
    <div class="mm-wrap"><canvas id="mmCv" aria-label="Contour map of the farm"></canvas>
      <div class="mm-btns"><button id="mmIn" aria-label="Zoom in">+</button><button id="mmOut" aria-label="Zoom out">−</button><button id="mmFit" aria-label="Whole farm">⤢</button></div></div>
    <p class="p-small" id="mmStatus"></p>
    <div class="mm-row"><button id="mmHere">📍 I’m here</button><button id="mmMark">🌳 Mark a tree at my spot</button></div>
    <div id="mmPanel"></div><p class="p-small" id="mmCount"></p>
    <p class="p-small">Contour lines are every 1 metre (darker every 5 m), drawn from the 27 March 2026 survey grid: model, not measured. Elevation here is about ${M.z.min.toFixed(0)}–${M.z.max.toFixed(0)} m.</p>`;
  const cv = $('#mmCv'), W = Math.min(main.clientWidth || 360, 560); cv.width = W; cv.height = Math.round(W * 1.05); cv.style.width = W + 'px'; cv.style.height = cv.height + 'px'; fit(cv);
  $('#mmBack').onclick = () => { stopGps(); back(); };
  const zoom = (f, cx = cv.width / 2, cy = cv.height / 2) => { const [fx, fy] = toFarm(cx, cy); M.view.k = Math.max(1, Math.min(40, M.view.k * f)); M.view.ox = cx - fx * M.view.k; M.view.oy = cy + fy * M.view.k; draw(); };
  $('#mmIn').onclick = () => zoom(1.5); $('#mmOut').onclick = () => zoom(1 / 1.5); $('#mmFit').onclick = () => { fit(cv); draw(); };
  const ptr = new Map(); let moved = 0, pd = 0;
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.offsetX, e.offsetY]); moved = 0; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pd = Math.hypot(a[0] - b[0], a[1] - b[1]); } };
  cv.onpointermove = e => { if (!ptr.has(e.pointerId)) return; const o = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptr.size === 2) { const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pd) zoom(d / pd, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pd = d; moved = 99; }
    else { const dx = e.offsetX - o[0], dy = e.offsetY - o[1]; moved += Math.abs(dx) + Math.abs(dy); if (moved > 8) { M.view.ox += dx; M.view.oy += dy; draw(); } } };
  cv.onpointerup = e => { const was = ptr.size; ptr.delete(e.pointerId); if (was === 1 && moved <= 8) tap(e.offsetX, e.offsetY); pd = 0; };
  cv.onpointercancel = e => { ptr.delete(e.pointerId); };
  $('#mmHere').onclick = () => { if (M.gpsState === 'ok' && M.gps) { M.spot = null; toast('Using GPS for your spot'); return; } if (!M.pick) return toast('Tap the map where you stand first'); M.spot = {x: M.pick.x, y: M.pick.y}; M.pick = null; paintPanel(); draw(); toast('Your spot is set (purple dot)'); };
  $('#mmMark').onclick = () => { const s = M.gpsState === 'ok' && M.gps ? {x: M.gps.farm.x, y: M.gps.farm.y, how: 'gps'} : M.spot ? {...M.spot, how: 'spot'} : null; if (!s) return toast('Set your spot first: tap the map and press “I’m here”'); M.pick = s; paintPanel(); draw(); };
  paintStatus(); paintPanel(); paintList(); draw(); startGps();
}
function showTent(q) {
  M.pick = null; const pl = matchPlant(q.guess);
  $('#mmPanel').innerHTML = `<div class="mm-card"><b>🌿 Possible tree (not confirmed)</b>
    <small>From your record on ${esc(q.at.slice(0, 10))}${q.text ? ': “' + esc(q.text) + '”' : ' (no words)'}.</small>
    <small>${q.guess ? 'Guessed from your words: ' + esc(q.guess) + ' (model guess).' : 'Species not known.'}${q.sv ? ' Near survey tree: ' + esc(q.sv.label) + ' (survey symbol, not field-verified).' : ''}</small>
    <div class="mm-row"><button class="p-save" id="mmYes">Yes, it's a tree</button><button id="mmNo">No, dismiss</button></div></div>`;
  $('#mmNo').onclick = async () => { try { localStorage.setItem(DISMISS, JSON.stringify([...dismissed(), q.id])); } catch {} await loadOwn(); paintPanel(); paintList(); draw(); toast('Dismissed'); };
  $('#mmYes').onclick = async () => {
    const name = pl ? pl.en : q.guess || (q.sv ? q.sv.label : 'Tree (species not known)');
    await St.add({type: 'tree', grade: 'seen', text: name, place: {x: q.x, y: q.y, label: 'Confirmed from a phone record'}, data: {key: pl?.k || '', name, status: 'alive', planted: '', source: 'confirmed from phone record ' + q.id, fromCapture: q.id, speciesBasis: pl ? 'told (from your own words)' : 'unknown', positionBasis: 'model (GPS, frame assumed)'}});
    await loadOwn(); paintPanel(); paintList(); draw(); toast('Tree saved' + (pl ? '' : ' (species not known)'));
  };
  draw();
}
function tap(sx, sy) {
  const [x, y] = toFarm(sx, sy), reach = Math.max(1.5, 14 / M.view.k);
  const tq = nearest(x, y, M.tent || [], reach); if (tq) return showTent(tq);
  const cap = nearest(x, y, M.caps || [], reach), own = !cap && nearest(x, y, M.own, reach), sv = !cap && !own && nearest(x, y, M.survey, reach);
  if (cap) { M.pick = null; $('#mmPanel').innerHTML = `<div class="mm-card"><b>📷 Photo or video record</b><small>${esc(cap.at.slice(0, 10))} · ${esc(cap.text || 'no words')}</small></div>`; draw(); return; }
  if (own) { M.pick = null; $('#mmPanel').innerHTML = `<div class="mm-card"><b>Your tree: ${esc(own.name)}</b><small>${own.h ? 'About ' + esc(own.h) + ' m (your estimate)' : 'Height not recorded'}</small></div>`; draw(); return; }
  M.pick = sv ? {x: sv.x, y: sv.y, survey: sv, how: 'tap'} : {x, y, how: 'tap'}; paintPanel(); draw();
}
