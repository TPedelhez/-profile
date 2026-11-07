// Truc Jazz · le prof (fonction serveur Vercel).
// Reçoit la question de l'élève + un résumé texte de ce que le micro a reconnu,
// et renvoie la réponse de Claude en flux (texte brut). La clé API reste côté serveur :
// variable d'environnement ANTHROPIC_API_KEY dans le projet Vercel.
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `Tu es le prof de piano jazz de l'app « Truc Jazz ». L'élève apprend sans programme : il pioche de petits trucs (shells, voicings sans fondamentale, gamme blues, substitution tritonique, walking bass…) et les joue tout de suite sur son piano.

Tu reçois avec chaque question un résumé de ce que l'app a reconnu au micro : les formes demandées, celles réussies ou ratées (notes manquantes, notes en trop), les accords joués librement, le délai de reconnaissance. Ces données viennent d'une reconnaissance automatique au micro d'un piano acoustique : elles peuvent contenir des erreurs (octave mal reconnue, harmonique prise pour une note, pédale). Si un résultat te paraît improbable, dis-le simplement au lieu de reprocher une faute à l'élève.

Comment tu réponds :
- En français, en tutoyant, comme un bon prof à côté du piano : concret, chaleureux, sans jargon inutile.
- Court : 120 mots environ, sauf si l'élève demande plus. Une idée principale à la fois.
- Termine quand c'est utile par un exercice d'une minute à faire tout de suite au piano.
- Noms de notes dans la notation indiquée (Do Ré Mi ou lettres) ; symboles d'accords toujours en lettres (Dm7, G7, Cmaj7).
- Texte simple, sans titres ni tableaux ; une courte liste si vraiment utile.
- Tu parles de musique et de piano. Si on te demande autre chose, ramène gentiment la conversation au piano.`;

// En mode vocal, la réponse est lue à voix haute dès la première phrase.
const VOICE = `

MODE VOCAL : ta réponse va être lue à voix haute pendant que l'élève a les mains sur le clavier.
- 1 à 3 phrases courtes, en langage parlé. Va droit au but : la première phrase répond à la question.
- Ni listes, ni symboles, ni chiffres de degrés écrits en chiffres seuls.
- Écris les accords et les notes comme on les prononce : « ré mineur sept », « sol sept », « do majeur sept », « si bémol ».`;

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Méthode non autorisée');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'no_key' }));
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const question = clip(body.question, 2000).trim();
  if (!question) {
    res.statusCode = 400;
    res.end('Question vide');
    return;
  }
  const session = clip(body.session, 6000);
  const history = Array.isArray(body.history) ? body.history.slice(-3) : [];
  const voice = body.voice === true;

  // Chaque question part en une seule requête : les échanges précédents sont repris en texte,
  // ce qui évite de devoir rejouer l'historique complet de la conversation.
  const previous = history
    .map(h => `Élève : ${clip(h && h.q, 1000)}\nProf : ${clip(h && h.a, 2000)}`)
    .join('\n\n');
  const content = [
    previous && `Nos échanges juste avant :\n${previous}`,
    `Ce que l'app a reconnu au micro :\n${session || '(rien pour l’instant)'}`,
    `Question de l'élève : ${question}`,
  ].filter(Boolean).join('\n\n');

  const client = new Anthropic();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: voice ? SYSTEM + VOICE : SYSTEM,
      messages: [{ role: 'user', content }],
    });
    stream.on('text', delta => res.write(delta));
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      res.write('\n\n(Je ne peux pas répondre à ça. Pose-moi plutôt une question sur ton jeu au piano.)');
    } else if (message.stop_reason === 'max_tokens') {
      res.write('…');
    }
    res.end();
  } catch (error) {
    let why = 'erreur du service';
    if (error instanceof Anthropic.AuthenticationError) why = 'clé API refusée';
    else if (error instanceof Anthropic.RateLimitError) why = 'trop de demandes, réessaie dans un instant';
    else if (error instanceof Anthropic.APIConnectionError) why = 'connexion impossible';
    else if (error instanceof Anthropic.APIError) why = `erreur ${error.status}`;
    if (!res.headersSent) res.statusCode = 502;
    res.end(`\n\n(Le prof ne répond pas : ${why}.)`);
  }
}
