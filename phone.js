// Living Farm · phone recorder. Light on purpose: one Record button, GPS by itself, photo, video, voice.
// No map engine, no 3D, no AI. Records stay on the phone until you send the day's file to yourself.
import * as St from './store.js';
import {gpsToFarm, file as fileText} from './filer.js';
import {PLACES, QUESTIONS, WALK, nearName} from './places.js';
import {readGps} from './exif.js';
import * as MAP from './phonemap.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const P = {events: [], draft: null, gps: null, watch: null, rec: null, speech: null, lang: 'ml-IN', heading: null};
const today = () => { const q = new URLSearchParams(location.search).get('date'); if (q) return q; const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dn = iso => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 864e5);

/* ---------- GPS: watch for up to 20 s, keep the best readings, average them ---------- */
function startGPS() {
  P.gps = {fixes: [], status: 'looking'}; paintGPS();
  if (!navigator.geolocation) { P.gps.status = 'none'; paintGPS(); return; }
  const stopAt = Date.now() + 20000;
  P.watch = navigator.geolocation.watchPosition(pos => {
    const c = pos.coords; P.gps.fixes.push({lat: c.latitude, lon: c.longitude, acc: c.accuracy});
    const best = Math.min(...P.gps.fixes.map(f => f.acc)); const good = P.gps.fixes.filter(f => f.acc <= best + 5);
    const lat = good.reduce((s, f) => s + f.lat, 0) / good.length, lon = good.reduce((s, f) => s + f.lon, 0) / good.length;
    P.gps.fix = {lat, lon, acc: Math.round(best / Math.sqrt(good.length) * 10) / 10, n: good.length};
    P.gps.farm = gpsToFarm(lat, lon); P.gps.status = 'ok'; paintGPS();
    if (Date.now() > stopAt || (best <= 5 && good.length >= 5)) stopGPS();
  }, err => { P.gps.status = err.code === 1 ? 'denied' : 'none'; paintGPS(); stopGPS(); }, {enableHighAccuracy: true, maximumAge: 0, timeout: 20000});
}
function stopGPS() { if (P.watch != null) navigator.geolocation.clearWatch(P.watch); P.watch = null; }
function paintGPS() {
  const el = $('#pGps'); if (!el) return; const g = P.gps;
  el.className = 'p-gps ' + (g.status === 'ok' ? (g.farm.inside || g.farm.x == null ? 'ok' : 'off') : g.status);
  el.innerHTML = g.status === 'looking' ? '<b>Finding your spot…</b><small>Stand still for a few seconds</small>' :
    g.status === 'denied' ? '<b>Location is off</b><small>The record is saved without a spot. Allow location for this site to add one.</small>' :
    g.status === 'none' ? '<b>No GPS here</b><small>The record is saved without a spot.</small>' :
    g.farm.x == null ? `<b>📍 Spot saved</b><small>GPS ±${g.fix.acc} m · ${g.fix.n} reading${g.fix.n > 1 ? 's' : ''} averaged. It goes on your farm map when the map arrives.</small>` :
    g.farm.inside ? `<b>📍 ${esc(nearName(g.farm.x, g.farm.y))}</b><small>GPS ±${g.fix.acc} m · ${g.fix.n} reading${g.fix.n > 1 ? 's' : ''} averaged</small>` :
    `<b>You seem to be off the surveyed farm</b><small>GPS ±${g.fix.acc} m. Saved with the raw GPS; the web app can place it once the map is lined up.</small>`;
}

/* ---------- compass heading for photos (optional) ---------- */
function listenHeading() {
  const h = e => { const v = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null); if (v != null) P.heading = Math.round(v); };
  addEventListener('deviceorientationabsolute', h); addEventListener('deviceorientation', h);
}

/* ---------- photos: shrink to about 1600 px so a day's file stays small ---------- */
async function shrink(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const img = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = new OffscreenCanvas(Math.round(img.width * k), Math.round(img.height * k)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const b = await c.convertToBlob({type: 'image/jpeg', quality: 0.8}); return new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', {type: 'image/jpeg', lastModified: file.lastModified});
  } catch { return file; }
}

/* ---------- voice: record audio; live words where the phone offers speech typing ---------- */
async function dictToggle() {
  const d = P.draft, dict = P.dict;
  if (P.dictOn) { try { await dict.stop(); } catch {} return; }
  if (!P.dictBound) { P.dictBound = true; dict.onFinal(({text}) => { if (!P.draft) return; P.draft.text = (P.draft.text ? P.draft.text + ' ' : '') + text; const ta = $('#pText'); if (ta) { ta.value = P.draft.text; ta.dispatchEvent(new Event('input')); } });
    dict.onState(({state}) => { P.dictOn = state === 'listening'; const b = $('#pSpeak'); if (b) { b.classList.toggle('on', P.dictOn); b.innerHTML = (P.dictOn ? '■' : '🗣') + '<span>' + (P.dictOn ? 'Stop' : 'Speak') + '</span>'; } }); }
  dict.start().catch(e => toast(e?.code === 'not_granted' || /not_granted/.test(String(e)) ? 'Voice to text was declined. Type a note instead.' : 'Voice to text did not start. Type a note instead.'));
}
/* Many photos: an in-page camera that stays open. Each tap of the shutter adds a photo to the record and keeps it safe straight away. */
async function manyPhotos() {
  const d = P.draft; d.text = $('#pText')?.value ?? d.text;
  let stream, cam = 'environment';
  const ov = document.createElement('div'); ov.id = 'pCam'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Camera');
  ov.innerHTML = `<video id="pCamV" autoplay playsinline muted></video><div class="pc-bar"><button id="pcFlip" aria-label="Switch camera">⟲</button><button id="pcShot" aria-label="Take photo"></button><button id="pcDone">Done</button></div><div class="pc-n" id="pcN" aria-live="polite">0 photos</div>`;
  document.body.append(ov); let n = 0;
  const open = async () => { try { stream?.getTracks().forEach(x => x.stop()); stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: cam, width: {ideal: 4096}}, audio: false}); $('#pCamV').srcObject = stream; return true; } catch { return false; } };
  if (!navigator.mediaDevices?.getUserMedia || !(await open())) { ov.remove(); toast('The camera is blocked for this site. Use the Photo button instead.'); return; }
  const done = () => { stream?.getTracks().forEach(x => x.stop()); ov.remove(); paintDraft(); };
  $('#pcDone').onclick = done; $('#pcFlip').onclick = async () => { cam = cam === 'environment' ? 'user' : 'environment'; await open(); };
  $('#pcShot').onclick = async () => {
    const v = $('#pCamV'); let file = null;
    try { const tr = stream.getVideoTracks()[0]; if (window.ImageCapture) { const blob = await new ImageCapture(tr).takePhoto(); file = new File([blob], `photo-${Date.now()}.jpg`, {type: blob.type || 'image/jpeg'}); } } catch {}
    if (!file) { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); if (blob) file = new File([blob], `photo-${Date.now()}.jpg`, {type: 'image/jpeg'}); }
    if (!file) return toast('The photo did not save. Try again.');
    const s = await shrink(file); const m = {kind: 'photo', file: s, url: URL.createObjectURL(s), heading: P.heading, tag: null}; d.media.push(m); await keepMedia(m);
    n++; $('#pcN').textContent = n + (n === 1 ? ' photo saved' : ' photos saved'); ov.classList.add('flash'); setTimeout(() => ov.classList.remove('flash'), 120);
  };
}

/* Speak: the phone turns your voice into words while you talk (Chrome speech typing). Words only, no audio kept; the microphone is used by this alone. */
const SRC = () => window.SpeechRecognition || window.webkitSpeechRecognition;
function speakPaint() { const b = $('#pSpeak'); if (!b) return; b.classList.toggle('on', !!P.speakOn); b.innerHTML = (P.speakOn ? '■' : '🗣') + '<span>' + (P.speakOn ? 'Stop' : 'Speak') + '</span>'; }
function speakToggle() {
  if (P.dict) return dictToggle();
  if (P.speakOn) { P.speakOn = false; try { P.speech?.stop(); } catch {} speakPaint(); return; }
  const SR = SRC(); if (!SR) return toast('Speech to words is not available in this browser. Use Chrome, or type a note, or Record audio.');
  const s = new SR(); s.lang = P.lang; s.continuous = true; s.interimResults = true; P.speech = s; P.speakOn = true; const base = () => P.draft.text || '';
  s.onresult = e => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) P.draft.text = (base() ? base() + ' ' : '') + r[0].transcript.trim(); else interim += r[0].transcript; }
    const ta = $('#pText'); if (ta) ta.value = base() + (interim ? (base() ? ' ' : '') + interim : ''); stash(); const sg = $('#pSug'); if (sg) sg.textContent = sugText(base() ? fileText(base()).proposals.map(p => p.label) : []); };
  s.onerror = e => { const c = e.error; if (c === 'no-speech' || c === 'aborted') return; P.speakOn = false; speakPaint(); toast(c === 'not-allowed' || c === 'service-not-allowed' ? 'The microphone is blocked for this site. Allow it in the browser, or type a note.' : c === 'network' ? 'Speech to words needs internet. Type a note, or Record audio.' : 'Speech to words stopped (' + c + '). Type a note instead.'); };
  s.onend = () => { if (P.speakOn && P.draft) { try { s.start(); } catch { P.speakOn = false; } } else P.speakOn = false; speakPaint(); };
  try { s.start(); } catch { P.speakOn = false; toast('Could not start speech to words.'); }
  speakPaint();
}
async function voiceToggle() {
  if (P.rec) { P.rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    const chunks = []; const r = new MediaRecorder(stream); P.rec = r; const t0 = Date.now();
    r.ondataavailable = e => e.data.size && chunks.push(e.data);
    r.onstop = () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(chunks, {type: r.mimeType || 'audio/webm'});
      const m = {kind: 'voice', file: new File([blob], `voice-${Date.now()}.webm`, {type: blob.type}), secs: Math.round((Date.now() - t0) / 1000)}; P.draft.media.push(m); P.rec = null; keepMedia(m).then(paintDraft); paintDraft(); };
    r.start();
    paintDraft();
  } catch { toast('The microphone is blocked. Type a note instead.'); }
}

/* ---------- draft that survives the phone closing the page while the camera is open ---------- */
const DK = 'lf-draft';
async function keepMedia(m) {
  m.draftId = 'draft-' + crypto.randomUUID();
  try { await St.putMedia({id: m.draftId, name: m.file.name, type: m.file.type, size: m.file.size, blob: m.file, kind: m.kind, heading: m.heading ?? null, draft: true}); } catch {}
  stash();
}
function stash() {
  const d = P.draft; if (!d) return;
  try { localStorage.setItem(DK, JSON.stringify({text: d.text || '', hint: d.hint || '', stop: d.stop ? {id: d.stop.id, title: d.stop.title, ask: d.stop.ask, hint: d.stop.hint} : null,
    media: d.media.filter(m => m.draftId).map(m => ({id: m.draftId, kind: m.kind, secs: m.secs ?? null, tag: m.tag || null, heading: m.heading ?? null}))})); } catch {}
}
async function dropDraft(keepIds = []) {
  let s = null; try { s = JSON.parse(localStorage.getItem(DK) || 'null'); localStorage.removeItem(DK); } catch {}
  for (const m of s?.media || []) if (!keepIds.includes(m.id)) { try { await St.delMedia(m.id); } catch {} }
}
async function restoreDraft() {
  let s = null; try { s = JSON.parse(localStorage.getItem(DK) || 'null'); } catch {}
  if (!s || (!s.text && !s.media?.length)) return null;
  const media = [];
  for (const m of s.media || []) { const r = await St.getMedia(m.id).catch(() => null); if (!r?.blob) continue; const file = new File([r.blob], r.name, {type: r.type}); media.push({kind: m.kind, file, url: m.kind === 'photo' ? URL.createObjectURL(file) : undefined, secs: m.secs, tag: m.tag, heading: m.heading, draftId: m.id}); }
  return {media, text: s.text || '', hint: s.hint || '', stop: s.stop};
}

/* ---------- screens ---------- */
function toast(m) { const t = $('#pToast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500); }
function home() {
  const d = today(); const mine = P.events.filter(e => (e.createdAt || e.at).slice(0, 10) === d && e.type === 'capture');
  const stops = phoneStops(d);
  $('#pMain').innerHTML = `
   <button class="p-rec" id="pRec" aria-label="Record">●<span>Record</span></button>
   <p class="p-hint">Photo, video or voice. Your spot is added by itself.</p>
   ${P.saved ? `<button class="p-mapbtn" id="pCont">↩ Continue your unsaved record (${P.saved.media.length} file${P.saved.media.length === 1 ? '' : 's'}${P.saved.text ? ', words' : ''})</button>` : ''}
   <button class="p-mapbtn" id="pMap">🗺 Farm map · mark trees</button>
   <section><h2>Today's stops</h2>${stops.map((s, n) => `<div class="p-stop"><b>${n + 1}</b><div><strong>${esc(s.title)}</strong><small>${esc(s.ask)}</small></div><button data-stop="${n}">Record</button></div>`).join('') || '<p class="p-small">Nothing due today.</p>'}</section>
   <section><h2>Saved today · ${mine.length}</h2>${mine.slice().reverse().map(e => `<div class="p-item"><span>${e.media.length ? '📷' : '✎'}</span><div>${esc(e.text || (e.data.mediaKinds || []).join(', ') || 'Record')}<small>${new Date(e.createdAt).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})} · ${e.place ? esc(e.place.label) : 'no spot'}${e.data.hint ? ' · ' + esc(e.data.hint) : ''}</small></div></div>`).join('') || '<p class="p-small">Nothing yet today.</p>'}</section>
   <button class="p-send" id="pSend" ${mine.length ? '' : 'disabled'}>Send today's file to yourself</button>
   <button class="p-mapbtn" id="pCopy" ${P.events.length ? '' : 'disabled'}>Copy today's notes as text</button>
   <p class="p-small">The file goes wherever you choose (WhatsApp to yourself, email or Drive). Open it in the web app under Records. Nothing is sent by itself.</p>`;
  $('#pRec').onclick = () => openDraft();
  $('#pMap').onclick = () => MAP.openMap(home);
  if ($('#pCont')) $('#pCont').onclick = () => { P.draft = P.saved; P.saved = null; startGPS(); paintDraft(); };
  document.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => openDraft(stops[+b.dataset.stop]));
  $('#pSend').onclick = sendDay;
  $('#pCopy').onclick = copyNotes;
}
function phoneStops(d) {
  const seen = id => P.events.some(e => e.data?.stopId === id && dn(d) - dn(e.at) < 21);
  const out = []; const lastWell = P.events.filter(e => e.data?.hint === 'Well reading').map(e => e.at).sort().pop();
  if (!lastWell || dn(d) - dn(lastWell) >= 6) out.push({id: 'well-' + d, title: 'Weekly well reading', ask: 'Metres down to water. Say it or type it.', hint: 'Well reading'});
  for (const q of QUESTIONS) if (!seen(q.id) && out.length < 3) out.push({id: q.id, title: q.title, ask: q.ask});
  for (const w of WALK) if (!seen('walk-' + w.n) && out.length < 3) out.push({id: 'walk-' + w.n, title: 'Walk stop ' + w.n + ': ' + w.name, ask: 'Look, then record what you see.'});
  return out.slice(0, 3);
}
function openDraft(stop) { dropDraft(); P.saved = null; P.draft = {media: [], text: '', hint: stop?.hint || '', stop: stop || null}; startGPS(); paintDraft(); }
/* Keyword filing from the words (typed or spoken). A guess from keywords: shown, tagged on save, never a fact; you confirm in the web app. */
const HINT_OF = {reading: 'Well reading', health: 'Problem', plant: 'Plant', task: 'Task'};
function autoHint(text) { if (!text) return ''; const k = fileText(text).proposals.map(p => p.kind); for (const x of ['reading', 'health', 'plant', 'task']) if (k.includes(x)) return HINT_OF[x]; return ''; }
const sugText = sug => sug.length ? `Heard: ${sug.join(' · ')}. It will be filed from these keywords (a guess, you confirm in the web app).` : '';
function paintDraft() {
  const d = P.draft; const hints = ['Plant', 'Problem', 'Well reading', 'Task', 'Something else'];
  const sug = d.text ? fileText(d.text).proposals.map(p => p.label) : [];
  $('#pMain').innerHTML = `
   <header class="p-dh"><button id="pBack" aria-label="Back">←</button><h2>${d.stop ? esc(d.stop.title) : 'New record'}</h2></header>
   <div id="pGps" class="p-gps"></div>
   <div class="p-cap">
     <label class="p-btn">📷<span>Photo</span><input type="file" accept="image/*" capture="environment" id="pPhoto" multiple></label>
     <button class="p-btn" id="pMany">📸<span>Many photos</span></button>
     <label class="p-btn">🎥<span>Video</span><input type="file" accept="video/*" capture="environment" id="pVideo"></label>
     <button class="p-btn ${P.speakOn || P.dictOn ? 'on' : ''}" id="pSpeak">${P.speakOn || P.dictOn ? '■' : '🗣'}<span>${P.speakOn || P.dictOn ? 'Stop' : 'Speak'}</span></button>
     <button class="p-btn ${P.rec ? 'on' : ''}" id="pVoice">${P.rec ? '■' : '🎙'}<span>${P.rec ? 'Stop' : 'Record audio'}</span></button>
     <label class="p-btn">🎧<span>Voice note</span><input type="file" accept="audio/*" id="pAudio"></label>
   </div>
   <div class="p-lang"><button data-lang="ml-IN" class="${P.lang === 'ml-IN' ? 'on' : ''}">മലയാളം</button><button data-lang="en-IN" class="${P.lang === 'en-IN' ? 'on' : ''}">English</button></div>
   ${d.media.length ? `<div class="p-media">${d.media.map((m, i) => m.kind === 'photo' ? `<figure><img src="${m.url}" alt="Photo ${i + 1}"><button data-rm="${i}" aria-label="Remove">×</button></figure>` : `<figure class="p-mf"><span>${m.kind === 'video' ? '🎥' : '🎙'} ${m.secs ? m.secs + ' s' : Math.round(m.file.size / 1e5) / 10 + ' MB'}</span><button data-rm="${i}" aria-label="Remove">×</button></figure>`).join('')}</div>` : ''}
   <label class="p-lbl">Words (optional)<textarea id="pText" rows="3" placeholder="e.g. Pepper leaves yellowing on 5 vines">${esc(d.text)}</textarea></label>
   <div class="p-hints" role="group" aria-label="What is it about? (optional)">${hints.map(h => `<button data-hint="${h}" class="${d.hint === h ? 'on' : ''}">${h}</button>`).join('')}</div>
   <p class="p-small" id="pSug" aria-live="polite">${sugText(sug)}</p>
   <button class="p-save" id="pSave">Save</button>`;
  paintGPS(); stash();
  $('#pBack').onclick = () => { P.speakOn = false; try { P.speech?.stop(); } catch {} stash(); stopGPS(); if (P.rec) P.rec.stop(); P.draft = null; restoreDraft().then(s => { P.saved = s; home(); }); };
  $('#pMany').onclick = manyPhotos; $('#pVoice').onclick = voiceToggle; $('#pSpeak').onclick = speakToggle;
  document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { P.lang = b.dataset.lang; paintDraft(); });
  document.querySelectorAll('[data-hint]').forEach(b => b.onclick = () => { d.text = $('#pText').value; d.hint = d.hint === b.dataset.hint ? '' : b.dataset.hint; paintDraft(); });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { d.text = $('#pText').value; const gone = d.media.splice(+b.dataset.rm, 1)[0]; if (gone?.draftId) St.delMedia(gone.draftId).catch(() => {}); paintDraft(); });
  $('#pText').oninput = e => { d.text = e.target.value; stash(); clearTimeout(paintDraft.t); paintDraft.t = setTimeout(() => { const el = $('#pSug'); if (el) el.textContent = sugText(d.text ? fileText(d.text).proposals.map(p => p.label) : []); }, 250); };
  $('#pPhoto').onchange = async e => { d.text = $('#pText').value; for (const f of e.target.files) { const tag = await readGps(f); const s = await shrink(f); const m = {kind: 'photo', file: s, url: URL.createObjectURL(s), heading: P.heading, tag}; d.media.push(m); await keepMedia(m); } paintDraft(); };
  $('#pAudio').onchange = async e => { d.text = $('#pText').value; const f = e.target.files[0]; if (!f) return; const m = {kind: 'voice', file: f, secs: null}; d.media.push(m); keepMedia(m).then(paintDraft); paintDraft(); toast('Voice note added. Type a few words so it can be filed.'); };
  $('#pVideo').onchange = async e => { d.text = $('#pText').value; const f = e.target.files[0]; if (!f) return; const tag = await readGps(f); if (f.size > 40e6) toast('That video is over 40 MB. Keep clips under a minute.'); const m = {kind: 'video', file: f, tag}; d.media.push(m); await keepMedia(m); paintDraft(); };
  $('#pSave').onclick = save;
}
async function save() {
  const d = P.draft; d.text = $('#pText').value.trim();
  const heard = d.text ? autoHint(d.text) : ''; const hintAuto = !d.hint && !!heard; if (hintAuto) d.hint = heard;
  if (!d.text && !d.media.length) return toast('Take a photo, record your voice or write a few words first');
  if (P.rec) { P.rec.stop(); await new Promise(r => setTimeout(r, 300)); }
  P.speakOn = false; try { P.speech?.stop(); } catch {} stopGPS(); const g = P.gps;
  const ids = [];
  for (const m of d.media) { const id = m.draftId || 'm-' + crypto.randomUUID(); await St.putMedia({id, name: m.file.name, type: m.file.type, size: m.file.size, blob: m.file, kind: m.kind, heading: m.heading ?? null}); ids.push(id); }
  let place = g?.status === 'ok' && g.farm.inside ? {x: +g.farm.x.toFixed(1), y: +g.farm.y.toFixed(1), label: nearName(g.farm.x, g.farm.y), acc: g.fix.acc} : null;
  const tagged = d.media.find(m => m.tag); let tagFarm = null;
  if (!place && tagged) { const f = gpsToFarm(tagged.tag.lat, tagged.tag.lon); if (f.inside) { tagFarm = tagged.tag; place = {x: +f.x.toFixed(1), y: +f.y.toFixed(1), label: nearName(f.x, f.y) + ' (from the ' + tagged.tag.src + ')'}; } }
  try {
    await St.add({type: 'capture', grade: 'seen', place, text: d.text, media: ids,
      data: {gps: g?.fix || null, gpsStatus: g?.status || 'none', hint: d.hint, hintBasis: d.hint ? (hintAuto ? 'model (keyword match on your words, not confirmed)' : 'told (you chose it)') : 'unknown', heard: d.text ? fileText(d.text).proposals.map(p => p.label) : [], lang: P.lang, mediaKinds: d.media.map(m => m.kind), stopId: d.stop?.id || null, filed: false, tagGps: tagFarm, positionBasis: place ? (tagFarm ? 'model (phone photo tag, frame assumed)' : 'model (GPS, frame assumed)') : 'unknown', heading: d.media.find(m => m.heading != null)?.heading ?? null}});
  } catch (e) { return toast(e.message); }
  P.draft = null; try { localStorage.removeItem(DK); } catch {} await load(); home(); toast(place ? 'Saved at ' + place.label : g?.fix ? 'Saved with GPS' : 'Saved (no spot)');
}
/* Copy button for places where files cannot leave the page (a preview inside another app): plain text of today's records, no photos. */
async function copyNotes() {
  const d = today(), ev = P.events.filter(e => (e.createdAt || e.at).slice(0, 10) === d || e.at.slice(0, 10) === d);
  const lines = ev.map(e => `${(e.createdAt || e.at).slice(11, 16)} · ${e.type} · ${e.text || '(no words)'}` + (e.place ? ` · spot x ${e.place.x}, y ${e.place.y}${e.place.label ? ' (' + e.place.label + ')' : ''}` : ' · no spot') + (e.media?.length ? ` · ${e.media.length} file(s) not included` : '') + (e.data?.h ? ` · height ${e.data.h} m (estimate)` : '') + ` · basis ${e.grade}`);
  const txt = `Seethamount Field notes ${d}\n` + (lines.join('\n') || 'No records today.');
  try { await navigator.clipboard.writeText(txt); toast(`Copied ${ev.length} record(s). Paste them into the chat.`); } catch { const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('aria-label', 'Notes to copy'); ta.style.cssText = 'width:100%;height:160px'; $('#pMain').append(ta); ta.select(); toast('Select all and copy the text below.'); }
}
async function sendDay() {
  const d = today(); const b = await St.exportDay(d); const f = new File([JSON.stringify(b)], `seethamount-day-${d}.json`, {type: 'application/json'});
  try { if (!new URLSearchParams(location.search).has('noshare') && navigator.canShare?.({files: [f]})) { await navigator.share({files: [f], title: `Seethamount records ${d}`}); return; } } catch (e) { if (e.name === 'AbortError') return; }
  if (P.dl) { try { await P.dl.save({filename: f.name, data: JSON.stringify(b)}); toast(`Day file: ${b.events.length} records.`); return; } catch {} }
  const url = URL.createObjectURL(f); const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Day file saved: ${b.events.length} records. Send it to yourself.`);
}
async function load() { P.events = await St.all(); }

(async () => {
  const mode = await St.open(); if (mode === 'memory') $('#pStore').textContent = 'Not saving: storage blocked';
  try { window.claude?.use?.('dictation').then(d => { if (d) P.dict = d; }).catch(() => {}); window.claude?.use?.('downloads').then(d => { if (d) P.dl = d; }).catch(() => {}); } catch {}
  listenHeading(); await load(); P.saved = await restoreDraft(); home(); document.body.dataset.app = 'ready';
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
