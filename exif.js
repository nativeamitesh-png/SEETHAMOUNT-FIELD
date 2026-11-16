// Living Farm · read the GPS tag a phone stores inside a photo (JPEG EXIF) or video (MP4/MOV location atom).
// Read from the ORIGINAL file, before any shrinking, because re-saving a photo drops the tag. A tag is the phone's own reading: label it so.
export async function readGps(file) {
  try {
    if (/jpe?g|heic/i.test(file.type + file.name)) return jpeg(new DataView(await file.slice(0, 262144).arrayBuffer()));
    if (/video|mp4|quicktime|mov/i.test(file.type + file.name)) return video(file);
  } catch {}
  return null;
}
function jpeg(v) {
  if (v.getUint16(0) !== 0xFFD8) return null;
  let o = 2;
  while (o + 4 < v.byteLength) {
    const m = v.getUint16(o), len = v.getUint16(o + 2);
    if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10);
    if ((m & 0xFF00) !== 0xFF00) return null;
    o += 2 + len;
  }
  return null;
}
function tiff(v, base) {
  const le = v.getUint16(base) === 0x4949, u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
  const ifd = p => { const n = u16(base + p), out = {}; for (let i = 0; i < n; i++) { const e = base + p + 2 + i * 12; out[u16(e)] = {type: u16(e + 2), count: u32(e + 4), at: e + 8}; } return out; };
  const top = ifd(u32(base + 4)); if (!top[0x8825]) return null;
  const g = ifd(u32(top[0x8825].at));
  const rat = t => { const p = base + u32(t.at), r = []; for (let i = 0; i < t.count; i++) r.push(u32(p + i * 8) / (u32(p + i * 8 + 4) || 1)); return r; };
  const ref = t => String.fromCharCode(v.getUint8(t.at));
  if (!g[2] || !g[4]) return null;
  const dms = a => a[0] + a[1] / 60 + a[2] / 3600;
  let lat = dms(rat(g[2])), lon = dms(rat(g[4]));
  if (g[1] && ref(g[1]) === 'S') lat = -lat; if (g[3] && ref(g[3]) === 'W') lon = -lon;
  return Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? {lat, lon, src: 'photo tag'} : null;
}
async function video(f) {
  // phones write "+11.8412+076.2001/" after the ©xyz atom; look in the first and last 512 KB
  const parts = [f.slice(0, 524288), f.size > 524288 ? f.slice(Math.max(524288, f.size - 524288)) : null].filter(Boolean);
  for (const p of parts) {
    const t = new TextDecoder('latin1').decode(await p.arrayBuffer()), i = t.indexOf('\xA9xyz'), s = i >= 0 ? t.slice(i, i + 60) : '';
    const m = s.match(/([+-]\d{1,3}\.\d+)([+-]\d{1,3}\.\d+)/); if (m) return {lat: +m[1], lon: +m[2], src: 'video tag'};
  }
  return null;
}
