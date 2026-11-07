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
