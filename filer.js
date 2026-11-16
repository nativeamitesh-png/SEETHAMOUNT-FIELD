// Shared by the phone recorder and the web inbox.
// 1) GPS to survey coordinates. 2) Keyword filer (English + Malayalam). Free, offline, rule based.
// The filer only PROPOSES. Nothing becomes a farm record until the person confirms it.

/* ---------- GPS (WGS84 lat/lon) -> UTM zone 43N -> survey frame ---------- */
// The survey grid numbers (630982.5 E, 1309520.5 N at the grid corner) look like UTM zone 43N.
// Survey frame x = E - 631050, y = N - 1309585 (derived from the terrain grid).
// ASSUMPTION until 3-4 control points are checked on site: the surveyor used WGS84.
// If they used the older Indian datum (Everest/Kalianpur), points can land tens to hundreds of metres off.
export const FRAME = {e0: 631050, n0: 1309585, zone: 43, confirmed: false};
export function toUTM(lat, lon, zone = 43) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const φ = lat * Math.PI / 180, λ = lon * Math.PI / 180, λ0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2), T = Math.tan(φ) ** 2, C = ep2 * Math.cos(φ) ** 2, A = Math.cos(φ) * (λ - λ0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * φ - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * φ) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * φ) - (35 * e2 ** 3 / 3072) * Math.sin(6 * φ));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const Nn = k0 * (M + N * Math.tan(φ) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return {E, N: Nn};
}
export function fromUTM(E, Nn, zone = 43) { // inverse, for the Google Earth export
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = E - 500000, M = Nn / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const φ1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(φ1) ** 2), T1 = Math.tan(φ1) ** 2, C1 = ep2 * Math.cos(φ1) ** 2, R1 = a * (1 - e2) / (1 - e2 * Math.sin(φ1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = φ1 - (N1 * Math.tan(φ1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(φ1);
  return {lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI};
}
export function gpsToFarm(lat, lon, shift = {dx: 0, dy: 0}) {
  const u = toUTM(lat, lon); const x = u.E - FRAME.e0 + shift.dx, y = u.N - FRAME.n0 + shift.dy;
  const inside = Math.abs(x) < 90 && Math.abs(y) < 90; // the survey grid spans about 136 x 131 m
  return {x, y, inside};
}
export const farmToLatLon = (x, y, shift = {dx: 0, dy: 0}) => fromUTM(x - shift.dx + FRAME.e0, y - shift.dy + FRAME.n0);

/* ---------- names: English · Malayalam · scientific ---------- */
export const PLANTS = {
  pepper:   {en: 'Black pepper', ml: 'കുരുമുളക്', sci: 'Piper nigrum', words: ['pepper', 'kurumulak', 'കുരുമുളക']},
  coffee:   {en: 'Robusta coffee', ml: 'കാപ്പി', sci: 'Coffea canephora', words: ['coffee', 'kaapi', 'kappi', 'കാപ്പി']},
  coconut:  {en: 'Coconut palm', ml: 'തെങ്ങ്', sci: 'Cocos nucifera', words: ['coconut', 'thengu', 'തെങ്ങ', 'നാളികേര']},
  areca:    {en: 'Areca palm', ml: 'കമുക്', sci: 'Areca catechu', words: ['areca', 'arecanut', 'kamuk', 'adakka', 'കമുക', 'അടയ്ക്ക']},
  banana:   {en: 'Banana', ml: 'വാഴ', sci: 'Musa sp.', words: ['banana', 'vazha', 'വാഴ']},
  papaya:   {en: 'Papaya', ml: 'കപ്പളം / പപ്പായ', sci: 'Carica papaya', words: ['papaya', 'kappalam', 'കപ്പളം', 'പപ്പായ']},
  lemon:    {en: 'Lemon', ml: 'നാരകം', sci: 'Citrus limon', words: ['lemon', 'lime', 'naarakam', 'നാരക', 'ചെറുനാരങ്ങ']},
  passion:  {en: 'Passion fruit', ml: 'പാഷൻ ഫ്രൂട്ട്', sci: 'Passiflora edulis', words: ['passion', 'പാഷൻ']},
  gliricidia: {en: 'Gliricidia (support tree)', ml: 'ശീമക്കൊന്ന', sci: 'Gliricidia sepium', words: ['gliricidia', 'seemakonna', 'sheemakkonna', 'ശീമക്കൊന്ന']},
  teak:     {en: 'Teak', ml: 'തേക്ക്', sci: 'Tectona grandis', words: ['teak', 'thekku', 'തേക്ക']},
  mahogany: {en: 'Mahogany', ml: 'മഹാഗണി', sci: 'Swietenia macrophylla', words: ['mahogany', 'മഹാഗണി']},
  mango:    {en: 'Mango', ml: 'മാവ്', sci: 'Mangifera indica', words: ['mango', 'maavu', 'മാവ', 'മാങ്ങ']},
  jackfruit: {en: 'Jackfruit', ml: 'പ്ലാവ്', sci: 'Artocarpus heterophyllus', words: ['jackfruit', 'jack', 'plaavu', 'പ്ലാവ', 'ചക്ക']},
  rubber:   {en: 'Rubber', ml: 'റബ്ബർ', sci: 'Hevea brasiliensis', words: ['rubber', 'റബ്ബർ', 'റബ്ബര']},
  moringa:  {en: 'Moringa', ml: 'മുരിങ്ങ', sci: 'Moringa oleifera', words: ['moringa', 'drumstick', 'muringa', 'മുരിങ്ങ']},
  ginger:   {en: 'Ginger', ml: 'ഇഞ്ചി', sci: 'Zingiber officinale', words: ['ginger', 'inchi', 'ഇഞ്ചി']},
  turmeric: {en: 'Turmeric', ml: 'മഞ്ഞൾ', sci: 'Curcuma longa', words: ['turmeric', 'manjal', 'മഞ്ഞൾ']},
  bamboo:   {en: 'Bamboo', ml: 'മുള', sci: 'Bambusa sp.', words: ['bamboo', 'mula', 'മുള ']},
  guava:    {en: 'Guava', ml: 'പേര', sci: 'Psidium guajava', words: ['guava', 'pera', 'പേരയ്ക്ക', 'പേര ']},
};
export const SYMPTOMS = {
  yellow: {en: 'Yellowing leaves', ml: 'ഇല മഞ്ഞളിപ്പ്', words: ['yellow', 'മഞ്ഞളിപ്പ', 'മഞ്ഞച്ച', 'മഞ്ഞ നിറ', 'manjalipp']},
  wilt:   {en: 'Wilting', ml: 'വാട്ടം', words: ['wilt', 'droop', 'വാട്ട', 'വാടി', 'vaadi']},
  spots:  {en: 'Spots on leaves', ml: 'ഇലപ്പുള്ളി', words: ['spot', 'patch', 'പുള്ളി']},
  rot:    {en: 'Rotting', ml: 'ചീയൽ / അഴുകൽ', words: ['rot', 'ചീയ', 'അഴുക']},
  pest:   {en: 'Insects or pests', ml: 'കീടം', words: ['insect', 'pest', 'worm', 'borer', 'aphid', 'mealybug', 'കീട', 'പുഴു', 'ചാഴി']},
  dry:    {en: 'Drying', ml: 'ഉണക്കം', words: ['drying', 'dried', 'dry leaves', 'scorch', 'ഉണങ്ങ', 'ഉണക്ക']},
  drop:   {en: 'Leaves or fruit dropping', ml: 'കൊഴിച്ചിൽ', words: ['dropping', 'falling', 'shedding', 'കൊഴിയ', 'കൊഴിച്ചിൽ', 'പൊഴിയ']},
};
// What to look at next. Possibilities to check, never a diagnosis.
const CHECKS = {
  'pepper|yellow': ['Old leaves or new leaves? Yellowing on new leaves and a whole vine at once needs a look the same week.', 'Is the base of the vine dark or soft, or are leaves falling fast? That pattern fits foot rot (ദ്രുതവാട്ടം, Phytophthora capsici), which spreads in wet soil.', 'Slow yellowing over months on many vines fits slow decline (മന്ദവാട്ടം, often nematodes) or water stress.', 'Count how many vines show it and photograph the base and a leaf, top and underside.'],
  'pepper|wilt': ['Is the soil wet or dry at the base?', 'Dark, soft collar or roots fits foot rot (ദ്രുതവാട്ടം, Phytophthora capsici); keep tools and water off healthy vines until checked.', 'Ask the Krishi Bhavan or a pepper grower to look before spraying anything.'],
  'coffee|yellow': ['Full sun or under shade? Sudden extra sun yellows coffee.', 'Dry soil this month? The farm is in a rain-shadow dry season.', 'Yellow between green veins on new leaves can mean a nutrient gap; a soil test would tell.'],
  '*|pest': ['Photograph the insect close up and the damage.', 'How many plants? One plant or many?', 'Note whether ants, ladybirds or spiders are around it.'],
  '*|*': ['How many plants show it?', 'Since when? Better, same or worse than last week?', 'Soil wet or dry? Sun or shade?', 'Photograph a close leaf, the whole plant and the base.'],
};
export function checksFor(plant, sym) { return CHECKS[plant + '|' + sym] || CHECKS['*|' + sym] || CHECKS['*|*']; }

const has = (t, w) => t.includes(w);
export function file(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const out = {plants: [], symptoms: [], numbers: {}, task: false, proposals: []};
  for (const [k, s] of Object.entries(SYMPTOMS)) if (s.words.some(w => has(t, w))) out.symptoms.push(k);
  for (const [k, p] of Object.entries(PLANTS)) if (p.words.some(w => has(t, w.toLowerCase()))) out.plants.push(k);
  const num = re => { const m = t.match(re); return m ? +m[1] : null; };
  out.numbers.well = num(/(?:well|കിണ[റർ][^0-9]{0,20})[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:m\b|metre|meter|മീ)/);
  out.numbers.rain = num(/(\d+(?:\.\d+)?)\s*mm/);
  out.numbers.height = num(/(\d+(?:\.\d+)?)\s*(?:m|metre|meter|മീറ്റർ)\s*(?:tall|high|ഉയര)/) ?? num(/(?:height|tall|ഉയരം)[^0-9]{0,12}(\d+(?:\.\d+)?)/);
  const feet = num(/(\d+(?:\.\d+)?)\s*(?:feet|ft|അടി)/); if (out.numbers.height == null && feet != null) out.numbers.height = +(feet * 0.3048).toFixed(1);
  out.numbers.count = num(/(\d+)\s*(?:vines?|plants?|trees?|palms?|bushes|തൈ|എണ്ണം|ചെടി|വള്ളി)/);
  out.task = /(need to|needs|should(?! (?:i|we)\b)|must|have to|to do|ചെയ്യണം|വേണം|നോക്കണം)/.test(t);
  const plant = out.plants[0] || null;
  if (plant) out.proposals.push({kind: 'plant', plant, label: `${PLANTS[plant].en} at this spot`, count: out.numbers.count, height: out.numbers.height});
  for (const s of out.symptoms) out.proposals.push({kind: 'health', plant, symptom: s, label: `Plant health: ${SYMPTOMS[s].en.toLowerCase()}${plant ? ' on ' + PLANTS[plant].en.toLowerCase() : ''} (possible plant problem)`, checks: checksFor(plant || '*', s)});
  if (out.numbers.well != null || /(?:well|കിണ)/.test(t) && out.numbers.rain != null) out.proposals.push({kind: 'reading', well: out.numbers.well, rain: /(?:rain|മഴ)/.test(t) ? out.numbers.rain : null, label: 'Reading' + (out.numbers.well != null ? `: well ${out.numbers.well} m down` : '')});
  out.whatif = /^\s*(what if|what about if|should i|should we|how might we)\b/.test(t);
  if (out.whatif) out.proposals.unshift({kind: 'whatif', label: 'Start a stress test from this what-if'});
  if (out.task) out.proposals.push({kind: 'task', label: 'Task from this note'});
  if (!out.proposals.length) out.proposals.push({kind: 'note', label: 'Note at this spot'});
  return out;
}
