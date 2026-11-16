// Which farm is open on this device. One browser can hold several farms; each has its own database.
// Owner edition: the Seethamount farm ships with its survey and is the default. Shared edition: no farm data ships; the first visit is onboarding.
export const EDITION = await fetch('edition.json').then(r => r.json()).catch(() => ({edition: 'owner'}));
export const OWNER_ID = 'seethamount';
const REG = 'lf-farms', ACT = 'lf-active';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
export const list = () => { try { return JSON.parse(ls.get(REG) || '[]'); } catch { return []; } };
const save = a => ls.set(REG, JSON.stringify(a));
const q = new URLSearchParams(location.search);
const ownerEd = EDITION.edition === 'owner';
if (ownerEd && !list().some(f => f.id === OWNER_ID)) save([{id: OWNER_ID, name: 'Seethamount', owner: true, created: '2026-03-27'}, ...list()]);
let act = q.get('farm') || ls.get(ACT) || (ownerEd ? OWNER_ID : null);
if (q.get('newfarm')) act = null;
if (act && !list().some(f => f.id === act)) act = ownerEd ? OWNER_ID : null;
export const activeId = act;
/** True only for the owner's Seethamount farm in the owner edition: the one farm that has the bundled survey. */
export const isSeed = () => ownerEd && act === OWNER_ID;
export const active = () => list().find(f => f.id === act) || null;
export const dbName = () => isSeed() ? 'seethamount-living-farm' : 'lf-' + (act || 'pending');
export function create(name) {
  const id = 'f' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  save([...list(), {id, name: name || 'My farm', owner: false, created: new Date().toISOString().slice(0, 10)}]); ls.set(ACT, id); return id;
}
export function rename(id, name) { save(list().map(f => f.id === id ? {...f, name} : f)); }
export function use(id) { ls.set(ACT, id); const u = new URL(location.href); u.searchParams.delete('farm'); location.href = u.toString(); }
export function forget(id) { save(list().filter(f => f.id !== id)); if (ls.get(ACT) === id) ls.set(ACT, ''); }
export const needsOnboarding = () => !act;
