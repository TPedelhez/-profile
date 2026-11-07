// Truc Jazz · petits outils partagés par les fonctions serveur.

// Le code d'accès (variable ACCESS_CODE) protège tout ce qui coûte de l'argent ou touche aux données.
export function allowed(req, bodyCode) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  const q = req.query && typeof req.query.code === 'string' ? req.query.code : null;
  return req.headers['x-access-code'] === code || bodyCode === code || q === code;
}

// Identifiant de session : « AAAA-MM-JJ-xxxxxxxx »
export const sessionOk = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}-[a-z0-9]{6,16}$/.test(s);

// Corps brut de la requête (Buffer), quel que soit le type annoncé
export async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
