// Truc Jazz · boîte noire : reçoit quelques secondes de son (WAV) autour d'un accord raté
// et les range dans le stockage privé : sessions/<session>/clips/<moment>-<étiquette>.wav
import { put } from '@vercel/blob';
import { allowed, sessionOk, rawBody, json } from '../lib/server.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  if (!allowed(req)) return json(res, 401, { error: 'access_code' });
  const q = req.query || {};
  if (!sessionOk(q.session)) return json(res, 400, { error: 'session' });
  const label = String(q.label || 'clip').toLowerCase().replace(/[^a-z0-9#-]+/g, '-').slice(0, 60);
  const buf = await rawBody(req);
  if (buf.length < 44 || buf.length > 2500000) return json(res, 413, { error: 'size' });
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF' || buf.slice(8, 12).toString('ascii') !== 'WAVE') return json(res, 400, { error: 'wav' });
  try {
    const r = await put(`sessions/${q.session}/clips/${Date.now()}-${label}.wav`, buf, {
      access: 'private', contentType: 'audio/wav', addRandomSuffix: true,
    });
    return json(res, 200, { ok: true, pathname: r.pathname });
  } catch (e) {
    return json(res, 502, { error: 'storage' });
  }
}
