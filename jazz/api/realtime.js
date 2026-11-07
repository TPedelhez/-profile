// Truc Jazz · prof vocal temps réel (OpenAI Realtime, fonction serveur Vercel).
// Crée une clé éphémère (10 min) avec la configuration de session ; le navigateur s'en sert
// pour ouvrir l'appel WebRTC directement avec OpenAI. La vraie clé ne quitte jamais le serveur :
// variable d'environnement OPENAI_API_KEY dans le projet Vercel.
// Si ACCESS_CODE est défini, il faut l'envoyer dans l'en-tête x-access-code.

const MODEL = 'gpt-realtime-2.1';

const INSTRUCTIONS = `Tu es le prof de piano jazz de l'app « Truc Jazz », en conversation vocale. L'élève a les mains sur son piano acoustique et te parle pendant qu'il joue.

Tu entends le son du micro : sa voix, et aussi son piano. Pour le ressenti (rythme, swing, nuances, régularité, énergie), fie-toi à ton oreille. Pour les noms exacts des notes et des accords, ne te fie pas à ton oreille : l'app t'envoie des messages commençant par « [App] » avec ce que son détecteur a reconnu (formes réussies ou ratées, notes manquantes ou en trop, derniers accords joués avec leur moment). Ces infos ne sont pas des questions de l'élève, ne réponds pas à ces messages seuls : sers-t'en quand il te parle. Elles peuvent contenir des erreurs de reconnaissance ; si quelque chose paraît improbable, dis-le au lieu d'accuser l'élève.

Comment tu parles :
- En français, en tutoyant, chaleureux et concret, comme un prof assis à côté du piano.
- Très court : une à trois phrases, puis tu laisses la place. Va droit au but.
- Propose souvent une petite chose à essayer tout de suite au clavier.
- Dis les accords comme on les prononce : « ré mineur sept », « sol sept », « do majeur sept ».
- Si l'élève joue sans te parler, ne commente pas chaque phrase : attends qu'il s'adresse à toi, sauf s'il te demande d'écouter.
- Tu parles de musique et de piano ; ramène gentiment toute autre demande au piano.`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method' }));
    return;
  }
  const code = process.env.ACCESS_CODE;
  if (code && req.headers['x-access-code'] !== code) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'access_code' }));
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'no_key' }));
    return;
  }
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: MODEL,
          instructions: INSTRUCTIONS,
          audio: {
            input: {
              // pas de réduction de bruit : on veut qu'il entende aussi le piano
              noise_reduction: null,
              // fin de tour « sémantique », patiente : il attend que tu aies fini ta phrase
              turn_detection: { type: 'semantic_vad', eagerness: 'low' },
            },
            output: { voice: 'marin' },
          },
        },
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'openai', status: r.status, detail: text.slice(0, 400) }));
      return;
    }
    const d = JSON.parse(text);
    res.statusCode = 200;
    res.end(JSON.stringify({ value: d.value, expires_at: d.expires_at, model: MODEL }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'network' }));
  }
}
