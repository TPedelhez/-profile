// Truc Jazz · boîte noire : reçoit un paquet d'événements d'une session et le range
// dans le stockage privé (Vercel Blob) : sessions/<session>/events-<n>.json
import { put } from '@vercel/blob';
import { allowed, sessionOk, rawBody, json } from '../lib/server.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  let body = req.body;
  try {
    if (Buffer.isBuffer(body) || body == null) body = JSON.parse((await rawBody(req)).toString('utf8') || '{}');
    else if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return json(res, 400, { error: 'json' });
  }
  if (!allowed(req, body.code)) return json(res, 401, { error: 'access_code' });
  if (!sessionOk(body.session)) return json(res, 400, { error: 'session' });
  const events = Array.isArray(body.events) ? body.events.slice(0, 500) : [];
  if (!events.length) return json(res, 204, {});
  const seq = Number.isInteger(body.seq) ? body.seq : 0;
  const doc = JSON.stringify({ session: body.session, seq, receivedAt: new Date().toISOString(), events });
  if (doc.length > 400000) return json(res, 413, { error: 'too_big' });
  try {
    await put(`sessions/${body.session}/events-${String(seq).padStart(4, '0')}.json`, doc, {
      access: 'private', contentType: 'application/json', addRandomSuffix: true,
    });
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 502, { error: 'storage' });
  }
}
