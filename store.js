// Living Farm event store. One versioned IndexedDB database on this device.
// Every record is an event: what happened + where (place) + when (at) + how sure we are (grade).
// No cloud, no sync. Export is a file the person keeps.

import {dbName, activeId} from './farm.js';
export const DB_NAME = dbName();
export const DB_VERSION = 1;
export const EXPORT_SCHEMA = 'seethamount-living-farm-v1';

export const GRADES = {
  measured: {t: 'Measured', d: 'Read off a gauge, tape, scale or survey', c: 'k'},
  seen:     {t: 'Seen',     d: 'Seen on the farm by the person recording', c: 'r'},
  told:     {t: 'Told',     d: 'Someone said so; not checked yet', c: 'r'},
  estimate: {t: 'Estimate', d: 'A careful guess', c: 'e'},
  model:    {t: 'Model, not measured', d: 'Computed by this app from the survey surface', c: 'p'},
  unknown:  {t: 'Not yet known', d: 'An open question', c: 'u'},
};

export const TYPES = {
  note:        {t: 'Note', i: '✎'},
  attachment:  {t: 'Uploaded file', i: '📎'},
  reading:     {t: 'Rain and well reading', i: '🌧'},
  knowledge:   {t: 'What someone knows', i: '✋'},
  task:        {t: 'Task', i: '☐'},
  'task-done': {t: 'Task done', i: '☑'},
  skip:        {t: 'Skipped stop', i: '↷'},
  trial:       {t: 'Trial card', i: '◩'},
  'trial-check': {t: 'Trial check', i: '◪'},
  'trial-feedback': {t: 'Trial lessons', i: '✎'},
  'insight': {t: 'Insight or question', i: '✦'},
  'paid-day':  {t: 'Paid day', i: '₹'},
  clip:        {t: 'Field-day clip', i: '▶'},
  capture:     {t: 'Field capture (to file)', i: '●'},
  plant:       {t: 'Plant found', i: '❦'},
  health:      {t: 'Plant health', i: '✚'},
  decision:    {t: 'Field-school decision', i: '⚑'},
  control:     {t: 'Survey point check', i: '⌖'},
  sketch:      {t: 'Map sketch', i: '✐'},
  visit:       {t: 'Stop visited', i: '✓'},
  lot:         {t: 'Harvest lot', i: '⚖'},
  input:       {t: 'Input used', i: '⛁'},
  price:       {t: 'Price board entry', i: '₹'},
  contract:    {t: 'Contract (tracker)', i: '✍'},
  payment:     {t: 'Delivery and payment', i: '⇄'},
  'stress-test': {t: 'Stress test (what if)', i: '⚖'},
  precedent:   {t: 'Precedent (own)', i: '❦'},
  'cap-profile': {t: 'Capability choices', i: '☑'},
  attendance:  {t: 'Attendance', i: '✔'},
  safety:      {t: 'Safety checklist', i: '⛑'},
  soak:        {t: 'Bucket soak test', i: '◒'},
  vision:      {t: 'Photo reading', i: '◉'},
  tree:        {t: 'Tree (register)', i: '🌳'},
  nursery:     {t: 'Nursery batch step', i: '❀'},
  plan:        {t: 'Plan row', i: '▦'},
  bloom:       {t: 'Flowering or harvest seen', i: '✿'},
  brew:        {t: 'Jeevamrutham or compost batch', i: '⚗'},
  soilpit:     {t: 'Soil pit profile', i: '▤'},
  soiltest:    {t: 'Soil test', i: '⚗'},
  ndvi:        {t: 'Greenness reading', i: '◍'},
  sensor:      {t: 'Sensor reading', i: '☍'},
  shop:        {t: 'Shop page (saved)', i: '▣'},
  scenmap:     {t: 'Scenario map layout', i: '⌖'},
  waternode:   {t: 'Water feature', i: '▣'},
  waterlink:   {t: 'Water link', i: '⇢'},
  deplink:     {t: 'Dependency confirmed', i: '⇉'},
  altver:      {t: 'Design version', i: '⎇'},
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

let db = null, memory = null, listeners = new Set();
export let storageMode = 'indexeddb';

export function open() {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return resolve(fallback(e)); }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('events')) {
        const s = d.createObjectStore('events', {keyPath: 'id'});
        s.createIndex('type', 'type'); s.createIndex('at', 'at');
      }
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', {keyPath: 'id'});
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', {keyPath: 'key'});
    };
    req.onsuccess = () => { db = req.result; resolve('indexeddb'); };
    req.onerror = () => resolve(fallback(req.error));
    req.onblocked = () => resolve(fallback(new Error('blocked')));
  });
}
function fallback(e) { console.warn('IndexedDB unavailable, keeping records in memory only', e); storageMode = 'memory'; memory = {events: new Map(), media: new Map(), meta: new Map()}; return 'memory'; }

function tx(store, mode, fn) {
  if (memory) return Promise.resolve(fn(null, memory[store]));
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function all() {
  if (memory) return [...memory.events.values()].sort(byAt);
  const out = await tx('events', 'readonly', s => reqP(s.getAll()));
  return (out || []).sort(byAt);
}
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

export function validate(e) {
  const bad = m => { throw new Error('Record not saved: ' + m); };
  if (!e || typeof e !== 'object') bad('empty');
  if (!TYPES[e.type]) bad('unknown kind ' + e.type);
  if (!GRADES[e.grade]) bad('unknown evidence grade');
  if (!e.at || !Number.isFinite(Date.parse(e.at))) bad('needs a date');
  if (e.place && !(Number.isFinite(e.place.x) && Number.isFinite(e.place.y))) bad('place needs map coordinates');
  if (e.text && e.text.length > 8000) bad('text over 8,000 characters');
  if (e.who && !e.consent) bad('a name is saved only with consent');
  return e;
}

export async function add(partial) {
  const now = new Date().toISOString();
  const e = validate({v: 1, id: uid(), createdAt: now, at: now, grade: 'seen', place: null, text: '', data: {}, media: [], ...partial});
  if (memory) memory.events.set(e.id, e); else await tx('events', 'readwrite', s => s.put(e));
  emit(); return e;
}
export async function put(e) { validate(e); if (memory) memory.events.set(e.id, e); else await tx('events', 'readwrite', s => s.put(e)); emit(); return e; }
export async function remove(id) { if (memory) memory.events.delete(id); else await tx('events', 'readwrite', s => s.delete(id)); emit(); }
export async function putMedia(m) { if (memory) memory.media.set(m.id, m); else await tx('media', 'readwrite', s => s.put(m)); return m.id; }
export async function getMedia(id) { if (memory) return memory.media.get(id) || null; return tx('media', 'readonly', s => reqP(s.get(id))); }
export async function delMedia(id) { if (memory) { memory.media.delete(id); return; } await tx('media', 'readwrite', s => s.delete(id)); }
export async function allMedia() { if (memory) return [...memory.media.values()]; return tx('media', 'readonly', s => reqP(s.getAll())); }
export async function meta(key, value) {
  if (value === undefined) { if (memory) return memory.meta.get(key)?.value; const r = await tx('meta', 'readonly', s => reqP(s.get(key))); return r?.value; }
  if (memory) memory.meta.set(key, {key, value}); else await tx('meta', 'readwrite', s => s.put({key, value}));
}
export async function clearAll() {
  if (memory) { memory.events.clear(); memory.media.clear(); memory.meta.clear(); }
  else for (const st of ['events', 'media', 'meta']) await tx(st, 'readwrite', s => s.clear());
  emit();
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const f of listeners) try { f(); } catch (e) { console.error(e); } }

/* ---------- hashing and file encoding ---------- */
export async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function blobToB64(blob) { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let n = 0; n < b.length; n += 8192) s += String.fromCharCode(...b.subarray(n, n + 8192)); return btoa(s); }
function b64ToBlob(data, type) { const bin = atob(data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type}); }

/* ---------- import: the older app's complete backup (farmer-complete-backup-v1) ---------- */
// Reads the same file the older app writes. Nothing in the older app's storage is touched.
// Checksums are verified first; if any fail, nothing is imported.
export async function previewLegacy(bundle) {
  const fail = m => { throw new Error(m); };
  if (!bundle || bundle.schema !== 'farmer-complete-backup-v1' || bundle.farmId !== 'seethamount') fail('This is not a complete Seethamount backup from the older app.');
  if (typeof bundle.profileRaw !== 'string') fail('The backup has no profile records.');
  if (await sha256(bundle.profileRaw) !== bundle.profileHash) fail('Profile checksum does not match. Nothing was imported.');
  if (await sha256(bundle.atlasRaw || '') !== bundle.atlasHash) fail('Map sketch checksum does not match. Nothing was imported.');
  if (await sha256(bundle.draftRaw || '') !== bundle.draftHash) fail('Draft checksum does not match. Nothing was imported.');
  if (bundle.labRaw !== undefined && await sha256(bundle.labRaw || '') !== bundle.labHash) fail('Lab checksum does not match. Nothing was imported.');
  let p, atlas = [];
  try { p = JSON.parse(bundle.profileRaw); } catch { fail('Profile records are unreadable.'); }
  try { atlas = bundle.atlasRaw ? JSON.parse(bundle.atlasRaw) : []; } catch { fail('Map sketches are unreadable.'); }
  const events = legacyToEvents(p, atlas, bundle);
  const photos = [];
  for (const f of bundle.photos || []) {
    const blob = b64ToBlob(f.data, f.type);
    if (await sha256(blob) !== f.sha256) fail('Photo ' + f.name + ' checksum does not match. Nothing was imported.');
    photos.push({id: 'legacy-' + f.id, name: f.name, type: f.type, size: f.bytes, blob, legacyId: f.id});
  }
  return {events, photos, summary: {
    created: bundle.createdAt, notes: (p.observations || []).length, tasks: (p.tasks || []).length, trials: (p.experiments || []).length,
    sketches: atlas.length, photos: photos.length, facts: (p.facts || []).length, paidDays: events.filter(e => e.type === 'paid-day').length}};
}

function gradeOf(o) {
  if (o.measurement && o.measurement.value !== undefined && o.measurement.value !== '') return 'measured';
  if (o.recordType === 'question') return 'unknown';
  if (o.recordType === 'hypothesis' || o.recordType === 'interpretation') return 'estimate';
  if (o.verificationStatus === 'verified') return 'seen';
  return 'told';
}
function legacyPlace(o) { const l = o.location; return l && Number.isFinite(l.x) && Number.isFinite(l.northing) ? {x: l.x, y: l.northing, label: l.label || ''} : null; }

export function legacyToEvents(p, atlas, bundle) {
  const src = (kind, id) => ({app: 'older-app', kind, id, backupCreatedAt: bundle?.createdAt || null});
  const out = [];
  for (const o of p.observations || []) {
    const base = {v: 1, id: 'legacy-obs-' + o.id, createdAt: o.createdAt, at: o.observedOn ? o.observedOn + 'T12:00:00.000Z' : o.createdAt,
      place: legacyPlace(o), grade: gradeOf(o), text: o.text, data: {topic: o.topic || '', recordType: o.recordType, status: o.status},
      media: (o.mediaIds || []).map(m => 'legacy-' + m), source: src('observation', o.id), legacy: o};
    if (o.measurement) base.data.measurement = o.measurement;
    out.push({...base, type: 'note'});
    const pp = o.purpose;
    if (pp && pp.kind === 'paid-day' && pp.paid) {
      const consent = !!pp.paid.nameConsent;
      out.push({v: 1, id: 'legacy-paid-' + o.id, createdAt: pp.updatedAt || o.createdAt, at: (pp.paid.date || o.createdAt.slice(0, 10)) + 'T12:00:00.000Z',
        type: 'paid-day', grade: 'told', place: null, text: pp.place ? 'Paid work at ' + pp.place : 'Paid work',
        data: {days: pp.paid.days, rate: pp.paid.rate, task: pp.paid.task || '', placeName: pp.place || ''},
        consent, who: consent ? pp.paid.who : '', media: [], source: src('paid-day', o.id)});
    }
  }
  for (const t of p.tasks || []) out.push({v: 1, id: 'legacy-task-' + t.id, createdAt: t.createdAt || new Date(0).toISOString(), at: t.dueOn ? t.dueOn + 'T09:00:00.000Z' : (t.createdAt || new Date(0).toISOString()),
    type: t.status === 'done' ? 'task-done' : 'task', grade: 'seen', place: legacyPlace(t), text: t.title || t.text || 'Task', data: {status: t.status, due: t.dueOn || ''}, media: [], source: src('task', t.id), legacy: t});
  for (const x of p.experiments || []) {
    const c = x.trialCard || {};
    out.push({v: 1, id: 'legacy-trial-' + x.id, createdAt: x.createdAt || new Date().toISOString(), at: (x.startOn || x.reviewOn || new Date().toISOString().slice(0, 10)) + 'T09:00:00.000Z',
      type: 'trial', grade: 'estimate', place: x.location && Number.isFinite(x.location.x) ? {x: x.location.x, y: x.location.northing, label: ''} : null,
      text: x.title, data: {question: x.question, control: c.control || '', killRule: c.killRule || '', scaleRule: c.scaleRule || '', checkDates: c.checkDates || (x.reviewOn ? [x.reviewOn] : []), status: x.status, polygon: null, controlPolygon: null},
      media: [], source: src('experiment', x.id), legacy: x});
  }
  for (const a of atlas || []) {
    const pts = a.points || []; const cx = pts.reduce((s, q) => s + q[0], 0) / Math.max(1, pts.length), cy = pts.reduce((s, q) => s + q[1], 0) / Math.max(1, pts.length);
    out.push({v: 1, id: 'legacy-sketch-' + a.id, createdAt: bundle?.createdAt || new Date().toISOString(), at: bundle?.createdAt || new Date().toISOString(),
      type: 'sketch', grade: a.status === 'observed' ? 'seen' : 'estimate', place: pts.length ? {x: cx, y: cy, label: a.name} : null, text: a.name + (a.notes ? ' · ' + a.notes : ''),
      data: {shape: a.kind, status: a.status, points: pts}, media: [], source: src('atlas', a.id), legacy: a});
  }
  return out;
}

export async function importLegacy(bundle) {
  const prev = await previewLegacy(bundle);
  const have = new Set((await all()).map(e => e.id));
  let added = 0, skipped = 0;
  for (const m of prev.photos) await putMedia(m);
  for (const e of prev.events) { if (have.has(e.id)) { skipped++; continue; } validate(e); if (memory) memory.events.set(e.id, e); else await tx('events', 'readwrite', s => s.put(e)); added++; }
  const log = (await meta('imports')) || [];
  log.push({at: new Date().toISOString(), kind: 'older-app backup', backupCreatedAt: bundle.createdAt, profileHash: bundle.profileHash, added, skipped});
  await meta('imports', log);
  // keep the older app's profile text untouched, so it can be written back out unchanged
  await meta('legacyProfileRaw', bundle.profileRaw); await meta('legacyAtlasRaw', bundle.atlasRaw);
  emit();
  return {...prev.summary, added, skipped};
}

/* ---------- export and import of this app's own open file ---------- */
export async function exportBundle() {
  const events = await all(); const media = await allMedia();
  const enc = await Promise.all(media.map(async m => ({id: m.id, name: m.name, type: m.type, bytes: m.size || m.blob.size, sha256: await sha256(m.blob), data: await blobToB64(m.blob), legacyId: m.legacyId || null})));
  const body = JSON.stringify(events);
  return {schema: EXPORT_SCHEMA, farmId: activeId, exportedAt: new Date().toISOString(), eventsHash: await sha256(body), events, media: enc,
    imports: (await meta('imports')) || [], legacyProfileRaw: (await meta('legacyProfileRaw')) || null,
    notice: 'A file on this device, not a cloud backup. Keep a copy somewhere else. Checksums catch accidental changes, not who made them.'};
}
export async function exportDay(dayISO) {
  const b = await exportBundle(); const keep = b.events.filter(e => (e.createdAt || e.at).slice(0, 10) === dayISO || e.at.slice(0, 10) === dayISO);
  const ids = new Set(keep.flatMap(e => e.media || [])); const media = b.media.filter(m => ids.has(m.id));
  return {...b, kind: 'day-file', day: dayISO, events: keep, media, eventsHash: await sha256(JSON.stringify(keep)), legacyProfileRaw: null, imports: []};
}
export async function importBundle(b) {
  if (b?.schema === 'farmer-complete-backup-v1') return {legacy: true, ...(await importLegacy(b))};
  if (b?.schema !== EXPORT_SCHEMA || b.farmId !== activeId || !Array.isArray(b.events)) throw new Error('This file is not a Living Farm or older-app Seethamount backup.');
  if (await sha256(JSON.stringify(b.events)) !== b.eventsHash) throw new Error('Records checksum does not match. Nothing was imported.');
  for (const e of b.events) validate(e);
  const media = [];
  for (const m of b.media || []) { const blob = b64ToBlob(m.data, m.type); if (await sha256(blob) !== m.sha256) throw new Error('File ' + m.name + ' checksum does not match. Nothing was imported.'); media.push({id: m.id, name: m.name, type: m.type, size: m.bytes, blob, legacyId: m.legacyId}); }
  const have = new Set((await all()).map(e => e.id)); let added = 0, skipped = 0;
  for (const m of media) await putMedia(m);
  for (const e of b.events) { if (have.has(e.id)) { skipped++; continue; } if (memory) memory.events.set(e.id, e); else await tx('events', 'readwrite', s => s.put(e)); added++; }
  if (b.legacyProfileRaw && !(await meta('legacyProfileRaw'))) await meta('legacyProfileRaw', b.legacyProfileRaw);
  emit(); return {legacy: false, added, skipped, media: media.length};
}
