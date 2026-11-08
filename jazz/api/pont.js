// Truc Jazz · pont entre le Labo d'écoute (qui a le micro) et le studio Claude (artefact claude.ai, sans micro).
// POST : le Labo envoie ce qu'il vient de reconnaître au piano (les 90 dernières secondes).
// GET  : le studio le relit à travers le connecteur Vercel de claude.ai (?code=…&secondes=…).
// Stockage privé Vercel Blob : un petit fichier par envoi (pont/<horodatage>.json), on garde les 3 derniers.
import { put, list, get, del } from '@vercel/blob';
import { allowed, rawBody, json } from '../lib/server.js';

const PREFIX = 'pont/';
const newestFirst = blobs => blobs.slice().sort((a, b) => b.pathname.localeCompare(a.pathname));

export default async function handler(req, res) {
  if (req.method === 'POST') {
    let body = req.body;
    try {
      if (Buffer.isBuffer(body) || body == null) body = JSON.parse((await rawBody(req)).toString('utf8') || '{}');
      else if (typeof body === 'string') body = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'json' });
    }
    if (!allowed(req, body.code)) return json(res, 401, { error: 'access_code' });
    const now = Date.now();
    // horloges différentes : on recale les instants du Labo sur celle du serveur
    const sentAt = Number(body.sentAt) || now;
    const journal = (Array.isArray(body.journal) ? body.journal : []).slice(0, 60).map(e => ({
      at: now - (sentAt - Number(e.at)),
      notes: (Array.isArray(e.notes) ? e.notes : []).slice(0, 12).map(Number).filter(Number.isFinite),
      chord: e.chord ? String(e.chord).slice(0, 16) : null,
    })).filter(e => Number.isFinite(e.at) && e.notes.length);
    const doc = JSON.stringify({ writtenAt: now, listening: body.listening !== false, journal });
    try {
      await put(`${PREFIX}${now}.json`, doc, { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
      try {
        const { blobs } = await list({ prefix: PREFIX, limit: 100 });
        const old = newestFirst(blobs).slice(3);
        if (old.length) await del(old.map(b => b.url));
      } catch { /* ménage au prochain envoi */ }
      return json(res, 200, { ok: true, n: journal.length });
    } catch {
      return json(res, 502, { error: 'storage' });
    }
  }

  if (req.method === 'GET') {
    if (!allowed(req)) return json(res, 401, { error: 'access_code' });
    const win = Math.max(5, Math.min(300, Number(req.query && req.query.secondes) || 60)) * 1000;
    try {
      const { blobs } = await list({ prefix: PREFIX, limit: 100 });
      const now = Date.now();
      if (!blobs.length) return json(res, 200, { now, labo: 'jamais vu', journal: [] });
      const r = await get(newestFirst(blobs)[0].pathname, { access: 'private' });
      const d = JSON.parse(await new Response(r.stream).text());
      const age = (now - d.writtenAt) / 1000;
      return json(res, 200, {
        now,
        // le Labo envoie un signe de vie toutes les 20 s tant que son micro écoute
        labo: d.listening && age < 45 ? 'écoute' : 'pas à l’écoute',
        derniere_nouvelle_il_y_a_s: Math.round(age),
        journal: d.journal.filter(e => now - e.at <= win).sort((a, b) => b.at - a.at)
          .map(e => ({ il_y_a_s: Math.round((now - e.at) / 100) / 10, notes: e.notes, accord: e.chord })),
      });
    } catch {
      return json(res, 502, { error: 'storage' });
    }
  }
  return json(res, 405, { error: 'method' });
}
