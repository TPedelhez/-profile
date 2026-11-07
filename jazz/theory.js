/* Truc Jazz · théorie musicale
   Notes épelées, transposition dans les 12 tonalités, degrés, accords, voicings.
   Aucune dépendance : expose globalThis.TJ (navigateur et Node). */
(function (root) {
  'use strict';

  const LETTERS = 'CDEFGAB';
  const NAT = [0, 2, 4, 5, 7, 9, 11];
  const SOLF = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];

  // Intervalle depuis Do : dl = pas de lettre, ds = demi-tons.
  // Les tonalités au-delà de Fa sont prises vers le bas pour rester au milieu du clavier.
  const KEYS = [
    { k: 'C', dl: 0, ds: 0 }, { k: 'Db', dl: 1, ds: 1 }, { k: 'D', dl: 1, ds: 2 },
    { k: 'Eb', dl: 2, ds: 3 }, { k: 'E', dl: 2, ds: 4 }, { k: 'F', dl: 3, ds: 5 },
    { k: 'Gb', dl: -3, ds: -6 }, { k: 'G', dl: -3, ds: -5 }, { k: 'Ab', dl: -2, ds: -4 },
    { k: 'A', dl: -2, ds: -3 }, { k: 'Bb', dl: -1, ds: -2 }, { k: 'B', dl: -1, ds: -1 },
  ];
  const KEY_IV = {};
  KEYS.forEach(k => { KEY_IV[k.k] = k; });

  const mod = (n, m) => ((n % m) + m) % m;

  function accVal(s) {
    if (!s) return 0;
    if (s === 'b') return -1;
    if (s === 'bb') return -2;
    if (s === '#') return 1;
    if (s === '##' || s === 'x') return 2;
    return 0;
  }
  const accStr = a => (a < 0 ? 'b'.repeat(-a) : '#'.repeat(a));
  const accSym = a => (a === -2 ? '𝄫' : a === -1 ? '♭' : a === 1 ? '♯' : a === 2 ? '𝄪' : '');

  const NOTE_RE = /^([A-G])(bb|b|##|#)?(-?\d)$/;
  function parseNote(str) {
    const m = NOTE_RE.exec(str);
    if (!m) throw new Error('Note illisible : ' + str);
    return { l: LETTERS.indexOf(m[1]), a: accVal(m[2]), o: Number(m[3]) };
  }
  const PC_RE = /^([A-G])(bb|b|##|#)?/;
  function parsePc(str) {
    const m = PC_RE.exec(str);
    if (!m) return null;
    return { l: LETTERS.indexOf(m[1]), a: accVal(m[2]), o: 4, len: m[0].length };
  }

  const midiOf = n => 12 * (n.o + 1) + NAT[n.l] + n.a;
  const pcOf = n => mod(NAT[n.l] + n.a, 12);

  // Orthographe la plus simple d'une hauteur (naturelle, sinon dièse ou bémol selon pref).
  function spellMidi(m, pref) {
    const p = mod(m, 12);
    const o = Math.floor(m / 12) - 1;
    const i = NAT.indexOf(p);
    if (i >= 0) return { l: i, a: 0, o };
    if (pref > 0) return { l: NAT.indexOf(p - 1), a: 1, o };
    return { l: NAT.indexOf(p + 1), a: -1, o };
  }

  // Transpose une note épelée d'un intervalle {dl, ds} en gardant une orthographe juste.
  function transpose(n, iv) {
    if (!iv || (!iv.dl && !iv.ds)) return { l: n.l, a: n.a, o: n.o };
    const abs = n.l + 7 * n.o + iv.dl;
    const l = mod(abs, 7);
    const o = Math.floor(abs / 7);
    const target = midiOf(n) + iv.ds;
    const a = target - (12 * (o + 1) + NAT[l]);
    if (Math.abs(a) > 1) return spellMidi(target, a);
    return { l, a, o };
  }

  // À l'affichage, on évite F♭, C♭, E♯ et B♯ : plus lisible quand on joue sur le moment.
  const ENH = { '2,1': [3, 0], '6,1': [0, 0], '3,-1': [2, 0], '0,-1': [6, 0] };
  function plain(n) {
    const k = ENH[n.l + ',' + n.a];
    return k ? { l: k[0], a: k[1], o: n.o } : n;
  }
  function noteName(n, solf) {
    const p = plain(n);
    return (solf ? SOLF[p.l] : LETTERS[p.l]) + accSym(p.a);
  }
  const rootStr = n => LETTERS[n.l] + accStr(n.a);
  function pcName(str, iv, solf) {
    const p = parsePc(str);
    return p ? noteName(transpose(p, iv), solf) : str;
  }

  // ---------- Symboles d'accords ----------
  const SLASH_RE = /\/([A-G](?:bb|b|##|#)?)$/;

  function transposeSymbol(sym, iv) {
    const p = parsePc(sym);
    if (!p) return sym;
    let rest = sym.slice(p.len);
    let bass = '';
    const sm = SLASH_RE.exec(rest);
    if (sm) {
      rest = rest.slice(0, sm.index);
      bass = '/' + rootStr(transpose(parsePc(sm[1]), iv));
    }
    return rootStr(transpose(p, iv)) + rest + bass;
  }

  function fmtSymbol(sym) {
    const p = parsePc(sym);
    if (!p) return sym;
    let rest = sym.slice(p.len);
    let bass = '';
    const sm = SLASH_RE.exec(rest);
    if (sm) {
      rest = rest.slice(0, sm.index);
      const bp = plain(parsePc(sm[1]));
      bass = '/' + LETTERS[bp.l] + accSym(bp.a);
    }
    rest = rest.replace(/b(?=\d)/g, '♭').replace(/#/g, '♯').replace(/dim7/, '°7').replace(/^dim$/, '°');
    const r = plain(p);
    return LETTERS[r.l] + accSym(r.a) + rest + bass;
  }

  function qualityOf(sfx) {
    const s = sfx || '';
    const halfdim = /m7b5|ø/.test(s);
    const dim = !halfdim && /dim|°/.test(s);
    return {
      halfdim,
      dim,
      minor: halfdim || /^(m(?!aj)|min|-)/.test(s),
      sus: /sus/.test(s),
      aug: /aug|\+|#5/.test(s),
      six: /6/.test(s) && !/13/.test(s),
    };
  }

  function degreeName(semis, q) {
    switch (semis) {
      case 0: return '1';
      case 1: return '♭9';
      case 2: return '9';
      case 3: return (q.minor || q.dim) ? '♭3' : '♯9';
      case 4: return '3';
      case 5: return q.sus ? '4' : '11';
      case 6: return (q.halfdim || q.dim) ? '♭5' : '♯11';
      case 7: return '5';
      case 8: return q.aug ? '♯5' : '♭13';
      case 9: return q.dim ? '°7' : (q.six ? '6' : '13');
      case 10: return '♭7';
      default: return '7';
    }
  }

  // Degré d'une hauteur MIDI dans un accord donné par son symbole.
  function degreeOf(sym, midi) {
    const p = parsePc(sym);
    if (!p) return '';
    const sfx = sym.slice(p.len).replace(SLASH_RE, '');
    return degreeName(mod(midi - pcOf(p), 12), qualityOf(sfx));
  }

  const DEG_ALIAS = { bb7: '°7', b10: '#9' };
  function fmtDeg(d) {
    if (!d) return '';
    const x = DEG_ALIAS[d] || d;
    return x.replace(/b/g, '♭').replace(/#/g, '♯');
  }

  // ---------- Mini-langage des pistes ----------
  // "[Dm7]D3+F3+C4:4 G2+F3+B3:4 r:2 ^C3+G3~D4+E4+A4:8"
  //   [..]   étiquette (accord, ou texte si elle commence par *), _ = espace
  //   :d     durée en temps (persistante jusqu'au prochain :d)
  //   +      notes simultanées ; ~ sépare main gauche ~ main droite
  //   =deg   degré explicite (F#4=#4) ; ^ = accord arpégé ; r = silence ; | ignoré
  function parseTrack(str, hand) {
    const events = [];
    let t = 0;
    let dur = 1;
    const toks = String(str).trim().split(/\s+/);
    for (const tok of toks) {
      if (!tok || tok === '|') continue;
      let s = tok;
      let label = null;
      const lm = /^\[([^\]]+)\](.*)$/.exec(s);
      if (lm) { label = lm[1].replace(/_/g, ' '); s = lm[2]; }
      let roll = false;
      if (s.charAt(0) === '^') { roll = true; s = s.slice(1); }
      const dm = /^(.*?):([\d.]+)$/.exec(s);
      if (dm) { s = dm[1]; dur = parseFloat(dm[2]); }
      if (s === 'r') { t += dur; continue; }
      if (!s) throw new Error('Jeton vide : ' + tok);
      const groups = s.split('~');
      const notes = [];
      groups.forEach((g, gi) => {
        if (!g) return;
        const h = groups.length > 1 ? (gi === 0 ? 'L' : 'R') : hand;
        g.split('+').forEach(ns => {
          const parts = ns.split('=');
          notes.push({ n: parseNote(parts[0]), hand: h, deg: parts[1] || null });
        });
      });
      events.push({ t, d: dur, notes, label, roll });
      t += dur;
    }
    return { events, length: t, hand };
  }

  // ---------- Accords tapés par l'utilisateur (Dépanneur) ----------
  // Degrés : [pas de lettre, demi-tons]
  const DEG = {
    '1': [0, 0], 'b9': [1, 1], '9': [1, 2], '#9': [1, 3], 'b10': [2, 3], 'b3': [2, 3], '3': [2, 4],
    '4': [3, 5], '11': [3, 5], '#11': [3, 6], 'b5': [4, 6], '5': [4, 7], '#5': [4, 8],
    'b13': [5, 8], '6': [5, 9], '13': [5, 9], 'bb7': [6, 9], 'b7': [6, 10], '7': [6, 11],
  };

  function noteFromDeg(rootPc, d) {
    const iv = DEG[d];
    return transpose({ l: rootPc.l, a: rootPc.a, o: 4 }, { dl: iv[0], ds: iv[1] });
  }
  function spellAt(sp, midi) {
    return { l: sp.l, a: sp.a, o: (midi - NAT[sp.l] - sp.a) / 12 - 1 };
  }

  // Place un voicing : 1re note main gauche >= low, puis chaque note au-dessus de la précédente.
  function placeVoicing(rootPc, v) {
    const notes = [];
    let prev = null;
    const put = (d, hand, low) => {
      const sp = noteFromDeg(rootPc, d);
      const p = pcOf(sp);
      let m = prev == null ? low : Math.max(prev + 1, low == null ? -Infinity : low);
      m += mod(p - m, 12);
      notes.push({ midi: m, sp: spellAt(sp, m), hand, deg: d, degTxt: fmtDeg(d) });
      prev = m;
    };
    v.L.forEach((d, i) => put(d, 'L', i === 0 ? v.low : null));
    (v.R || []).forEach((d, i) => put(d, 'R', i === 0 && v.lowR != null ? v.lowR : null));
    return notes;
  }

  const QUALITIES = {
    maj7: {
      name: 'Majeur 7', sfx: 'maj7', formula: ['1', '3', '5', '7'],
      tip: n => `La 9 (${n('9')}) est toujours bienvenue. Évite la quarte (${n('4')}) qui frotte contre la tierce ; si tu veux de la couleur, prends la ♯11 (${n('#11')}).`,
      v: [
        { name: 'Shell', desc: 'Fondamentale, tierce, septième. La base, à la main gauche.', L: ['1', '3', '7'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale A', desc: '3-5-7-9. Quand un bassiste joue la fondamentale.', L: ['3', '5', '7', '9'], low: 48, trick: 'rootless' },
        { name: 'Sans fondamentale B', desc: '7-9-3-5. L’autre position, pour enchaîner sans bouger.', L: ['7', '9', '3', '5'], low: 48, trick: 'rootless' },
        { name: 'Deux mains', desc: '1 et 7 en bas, 3-5-9 en haut. Ample et ouvert.', L: ['1', '7'], R: ['3', '5', '9'], low: 40, trick: 'free-tensions' },
        { name: 'Couleur lydienne', desc: 'Triade majeure un ton au-dessus, en haut : la ♯11, rêveuse.', L: ['3', '7'], R: ['9', '#11', '13'], low: 46, trick: 'ust' },
      ],
    },
    '6': {
      name: 'Majeur 6', sfx: '6', formula: ['1', '3', '5', '6'],
      tip: n => `Un accord majeur « tout nu » se joue souvent 6 ou 6/9 en jazz : la 6 (${n('6')}) et la 9 (${n('9')}) le rendent stable et doux. Parfait pour finir.`,
      v: [
        { name: 'Shell', desc: '1-3-6 : la 6 remplace la 7.', L: ['1', '3', '6'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale', desc: '3-5-6-9 : doux et stable.', L: ['3', '5', '6', '9'], low: 48, trick: 'rootless' },
        { name: '6/9 deux mains', desc: '1-5 en bas, 9-3-6 en haut. L’accord de fin par excellence.', L: ['1', '5'], R: ['9', '3', '6'], low: 40, trick: 'ending-69' },
      ],
    },
    '7': {
      name: 'Septième de dominante', sfx: '7', formula: ['1', '3', '5', 'b7'],
      tip: n => `Tout se joue sur le triton : la 3 (${n('3')}) et la ♭7 (${n('b7')}). La 9 (${n('9')}) et la 13 (${n('13')}) sont toujours permises.`,
      v: [
        { name: 'Shell', desc: '1-3-♭7 : le squelette.', L: ['1', '3', 'b7'], low: 40, trick: 'shells' },
        { name: 'Shell inversé', desc: '1-♭7-3 : pour ne pas sauter depuis l’accord d’avant.', L: ['1', 'b7', '3'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale A', desc: '3-13-♭7-9 : le son de dominante du jazz moderne.', L: ['3', '13', 'b7', '9'], low: 48, trick: 'rootless' },
        { name: 'Sans fondamentale B', desc: '♭7-9-3-13 : l’autre position.', L: ['b7', '9', '3', '13'], low: 48, trick: 'rootless' },
        { name: 'Deux mains', desc: '1 et ♭7 en bas, 3-13-9 en haut.', L: ['1', 'b7'], R: ['3', '13', '9'], low: 40, trick: 'free-tensions' },
        { name: 'Structure supérieure', desc: 'Triton en bas, triade majeure un ton au-dessus en haut : 9, ♯11, 13.', L: ['b7', '3'], R: ['9', '#11', '13'], low: 46, trick: 'ust' },
        { name: 'Version altérée', desc: 'Triton en bas, triade majeure de la ♭13 en haut : tendu, veut résoudre.', L: ['b7', '3'], R: ['b13', '1', 'b10'], low: 46, trick: 'ust' },
      ],
    },
    m7: {
      name: 'Mineur 7', sfx: 'm7', formula: ['1', 'b3', '5', 'b7'],
      tip: n => `Ce qui compte : la ♭3 (${n('b3')}) et la ♭7 (${n('b7')}). La 9 (${n('9')}) et la 11 (${n('11')}) sonnent toujours bien.`,
      v: [
        { name: 'Shell', desc: '1-♭3-♭7 : le squelette.', L: ['1', 'b3', 'b7'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale A', desc: '♭3-5-♭7-9 : rond et moderne.', L: ['b3', '5', 'b7', '9'], low: 48, trick: 'rootless' },
        { name: 'Sans fondamentale B', desc: '♭7-9-♭3-5 : l’autre position.', L: ['b7', '9', 'b3', '5'], low: 48, trick: 'rootless' },
        { name: 'Deux mains', desc: '1 et ♭7 en bas, ♭3-5-9 en haut.', L: ['1', 'b7'], R: ['b3', '5', '9'], low: 40, trick: 'free-tensions' },
        { name: 'So What', desc: 'Trois quartes et une tierce : modal, ouvert.', L: ['1', '11', 'b7'], R: ['b3', '5'], low: 40, trick: 'so-what' },
      ],
    },
    m7b5: {
      name: 'Demi-diminué', sfx: 'm7b5', formula: ['1', 'b3', 'b5', 'b7'],
      tip: n => `C’est le II d’un II-V mineur : il va presque toujours vers un accord de 7 une quarte plus haut. Sa note signature : la ♭5 (${n('b5')}).`,
      v: [
        { name: 'Shell', desc: '1-♭5-♭7 : la ♭5 le distingue d’un m7.', L: ['1', 'b5', 'b7'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale A', desc: '♭3-♭5-♭7-1 : tout sous une main.', L: ['b3', 'b5', 'b7', '1'], low: 48, trick: 'minor-ii-v' },
        { name: 'Sans fondamentale B', desc: '♭7-1-♭3-♭5 : l’autre position.', L: ['b7', '1', 'b3', 'b5'], low: 48, trick: 'minor-ii-v' },
        { name: 'Deux mains', desc: '1 et ♭7 en bas, ♭3-♭5-1 en haut.', L: ['1', 'b7'], R: ['b3', 'b5', '1'], low: 40, trick: 'minor-ii-v' },
      ],
    },
    dim7: {
      name: 'Diminué 7', sfx: 'dim7', formula: ['1', 'b3', 'b5', 'bb7'],
      tip: n => `Accord symétrique : il se répète tous les trois demi-tons. ${n('1')}, ${n('b3')}, ${n('b5')} et ${n('bb7')} donnent le même accord. Il n’en existe que trois différents.`,
      v: [
        { name: 'Serré', desc: 'Quatre notes empilées en tierces mineures.', L: ['1', 'b3', 'b5', 'bb7'], low: 48, trick: 'passing-dim' },
        { name: 'Drop 2', desc: 'La 2e note en partant du haut descend d’une octave : plus aéré.', L: ['b5', '1', 'b3', 'bb7'], low: 46, trick: 'passing-dim' },
        { name: 'Deux mains', desc: 'Fondamentale et 7 en bas, le reste en haut.', L: ['1', 'bb7'], R: ['b3', 'b5', '1'], low: 40, trick: 'passing-dim' },
      ],
    },
    m6: {
      name: 'Mineur 6', sfx: 'm6', formula: ['1', 'b3', '5', '6'],
      tip: n => `Le mineur de fin de morceau et le I des ballades mineures. La 6 (${n('6')}) remplace la 7.`,
      v: [
        { name: 'Shell', desc: '1-♭3-6.', L: ['1', 'b3', '6'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale', desc: '♭3-5-6-9 : sombre et doux.', L: ['b3', '5', '6', '9'], low: 48, trick: 'minor-ii-v' },
        { name: 'Deux mains', desc: '1-5 en bas, 6-9-♭3 en haut.', L: ['1', '5'], R: ['6', '9', 'b3'], low: 40, trick: 'line-cliche' },
      ],
    },
    mMaj7: {
      name: 'Mineur majeur 7', sfx: 'm(maj7)', formula: ['1', 'b3', '5', '7'],
      tip: () => 'Le son « film noir ». On le croise surtout dans une ligne cliché : m → m(maj7) → m7 → m6.',
      v: [
        { name: 'Shell', desc: '1-♭3-7.', L: ['1', 'b3', '7'], low: 40, trick: 'line-cliche' },
        { name: 'Sans fondamentale', desc: '♭3-5-7-9.', L: ['b3', '5', '7', '9'], low: 48, trick: 'line-cliche' },
        { name: 'Deux mains', desc: '1 et 7 en bas, ♭3-5-9 en haut.', L: ['1', '7'], R: ['b3', '5', '9'], low: 40, trick: 'line-cliche' },
      ],
    },
    '7sus': {
      name: 'Dominante sus4', sfx: '7sus4', formula: ['1', '4', '5', 'b7'],
      tip: n => `Pense « triade majeure un ton sous la fondamentale, posée sur la basse » : un accord de ${n('b7')} majeur au-dessus de ${n('1')}.`,
      v: [
        { name: 'Shell', desc: '1-4-♭7 : pas de tierce, ça flotte.', L: ['1', '4', 'b7'], low: 40, trick: 'sus-slash' },
        { name: 'Triade sur la basse', desc: 'Fondamentale et quinte en bas, triade de la ♭7 en haut.', L: ['1', '5'], R: ['b7', '9', '4'], low: 40, lowR: 53, trick: 'sus-slash' },
        { name: 'Sans fondamentale', desc: '4-5-♭7-9.', L: ['4', '5', 'b7', '9'], low: 48, trick: 'sus-slash' },
      ],
    },
    '7b9': {
      name: 'Dominante ♭9', sfx: '7b9', formula: ['1', '3', '5', 'b7', 'b9'],
      tip: n => `Il tire vers un accord mineur. Raccourci : un accord diminué construit sur la tierce (${n('3')}) donne directement 3-5-♭7-♭9.`,
      v: [
        { name: 'Shell', desc: '1-3-♭7.', L: ['1', '3', 'b7'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale A', desc: '3-13-♭7-♭9 : sombre et brillant à la fois.', L: ['3', '13', 'b7', 'b9'], low: 48, trick: 'minor-ii-v' },
        { name: 'Sans fondamentale B', desc: '♭7-♭9-3-5 : idéal avant un mineur.', L: ['b7', 'b9', '3', '5'], low: 48, trick: 'minor-ii-v' },
        { name: 'Diminué sur la 3', desc: 'Basse seule, accord diminué de la tierce en haut.', L: ['1'], R: ['3', '5', 'b7', 'b9'], low: 40, lowR: 55, trick: 'passing-dim' },
      ],
    },
    '7alt': {
      name: 'Dominante altérée', sfx: '7alt', formula: ['1', '3', 'b7', 'b9', '#9', '#11', 'b13'],
      tip: n => `Toutes les tensions altérées : ♭9, ♯9, ♯11, ♭13. Raccourci : triade majeure de ${n('b13')} à la main droite, triton (${n('3')} et ${n('b7')}) à la main gauche.`,
      v: [
        { name: 'Shell', desc: '1-3-♭7 : ajoute les tensions au-dessus.', L: ['1', '3', 'b7'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale A', desc: '3-♭13-♭7-♯9.', L: ['3', 'b13', 'b7', 'b10'], low: 48, trick: 'ust' },
        { name: 'Sans fondamentale B', desc: '♭7-♯9-3-♭13.', L: ['b7', 'b10', '3', 'b13'], low: 48, trick: 'ust' },
        { name: 'Triade de la ♭13', desc: 'Triton en bas, triade majeure de la ♭13 en haut.', L: ['b7', '3'], R: ['b13', '1', 'b10'], low: 46, trick: 'ust' },
      ],
    },
    '7#11': {
      name: 'Dominante ♯11', sfx: '7#11', formula: ['1', '3', '5', 'b7', '#11'],
      tip: n => `Le dominant lydien. Raccourci : triade majeure de ${n('9')} à la main droite, triton à la main gauche.`,
      v: [
        { name: 'Shell', desc: '1-3-♭7.', L: ['1', '3', 'b7'], low: 40, trick: 'shells' },
        { name: 'Sans fondamentale', desc: '3-♯11-♭7-9.', L: ['3', '#11', 'b7', '9'], low: 48, trick: 'ust' },
        { name: 'Structure supérieure', desc: 'Triton en bas, triade majeure un ton au-dessus en haut.', L: ['b7', '3'], R: ['9', '#11', '13'], low: 46, trick: 'ust' },
      ],
    },
    aug: {
      name: 'Augmenté', sfx: '+', formula: ['1', '3', '#5'],
      tip: n => `La quinte augmentée (${n('#5')}) veut monter d’un demi-ton. C’est souvent un accord de passage.`,
      v: [
        { name: 'Triade', desc: '1-3-♯5.', L: ['1', '3', '#5'], low: 48, trick: 'line-cliche' },
        { name: 'Deux mains', desc: 'Basse en bas, 3-♯5-1 en haut.', L: ['1'], R: ['3', '#5', '1'], low: 40, lowR: 52, trick: 'line-cliche' },
      ],
    },
  };

  const SOLF_RE = /^(do|ré|re|mi|fa|sol|la|si)/i;
  const SOLF_L = { do: 'C', 'ré': 'D', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };
  const KEEP_SFX = { '9': '9', '13': '13', m9: 'm9', m11: 'm11', maj9: 'maj9', maj13: 'maj13', '69': '6/9', '6/9': '6/9', '7#9': '7#9', '7b13': '7b13' };

  function parseUserChord(input) {
    const s = String(input || '').trim().replace(/♭/g, 'b').replace(/♯/g, '#').replace(/\s+/g, '');
    if (!s) return null;
    let letter;
    let rest;
    const sm = SOLF_RE.exec(s);
    if (sm) { letter = SOLF_L[sm[1].toLowerCase()]; rest = s.slice(sm[1].length); }
    else if (/^[a-g]/i.test(s)) { letter = s.charAt(0).toUpperCase(); rest = s.slice(1); }
    else return { error: true };

    let a = 0;
    const am = /^(bémol|bemol|dièse|diese|bb|b|##|#)/i.exec(rest);
    if (am) {
      const t = am[1].toLowerCase();
      a = t.length > 2 ? (t.charAt(0) === 'b' ? -1 : 1) : accVal(t);
      rest = rest.slice(am[1].length);
    }

    let q = rest;
    let bass = null;
    const sl = /\/([A-Ga-g](?:b|#)?)$/.exec(q);
    if (sl) { bass = sl[1].charAt(0).toUpperCase() + sl[1].slice(1); q = q.slice(0, sl.index); }
    q = q.replace(/[()]/g, '')
      .replace(/Δ/g, 'maj').replace(/ø/g, 'm7b5').replace(/°/g, 'dim')
      .replace(/^-/, 'm').replace(/^min/i, 'm')
      .replace(/7M/, 'maj7').replace(/^M(?=7|9|13|$)/, 'maj').replace(/^ma(?=7|9)/, 'maj')
      .replace(/^maj$/, 'maj7');

    let type = null;
    let note = null;
    if (/^(\+|aug)$/.test(q)) type = 'aug';
    else if (/^m(maj|M)/.test(q)) type = 'mMaj7';
    else if (/^m7?b5/.test(q)) type = 'm7b5';
    else if (/^(dim|o)/.test(q)) type = 'dim7';
    else if (/^maj/.test(q)) type = 'maj7';
    else if (/^m6/.test(q)) type = 'm6';
    else if (/^m(7|9|11|13)?$/.test(q)) {
      type = 'm7';
      if (q === 'm') note = 'Un mineur tout seul se joue souvent m7 en jazz (ou m6 pour finir un morceau).';
    }
    else if (/^(6|69|6\/9|6add9|add9|2)$/.test(q)) type = '6';
    else if (q === '') { type = '6'; note = 'Un majeur tout seul se joue souvent 6 ou maj7 en jazz.'; }
    else if (/sus|^11$/.test(q)) type = '7sus';
    else if (/^(7|9|13)?(alt|#9|b13|#5|\+)/.test(q) || (/alt|#9|b13|#5/.test(q) && /^(7|9|13)/.test(q))) type = '7alt';
    else if (/^(7|13)b9/.test(q) || /^7.*b9/.test(q)) type = '7b9';
    else if (/^(7|9|13).*(#11|b5)/.test(q)) type = '7#11';
    else if (/^(7|9|13)$/.test(q)) type = '7';
    else return { error: true };

    const rootPc = { l: LETTERS.indexOf(letter), a, o: 4 };
    const Q = QUALITIES[type];
    const sfx = KEEP_SFX[q] || Q.sfx;
    return { root: rootPc, type, q: Q, display: rootStr(rootPc) + sfx, bass, note };
  }

  function voicingsFor(chord) {
    return chord.q.v.map(v => ({ name: v.name, desc: v.desc, trick: v.trick, notes: placeVoicing(chord.root, v) }));
  }

  root.TJ = {
    LETTERS, NAT, SOLF, KEYS, KEY_IV, DEG, QUALITIES,
    mod, parseNote, parsePc, midiOf, pcOf, transpose, spellMidi,
    noteName, pcName, rootStr, transposeSymbol, fmtSymbol, qualityOf, degreeOf, degreeName, fmtDeg,
    parseTrack, noteFromDeg, parseUserChord, voicingsFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
