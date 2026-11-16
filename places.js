import {isSeed} from './farm.js';
// Places on the farm known from the survey and the baseline profile (survey frame, metres). Owner's Seethamount only; every other farm starts empty and adds its own places.
const SEED_PLACES = {
  house: {x: -12, y: -8, label: 'House platform'},
  tank: {x: 2.5, y: -1.5, label: 'Tank (rain gauge spot assumed until you set one)'},
  well: {x: -12, y: -8, label: 'Well (on the lower parcel, off this map; shown at the house)'},
};
const NONE = {x: 0, y: 0, label: 'Not set yet'};
export const PLACES = isSeed() ? SEED_PLACES : {house: NONE, tank: NONE, well: NONE};
const SEED_QUESTIONS = [ // open questions tied to a place (from the baseline profile)
  {id: 'q-tank', x: 0.5, y: -1.5, title: 'Tank: size and leaks', why: 'Tank size and leaks are not measured. The drawing and the reported size do not agree.', ask: 'Measure inside length, width and depth; note any crack that is wet.', topic: 'water', wet: false},
  {id: 'q-wall', x: -14, y: -15, title: 'Retaining wall cracks', why: 'Cracks and bulging were reported; condition not assessed.', ask: 'Photograph each crack with a pen for scale; mark if any is wider than last time.', topic: 'safety', wet: true},
  {id: 'q-gate', x: -28.5, y: -60, title: 'Road water at the gate', why: 'Road water enters at the gate; how much and how often is not measured.', ask: 'After rain, note depth of flow at the gate and where it goes.', topic: 'water', wet: true},
  {id: 'q-soil', x: 30, y: 20, title: 'Soil: first test pit', why: 'No soil test anywhere on the farm yet.', ask: 'Dig one pit 45 cm deep; note colour, layers and how fast a bucket of water soaks in.', topic: 'soil', wet: false},
  {id: 'q-coffee', x: -35, y: 10, title: 'Where the coffee and pepper are', why: 'Coffee and pepper positions are not on the survey.', ask: 'Walk one row; pin where the coffee block starts and ends.', topic: 'plants', wet: false},
];
// The five walk stops, as computed by the map engine from the survey (kept here so the phone stays light).
export const QUESTIONS = isSeed() ? SEED_QUESTIONS : [];
const SEED_WALK = [
  {n: 1, name: 'Where water comes in', x: -28.5, y: -58}, {n: 2, name: 'The house platform', x: -12, y: -8},
  {n: 3, name: 'The steepest band', x: -29.5, y: -30.5}, {n: 4, name: 'Under the canopy', x: 47.6, y: -8.1}, {n: 5, name: 'The lowest wet corner', x: 54.5, y: 22.5}];
export const WALK = isSeed() ? SEED_WALK : [];
export function nearName(x, y) {
  let best = null, bd = 1e9;
  for (const s of WALK) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s.name; } }
  for (const q of QUESTIONS) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q.title.split(':')[0]; } }
  return bd < 15 ? 'Near ' + best.toLowerCase() : `Spot at ${x.toFixed(0)}, ${y.toFixed(0)}`;
}
