# Truc Jazz

Apprendre le piano jazz **sur le moment**, sans curriculum : tu dis où tu en es
(« mes accords sonnent plats », « je veux improviser », « il me faut une fin »…)
et l'app te donne un petit truc jouable dans les cinq minutes.

## Ce qu'il y a dedans

- **34 trucs indépendants** : shells, notes guides, voicings sans fondamentale,
  So What, gamme blues, note écrasée, approches chromatiques, gamme bebop,
  substitution tritonique, backdoor, diminué de passage, Charleston, walking bass,
  stride, fins 6/9… Chaque truc tient sur une fiche : l'idée, 4 étapes, un défi
  d'une minute, et des liens vers les trucs voisins (un réseau, pas un programme).
- **Tout s'écoute et se voit** sur un clavier : main gauche en bleu, main droite
  en rouge, bassiste en gris, avec les degrés (3, ♭7, 9, 13…) sur chaque note.
- **Les 12 tonalités** : chaque truc se transpose, textes compris.
- **Avant / après** : beaucoup de trucs comparent la version simple et la version jazz.
- **Dépanneur d'accords** : tape `Bb7`, `F#m7b5` ou `Sib7M` et tu obtiens
  plusieurs voicings jouables tout de suite.
- **Clavier MIDI** (Chrome, Edge) : tes notes s'allument et les formes jouées
  se cochent.
- Notation Do Ré Mi ou C D E, thème clair/sombre, hors-ligne une fois chargée.
- Ta progression (vu, acquis, à revoir) reste dans ton navigateur.

## Lancer

Aucune dépendance, aucun build. Sers le dossier avec n'importe quel serveur statique :

```sh
cd jazz && python3 -m http.server 8000
# puis http://localhost:8000
```

Avec GitHub Pages activé sur le dépôt, l'app est servie sous `/jazz/`.

## Ajouter un truc

Tout est dans `tricks.js`, écrit en Do (l'app transpose). Dans les textes,
`[[Dm7]]` est un symbole d'accord et `{{F}}` un nom de note. Les pistes
`B` (bassiste), `L` (main gauche) et `R` (main droite) utilisent un mini-langage :

```
[Dm7]D3+F3+C4:4 [G7]G2+F3+B3:4 r:2 ^C3+G3~D4+E4+A4:8
```

- `[Dm7]` étiquette l'accord (ou `[*Texte_libre]`), `:4` la durée en temps
  (elle reste valable pour les notes suivantes), `+` empile des notes,
  `~` sépare main gauche et main droite, `r` est un silence, `^` arpège l'accord,
  `F#4=#4` force le degré affiché.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `theory.js` | notes, transposition, degrés, analyse des accords, voicings |
| `tricks.js` | la bibliothèque de trucs |
| `audio.js` | piano électrique FM, contrebasse, charley (Web Audio) |
| `app.js` | interface, lecture, clavier, MIDI |
| `style.css` | le style |

## Labo d'écoute, profs IA et boîte noire

- `ecoute/` : l'app écoute le piano au micro (traitement du signal, `ecoute/detector.js`),
  vérifie la forme demandée et mesure le délai de reconnaissance.
- Profs : `api/prof.js` (OpenAI `gpt-6.1-terra`, ou Claude si `PROF_PROVIDER=anthropic`),
  `api/realtime.js` (ChatGPT temps réel, `gpt-realtime-2.1`, appel WebRTC).
- Boîte noire : `api/log.js` (événements), `api/clip.js` (~3,5 s de son autour des ratés),
  `api/sessions.js` (relecture / effacement), stockage privé Vercel Blob.
- Variables Vercel : `OPENAI_API_KEY`, `ACCESS_CODE`, `BLOB_READ_WRITE_TOKEN`
  (et `ANTHROPIC_API_KEY` pour Claude).

Analyser les sessions enregistrées (et rejouer les extraits dans le détecteur actuel) :

```sh
ACCESS_CODE=… node jazz/tools/analyse-sessions.mjs            # toutes les sessions
ACCESS_CODE=… node jazz/tools/analyse-sessions.mjs <session> --replay
```

## Studio (conversation avec Claude)

`studio/` est une page publiée comme artifact sur claude.ai : on y discute de piano avec Claude,
sur son propre compte Claude (pas d'API), en écrivant ou en dictant avec le micro du clavier du téléphone.
Claude dispose des outils de la page : `montrer` (partition abcjs + clavier + son), `jouer` (une note,
une résolution, des étapes d'un exemple, notes égrenées ; la voix lit ce qui précède, le son part, Claude
reprend quand c'est fini), `voicings`, `trucs` et `ecouter`.

L'artifact n'a pas de micro : pour qu'il sache ce que tu joues, ouvre le Labo d'écoute (`ecoute/`),
active le micro et coche « Envoyer au studio Claude ». Le Labo envoie ce qu'il reconnaît à `api/pont.js`
(Vercel Blob) ; l'artifact le relit par le connecteur Vercel de claude.ai (`web_fetch_vercel_url`) et
le joint à chaque question (« Mon piano » coché, code d'accès tapé une fois).

`studio.html` est au format artifact (sans `<html>`/`<head>`) ; la publier avec `theory.js`, `tricks.js`,
`audio.js`, `studio/cards.js`, `studio/studio.css` et `studio/studio.js`, et les capacités
`sample` et `mcp` (`{servers: [{server: "Vercel", tools: ["web_fetch_vercel_url"]}]}`).

## Studio vocal (conversation en direct)

`studio/index.html` (servi sur `/studio/`) : on parle au prof comme au téléphone (OpenAI Realtime en WebRTC,
clé éphémère via `api/realtime.js`, protégée par `ACCESS_CODE`). Il répond à voix haute et appelle les outils de la page :
`montrer` (partition + clavier + son, joué quand il a fini sa phrase), `voicings`, `trucs`, et `ecouter`
(ce que le détecteur a reconnu au micro si « Il écoute aussi mon piano » est coché), et surtout `jouer` : il fait entendre
n'importe quelle note, un intervalle, une résolution (petit clavier « Au clavier »), rejoue des étapes d'un exemple ou les
égrène note par note. Il annonce, se tait pendant que ça joue, reçoit ce qui a sonné et le mouvement de chaque voix
(avec une alerte si une voix saute), puis commente. Ta voix est transcrite dans le fil.
Réglages : version mini (environ 3 fois moins chère), boîte noire (`api/log.js`, app `studio-vocal`).
L'appel raccroche seul après 4 minutes sans échange. Les cartes musicales (`studio/cards.js`, `studio/studio.css`)
sont partagées avec le studio Claude.
