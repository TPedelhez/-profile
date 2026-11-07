// Truc Jazz · relecture de la boîte noire (pour analyser les sessions).
//   GET /api/sessions                 → liste des sessions
//   GET /api/sessions?id=<session>    → tous les événements de la session + liste des extraits sonores
//   GET /api/sessions?clip=<chemin>   → un extrait sonore (WAV)
//   DELETE /api/sessions?id=<session> → efface une session
// Toujours avec le code d'accès (en-tête x-access-code ou ?code=).
import { list, get, del } from '@vercel/blob';
import { allowed, sessionOk, json } from '../lib/server.js';

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'DELETE') return json(res, 405, { error: 'method' });
  if (!allowed(req)) return json(res, 401, { error: 'access_code' });
  const q = req.query || {};
  try {
    if (req.method === 'DELETE') {
      if (!sessionOk(q.id)) return json(res, 400, { error: 'session' });
      const blobs = await listAll(`sessions/${q.id}/`);
      if (blobs.length) await del(blobs.map(b => b.url));
      return json(res, 200, { deleted: blobs.length });
    }
    if (typeof q.clip === 'string') {
      if (!/^sessions\/[^/]+\/clips\/[^/]+\.wav$/.test(q.clip)) return json(res, 400, { error: 'clip' });
      const r = await get(q.clip, { access: 'private' });
      if (!r || r.statusCode !== 200) return json(res, 404, { error: 'not_found' });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      res.end(Buffer.from(await new Response(r.stream).arrayBuffer()));
      return;
    }
    if (typeof q.id === 'string') {
      if (!sessionOk(q.id)) return json(res, 400, { error: 'session' });
      const blobs = await listAll(`sessions/${q.id}/`);
      const batches = [];
      for (const b of blobs.filter(x => x.pathname.endsWith('.json'))) {
        const r = await get(b.pathname, { access: 'private' });
        if (r && r.statusCode === 200) batches.push(JSON.parse(await new Response(r.stream).text()));
      }
      batches.sort((a, b) => a.seq - b.seq);
      const events = batches.flatMap(x => x.events);
      const clips = blobs.filter(x => x.pathname.endsWith('.wav')).map(x => ({ pathname: x.pathname, size: x.size, uploadedAt: x.uploadedAt }));
      return json(res, 200, { session: q.id, batches: batches.length, events, clips });
    }
    const blobs = await listAll('sessions/');
    const by = new Map();
    for (const b of blobs) {
      const id = b.pathname.split('/')[1];
      const s = by.get(id) || { session: id, batches: 0, clips: 0, bytes: 0, first: b.uploadedAt, last: b.uploadedAt };
      if (b.pathname.endsWith('.wav')) s.clips++; else s.batches++;
      s.bytes += b.size;
      if (b.uploadedAt < s.first) s.first = b.uploadedAt;
      if (b.uploadedAt > s.last) s.last = b.uploadedAt;
      by.set(id, s);
    }
    return json(res, 200, { sessions: [...by.values()].sort((a, b) => (a.last < b.last ? 1 : -1)) });
  } catch (e) {
    return json(res, 502, { error: 'storage' });
  }
}
