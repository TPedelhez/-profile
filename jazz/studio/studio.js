/* Truc Jazz · Studio : discuter de piano jazz avec Claude, dans un artifact claude.ai.
   Claude répond avec le compte de la personne (capacité « sample ») et dispose de trois outils
   de la page : montrer (portée + clavier + son), voicings (notes exactes d'un accord),
   trucs (bibliothèque Truc Jazz). */
(function () {
  'use strict';

  const TJ = window.TJ;
  const AU = window.TJAudio;
  const TRICKS = window.TJ_TRICKS || [];
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fr = s => s.replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
  const mod12 = m => ((m % 12) + 12) % 12;
  const isWhite = m => [0, 2, 4, 5, 7, 9, 11].indexOf(mod12(m)) >= 0;
  const HAND = { R: 'md', L: 'mg', B: 'basse' };
  const HAND_NAME = { R: 'Main droite', L: 'Main gauche', B: 'Basse' };

  // ---------- Notation Truc Jazz → événements ----------
  function parseCard(spec) {
    const src = { R: spec.md || spec.R || '', L: spec.mg || spec.L || '', B: spec.basse || spec.B || '' };
    const tracks = [];
    for (const h of ['R', 'L', 'B']) {
      const s = String(src[h] || '').trim();
      if (!s) continue;
      let tr;
      try { tr = TJ.parseTrack(s, h); } catch (e) {
        throw new Error(`${HAND_NAME[h]} : ${e.message}. Rappel : une note s'écrit lettre + altération + octave (C4, Bb3, F#4), « + » pour jouer ensemble, « :2 » pour la durée en temps.`);
      }
      if (!tr.events.length) continue;
      tracks.push({
        hand: h, length: tr.length,
        events: tr.events.map(e => ({
          t: e.t, d: e.d, roll: e.roll, label: e.label, hand: h,
          notes: e.notes.map(n => ({ midi: TJ.midiOf(n.n), sp: n.n, hand: n.hand, deg: n.deg })),
        })),
      });
    }
    if (!tracks.length) throw new Error('Aucune note : remplis au moins md, mg ou basse.');
    const length = Math.max.apply(null, tracks.map(t => t.length));
    const events = [];
    tracks.forEach(tr => tr.events.forEach(e => events.push(e)));
    events.sort((a, b) => a.t - b.t);
    return { tracks, events, length };
  }

  // Les accords étiquetés, avec les notes des autres mains qui sonnent au même moment
  function chordSteps(card) {
    const steps = [];
    card.events.forEach(e => {
      if (!e.label) return;
      const notes = [];
      // ce qui sonne à l'instant où l'accord est frappé (toutes mains confondues)
      card.events.forEach(o => { if (o.t <= e.t + 1e-6 && o.t + o.d > e.t + 1e-6) notes.push.apply(notes, o.notes); });
      const seen = new Set();
      const uniq = notes.filter(n => !seen.has(n.midi) && seen.add(n.midi)).sort((a, b) => a.midi - b.midi);
      steps.push({ t: e.t, d: e.d, label: e.label, notes: uniq });
    });
    if (!steps.length) {
      // pas d'étiquette : on prend tout ce qui sonne au début
      const first = card.events.filter(e => e.t === card.events[0].t);
      steps.push({ t: 0, d: card.length, label: null, notes: [].concat.apply([], first.map(e => e.notes)).sort((a, b) => a.midi - b.midi) });
    }
    return steps;
  }
  const isText = l => l && l.charAt(0) === '*';
  const labelText = l => (!l ? '' : isText(l) ? l.slice(1) : TJ.fmtSymbol(l));
  const degOf = (label, n) => (n.deg ? TJ.fmtDeg(n.deg) : label && !isText(label) ? TJ.degreeOf(label, n.midi) : '');
  const noteName = n => TJ.noteName(n.sp, true);
  const dslNote = sp => TJ.rootStr(sp) + sp.o;

  // ---------- Événements → partition ABC (abcjs) ----------
  const LET = 'CDEFGAB';
  function abcPitch(sp, barAcc) {
    const key = sp.l + ',' + sp.o;
    const prev = barAcc.has(key) ? barAcc.get(key) : 0;
    let acc = '';
    if (sp.a !== prev) {
      acc = sp.a === 0 ? '=' : sp.a > 0 ? '^'.repeat(sp.a) : '_'.repeat(-sp.a);
      barAcc.set(key, sp.a);
    }
    const p = sp.o >= 5 ? LET[sp.l].toLowerCase() + "'".repeat(sp.o - 5) : LET[sp.l] + ','.repeat(Math.max(0, 4 - sp.o));
    return acc + p;
  }
  const RV = [16, 12, 8, 6, 4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];
  function splitUnits(u) { // u en croches (L:1/8)
    const out = [];
    let r = Math.round(u * 4) / 4;
    while (r > 1e-6) {
      const v = RV.find(x => x <= r + 1e-6) || 0.25;
      out.push(v);
      r = Math.round((r - v) * 4) / 4;
    }
    return out;
  }
  function durStr(u) {
    if (u === 1) return '';
    if (Number.isInteger(u)) return String(u);
    const map = { 1.5: '3/2', 0.75: '3/4', 0.5: '/2', 0.25: '/4' };
    return map[u] || String(u);
  }
  function trackAbc(track, total, bar) {
    const q = x => Math.round(x * 16) / 16;
    const evs = track.events.map(e => ({ t: q(e.t), d: e.d, notes: e.notes, label: e.label, roll: e.roll }));
    // notes très brèves (note écrasée) → petites notes d'agrément accrochées à la suivante
    for (let i = 0; i < evs.length - 1; i++) {
      if (evs[i].d < 0.13 && evs[i].notes.length) {
        evs[i + 1].grace = (evs[i + 1].grace || []).concat(evs[i].notes);
        evs[i + 1].d += evs[i + 1].t - evs[i].t;
        evs[i + 1].t = evs[i].t;
        evs[i].skip = true;
      }
    }
    const out = [];
    let pos = 0;
    let barAcc = new Map();
    const advance = beats => {
      pos = Math.round((pos + beats) * 16) / 16;
      if (Math.abs(pos % bar) < 1e-6 && pos < total - 1e-6) { out.push('|'); barAcc = new Map(); }
    };
    const span = (beats, content, opts) => {
      let remain = Math.round(beats * 16) / 16;
      let first = true;
      while (remain > 1e-6) {
        const toBar = bar - (pos % bar);
        const chunk = Math.min(remain, toBar);
        const parts = splitUnits(chunk * 2);
        parts.forEach((u, i) => {
          const lastOfAll = i === parts.length - 1 && Math.abs(remain - chunk) < 1e-6;
          let tok = '';
          if (first && opts.prefix) tok += opts.prefix;
          tok += content() + durStr(u);
          if (opts.tie && !lastOfAll) tok += '-';
          out.push(tok);
          first = false;
          advance(u / 2);
        });
        remain = Math.round((remain - chunk) * 16) / 16;
      }
    };
    evs.forEach(e => {
      if (e.skip) return;
      if (e.t > pos + 1e-6) span(e.t - pos, () => 'z', {});
      const d = Math.max(0.125, Math.round(Math.min(e.d, total - e.t) * 16) / 16);
      let prefix = '';
      if (e.label) prefix += isText(e.label) ? `"^${labelText(e.label).replace(/"/g, '')}"` : `"${labelText(e.label)}"`;
      if (e.grace) prefix += '{' + e.grace.map(n => abcPitch(n.sp, barAcc)).join('') + '}';
      if (e.roll && e.notes.length > 1) prefix += '!arpeggio!';
      const sorted = e.notes.slice().sort((a, b) => a.midi - b.midi);
      const content = () => (sorted.length === 1 ? abcPitch(sorted[0].sp, barAcc) : '[' + sorted.map(n => abcPitch(n.sp, barAcc)).join('') + ']');
      span(d, content, { prefix, tie: true });
    });
    if (pos < total - 1e-6) span(total - pos, () => 'z', {});
    return out.join(' ') + ' |]';
  }
  function cardAbc(card, spec) {
    const bar = 4;
    const total = Math.ceil(card.length / bar - 1e-6) * bar;
    const lines = ['X:1', 'M:4/4', 'L:1/8', `Q:1/4=${spec.tempo || 100}`, 'K:C'];
    const voices = [];
    card.tracks.forEach(tr => {
      const midis = [].concat.apply([], tr.events.map(e => e.notes.map(n => n.midi))).sort((a, b) => a - b);
      const medi = midis[Math.floor(midis.length / 2)];
      const clef = tr.hand === 'R' ? 'treble' : tr.hand === 'B' ? 'bass' : (medi < 60 ? 'bass' : 'treble');
      voices.push({ id: voices.length + 1, hand: tr.hand, clef, abc: trackAbc(tr, total, bar) });
    });
    const vR = voices.find(v => v.hand === 'R');
    const vL = voices.find(v => v.hand === 'L');
    const vB = voices.find(v => v.hand === 'B');
    let score = '';
    if (vR && vL) score = `{${vR.id} ${vL.id}}` + (vB ? ` ${vB.id}` : '');
    else score = voices.map(v => v.id).join(' ');
    if (voices.length > 1) lines.push(`%%score ${score}`);
    const short = { R: 'MD', L: 'MG', B: 'Basse' };
    voices.forEach(v => {
      lines.push(`V:${v.id} clef=${v.clef}` + (voices.length > 1 ? ` name="${short[v.hand]}"` : ''));
      lines.push((spec.swing && v === voices[0] ? '"^Swing" ' : '') + v.abc);
    });
    return lines.join('\n');
  }

  // ---------- Clavier ----------
  function kbRange(midis) {
    let lo = Math.min.apply(null, midis) - 3;
    let hi = Math.max.apply(null, midis) + 3;
    while (mod12(lo) !== 0 && mod12(lo) !== 5) lo--;
    while (mod12(hi) !== 4 && mod12(hi) !== 11) hi++;
    while (hi - lo < 23) { hi++; while (mod12(hi) !== 4 && mod12(hi) !== 11) hi++; }
    return [Math.max(21, lo), Math.min(108, hi)];
  }
  function kbHtml(lo, hi) {
    const whites = [];
    for (let m = lo; m <= hi; m++) if (isWhite(m)) whites.push(m);
    let h = `<div class="kb" style="--nw:${whites.length}">`;
    whites.forEach((m, i) => { h += `<div class="k w" data-m="${m}" style="--i:${i}"><span class="lab"></span></div>`; });
    for (let m = lo; m <= hi; m++) if (!isWhite(m)) h += `<div class="k b" data-m="${m}" style="--i:${whites.indexOf(m - 1) + 1}"><span class="lab"></span></div>`;
    return h + '</div>';
  }
  function paintKb(root, map) {
    root.querySelectorAll('.k').forEach(k => {
      const m = Number(k.dataset.m);
      const v = map.get(m);
      const cls = (isWhite(m) ? 'k w' : 'k b') + (v ? ' on-' + v.hand : '');
      if (k.className !== cls) k.className = cls;
      const lab = v ? esc(v.name) + (v.deg ? `<i>${esc(v.deg)}</i>` : '') : '';
      if (k.firstChild.innerHTML !== lab) k.firstChild.innerHTML = lab;
    });
  }

  // ---------- Lecture ----------
  const P = { card: null, raf: 0, sched: [], endAt: 0, stepIdx: -1 };
  function beatSec(bpm, swing, beat) {
    const spb = 60 / bpm;
    if (!swing) return beat * spb;
    const b = Math.floor(beat + 1e-9);
    const x = beat - b;
    return (b + (x <= 0.5 ? x * 4 / 3 : 2 / 3 + (x - 0.5) * 2 / 3)) * spb;
  }
  function stop() {
    if (!P.card) return;
    cancelAnimationFrame(P.raf);
    AU.stopAll();
    const el = P.card.el;
    el.querySelector('.play').classList.remove('on');
    el.querySelector('.play span').textContent = 'Écouter';
    showStep(P.card, P.card.sel);
    P.card = null;
  }
  function play(cardObj) {
    stop();
    if (!AU.ensure()) return;
    const { card, spec } = cardObj;
    const bpm = Number(spec.tempo) || 100;
    const swing = !!spec.swing;
    const t0 = AU.now() + 0.08;
    P.sched = [];
    card.events.forEach(ev => {
      const s = t0 + beatSec(bpm, swing, ev.t);
      const e = t0 + beatSec(bpm, swing, ev.t + ev.d);
      const n = ev.notes.length;
      const accent = swing && Math.abs(ev.t - Math.floor(ev.t + 1e-9) - 0.5) < 0.01 ? 1.15 : 1;
      ev.notes.forEach((nt, i) => {
        const st = s + (ev.roll ? i * 0.11 : n > 1 ? i * 0.005 : 0);
        const dur = Math.max(0.05, (e - st) * (n > 1 ? 0.95 : 0.9));
        if (nt.hand === 'B') AU.bass(nt.midi, st, dur, 0.9);
        else AU.ep(nt.midi, st, dur, Math.min(1, (n > 1 ? 1.25 / Math.sqrt(n) : 0.85) * accent));
        P.sched.push({ s: st, e: st + dur, m: nt.midi, hand: nt.hand, name: noteName(nt), label: ev.label });
      });
    });
    if (spec.charley) for (let b = 1; b < card.length; b += 2) AU.hat(t0 + beatSec(bpm, swing, b), 1);
    P.endAt = t0 + beatSec(bpm, swing, card.length) + 0.3;
    P.card = cardObj;
    P.t0 = t0;
    cardObj.el.querySelector('.play').classList.add('on');
    cardObj.el.querySelector('.play span').textContent = 'Stop';
    const tick = () => {
      if (P.card !== cardObj) return;
      const t = AU.now();
      if (t > P.endAt) { stop(); return; }
      const map = new Map();
      P.sched.forEach(x => { if (x.s <= t && t < x.e) map.set(x.m, { hand: x.hand, name: x.name }); });
      paintKb(cardObj.el.querySelector('.kbw'), map);
      const beat = (t - t0) / (60 / bpm);
      let idx = -1;
      cardObj.steps.forEach((st, i) => { if (st.t <= beat + 1e-3) idx = i; });
      cardObj.el.querySelectorAll('.step').forEach((b, i) => b.classList.toggle('now', i === idx));
      P.raf = requestAnimationFrame(tick);
    };
    P.raf = requestAnimationFrame(tick);
  }
  function showStep(cardObj, i) {
    cardObj.sel = i;
    const st = cardObj.steps[i];
    const map = new Map();
    if (st) st.notes.forEach(n => map.set(n.midi, { hand: n.hand, name: noteName(n), deg: degOf(st.label, n) }));
    paintKb(cardObj.el.querySelector('.kbw'), map);
    cardObj.el.querySelectorAll('.step').forEach((b, j) => { b.classList.toggle('sel', j === i); b.classList.remove('now'); });
  }
  function playStep(cardObj, i) {
    stop();
    showStep(cardObj, i);
    if (!AU.ensure()) return;
    const st = cardObj.steps[i];
    const t = AU.now() + 0.02;
    st.notes.forEach((n, j) => {
      if (n.hand === 'B') AU.bass(n.midi, t, 1.6, 0.9);
      else AU.ep(n.midi, t + j * 0.02, 1.8, 1.2 / Math.sqrt(st.notes.length));
    });
  }

  // ---------- Cartes musicales ----------
  function buildCard(spec, n) {
    const card = parseCard(spec);
    const steps = chordSteps(card);
    const el = document.createElement('figure');
    el.className = 'card';
    const midis = [].concat.apply([], card.events.map(e => e.notes.map(x => x.midi)));
    const [lo, hi] = kbRange(midis);
    el.innerHTML = `
      <figcaption class="card-head">
        <span class="card-n">Exemple ${n}</span>
        <span class="card-t">${esc(spec.titre || 'Exemple')}</span>
        <button class="play" type="button"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg><span>Écouter</span></button>
      </figcaption>
      <div class="sheet" aria-label="Partition"><div class="abc"></div></div>
      <div class="steps">${steps.map((s, i) => `<button class="step" type="button" data-i="${i}">
        <span class="sym">${esc(labelText(s.label) || 'Notes')}</span>
        <span class="step-notes">${s.notes.map(x => esc(noteName(x)) + (degOf(s.label, x) ? `<sub>${esc(degOf(s.label, x))}</sub>` : '')).join(' ')}</span></button>`).join('')}</div>
      <div class="dockk"><div class="felt" aria-hidden="true"></div><div class="kbw">${kbHtml(lo, hi)}</div></div>
      ${spec.explication ? `<p class="card-x">${esc(spec.explication)}</p>` : ''}`;
    const obj = { n, spec, card, steps, el, sel: 0 };
    const abc = cardAbc(card, spec);
    obj.abc = abc;
    try {
      if (window.ABCJS) window.ABCJS.renderAbc(el.querySelector('.abc'), abc, { responsive: 'resize', add_classes: true, paddingtop: 4, paddingbottom: 4, paddingleft: 2, paddingright: 8, scale: 1 });
      else el.querySelector('.sheet').hidden = true;
    } catch (e) { el.querySelector('.sheet').hidden = true; }
    el.querySelector('.play').addEventListener('click', () => { if (P.card === obj) stop(); else play(obj); });
    el.querySelectorAll('.step').forEach(b => b.addEventListener('click', () => playStep(obj, Number(b.dataset.i))));
    el.querySelectorAll('.kbw .k').forEach(k => k.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      if (AU.ensure()) AU.ep(Number(k.dataset.m), AU.now() + 0.01, 0.9, 0.75);
    }));
    requestAnimationFrame(() => {
      showStep(obj, 0);
      const w = el.querySelector('.kbw');
      w.scrollLeft = Math.max(0, (w.scrollWidth - w.clientWidth) / 2);
    });
    return obj;
  }
  function cardSummary(obj) {
    return `Exemple ${obj.n} « ${obj.spec.titre || ''} » : ` + obj.steps.map(s => `${labelText(s.label) || 'notes'} = ${s.notes.map(x => noteName(x) + (degOf(s.label, x) ? '(' + degOf(s.label, x) + ')' : '')).join(' ')}`).join(' ; ');
  }

  // ---------- Outils pour Claude ----------
  let currentMsg = null; // message assistant en cours
  function toolMontrer(input) {
    const spec = {
      titre: String(input.titre || 'Exemple').slice(0, 80),
      md: input.md ? String(input.md) : '', mg: input.mg ? String(input.mg) : '', basse: input.basse ? String(input.basse) : '',
      tempo: Math.max(40, Math.min(240, Number(input.tempo) || 100)), swing: !!input.swing, charley: !!input.charley,
      explication: input.explication ? String(input.explication).slice(0, 300) : '',
    };
    const obj = buildCard(spec, currentMsg ? currentMsg.cards.length + 1 : 1); // lève une erreur lisible si la notation est fausse
    if (currentMsg) { currentMsg.cardsEl.appendChild(obj.el); currentMsg.cards.push(spec); }
    setStatus(`Exemple ${obj.n} affiché`);
    if (input.jouer) setTimeout(() => play(obj), 300);
    return cardSummary(obj) + '. Affiché avec la partition et le clavier ; l’élève peut l’écouter.';
  }
  function toolVoicings(input) {
    const r = TJ.parseUserChord(String(input.accord || ''));
    if (!r || r.error) throw new Error(`Accord non reconnu : « ${input.accord} ». Exemples valides : Bb7, Dm7, F#m7b5, Ab7b9, Cmaj7, G7sus4, C6/9.`);
    const vs = TJ.voicingsFor(r);
    return {
      accord: TJ.fmtSymbol(r.display), famille: r.q.name, formule: r.q.formula.map(TJ.fmtDeg).join(' '),
      voicings: vs.map(v => ({
        nom: v.name, conseil: v.desc,
        mg: v.notes.filter(x => x.hand === 'L').map(x => dslNote(x.sp)).join('+'),
        md: v.notes.filter(x => x.hand === 'R').map(x => dslNote(x.sp)).join('+'),
        degres: v.notes.map(x => x.degTxt).join(' '),
        notes: v.notes.map(x => TJ.noteName(x.sp, true)).join(' '),
      })),
      usage: `Pour l'afficher : montrer({titre, mg: "[${r.display}]<notes mg>:4", md: "<notes md>:4"}).`,
    };
  }
  const plainTxt = s => String(s).replace(/\[\[([^\]]+)\]\]/g, (m, c) => TJ.fmtSymbol(c)).replace(/\{\{([A-G](?:bb|b|##|#)?)\}\}/g, (m, n) => TJ.pcName(n, null, true));
  function toolTrucs(input) {
    if (input.id) {
      const t = TRICKS.find(x => x.id === String(input.id));
      if (!t) throw new Error('Truc introuvable. Appelle trucs sans id pour la liste.');
      return {
        id: t.id, titre: plainTxt(t.title), idee: plainTxt(t.hook), explication: t.body.map(plainTxt), etapes: t.steps.map(plainTxt), defi: plainTxt(t.dare),
        exemples_en_do: t.versions.map(v => ({ nom: plainTxt(v.name), md: v.R || '', mg: v.L || '', basse: v.B || '', tempo: v.bpm || t.bpm, swing: v.swing != null ? v.swing : !!t.swing })),
        voisins: t.next,
      };
    }
    const q = String(input.recherche || '').toLowerCase();
    return TRICKS.filter(t => !q || (t.title + ' ' + t.hook + ' ' + t.tags.join(' ')).toLowerCase().indexOf(q) >= 0)
      .map(t => ({ id: t.id, titre: plainTxt(t.title), themes: t.tags.join(', ') }));
  }
  const TOOLS = [
    {
      name: 'montrer',
      description: 'Affiche un exemple musical dans la conversation : partition, clavier coloré avec les degrés, bouton Écouter. À appeler pour chaque accord, voicing, gamme, grille ou phrase dont tu parles. Renvoie ce qui a été affiché (numéro, notes, degrés) ou une erreur de notation à corriger.',
      inputSchema: {
        type: 'object',
        properties: {
          titre: { type: 'string', description: 'Titre court de l’exemple' },
          md: { type: 'string', description: 'Main droite en notation Truc Jazz (clé de sol)' },
          mg: { type: 'string', description: 'Main gauche en notation Truc Jazz' },
          basse: { type: 'string', description: 'Ligne de bassiste (facultatif)' },
          tempo: { type: 'number', description: 'Noires par minute, 100 par défaut' },
          swing: { type: 'boolean', description: 'Croches swing à l’écoute' },
          charley: { type: 'boolean', description: 'Charley sur 2 et 4 à l’écoute' },
          explication: { type: 'string', description: 'Une phrase sous l’exemple (facultatif)' },
          jouer: { type: 'boolean', description: 'Le faire entendre tout de suite' },
        },
        required: ['titre'],
      },
      execute: toolMontrer,
    },
    {
      name: 'voicings',
      description: 'Donne plusieurs façons justes de jouer un accord (shell, sans fondamentale, deux mains, structures supérieures…) avec les notes exactes en notation Truc Jazz et leurs degrés. À utiliser avant de montrer un voicing. Accepte Bb7, Dm7, F#m7b5, Ab7b9, Sib7M, G7sus4, C6/9…',
      inputSchema: { type: 'object', properties: { accord: { type: 'string' } }, required: ['accord'] },
      execute: toolVoicings,
    },
    {
      name: 'trucs',
      description: 'Bibliothèque Truc Jazz (34 petits trucs de piano jazz). Sans argument ou avec recherche : liste {id, titre}. Avec id : le détail (idée, explication, étapes, défi) et ses exemples en Do en notation Truc Jazz, prêts pour montrer.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, recherche: { type: 'string' } } },
      execute: toolTrucs,
    },
  ];

  const RULES = `Tu es le prof de piano jazz du « Studio Truc Jazz ». Tu discutes avec un élève qui apprend le jazz sur le moment, par petits trucs, sans programme. Tu tutoies, en français, ton chaleureux et concret, phrases courtes.

Règle d'or : dès que tu parles de notes concrètes (accord, voicing, gamme, phrase, grille), appelle l'outil « montrer » pour l'afficher (partition + clavier + son), puis parles-en en le citant (« l'exemple 2 »). Un exemple court et juste vaut mieux qu'une longue explication. Pour les notes d'un voicing, appelle d'abord « voicings » : il donne les notes exactes. Pour un truc de la bibliothèque, appelle « trucs ».

Notation Truc Jazz pour « montrer » (une chaîne par main, md / mg / basse) :
- une note = lettre + altération + octave : C4 est le do du milieu ; Bb3, F#4, Eb2. Dans la notation, toujours des lettres.
- notes jouées ensemble reliées par + : D3+F3+C4
- durée en temps après « : » (1 = noire, 0.5 = croche, 2 = blanche, 4 = ronde) ; elle vaut pour les notes suivantes jusqu'au prochain « : »
- r = silence (r:1) ; [Dm7] juste avant une note = symbole d'accord affiché (sert aussi à calculer les degrés) ; [*texte] = annotation
- mg et md avancent en parallèle : donne-leur la même durée totale. Mesure à 4 temps. Exemples courts : 1 à 4 mesures.
Exemple II-V-I en shells : mg = "[Dm7]D3+F3+C4:4 [G7]G2+F3+B3:4 [Cmaj7]C3+E3+B3:8"
Exemple de phrase : md = "A4:0.5 C5 E5 D5 C5 A4 G4:1 E4:4", mg = "[Am7]A2+G3+C4:4 [Dm7]D3+F3+C4:4"

Dans ton texte : noms de notes en Do Ré Mi (ré, fa, si bémol), symboles d'accords en lettres (Dm7, G7). Réponses courtes (100 à 200 mots) sauf si l'élève demande plus. Pas de titres. Finis souvent par une petite chose à essayer tout de suite au piano.`;

  // ---------- Voix : Claude lit ses réponses à voix haute ----------
  const SPOKEN_ROOT = { C: 'do', D: 'ré', E: 'mi', F: 'fa', G: 'sol', A: 'la', B: 'si' };
  const SPOKEN_Q = [
    [/^maj9$/, 'majeur neuf'], [/^maj7#11$|^maj7♯11$/, 'majeur sept quarte augmentée'], [/^maj7$/, 'majeur sept'], [/^m7b5$|^m7♭5$|^ø$/, 'demi-diminué'],
    [/^m\(maj7\)$|^mMaj7$/, 'mineur majeur sept'], [/^m9$/, 'mineur neuf'], [/^m11$/, 'mineur onze'], [/^m7$/, 'mineur sept'], [/^m6$/, 'mineur six'],
    [/^m$/, 'mineur'], [/^dim7$|^°7$/, 'diminué sept'], [/^7sus4$/, 'sept sus quatre'], [/^7alt$/, 'sept altéré'], [/^7b9$|^7♭9$/, 'sept bémol neuf'],
    [/^7#9$|^7♯9$/, 'sept dièse neuf'], [/^7#11$|^7♯11$/, 'sept quarte augmentée'], [/^6\/9$/, 'six neuf'], [/^13$/, 'treize'], [/^9$/, 'neuf'], [/^7$/, 'sept'], [/^6$/, 'six'],
  ];
  function spokenChord(sym) {
    const m = /^([A-G])(b|#|♭|♯)?(.*)$/.exec(sym);
    if (!m) return sym;
    let out = SPOKEN_ROOT[m[1]] + (m[2] ? (/b|♭/.test(m[2]) ? ' bémol' : ' dièse') : '');
    const q = SPOKEN_Q.find(([re]) => re.test(m[3]));
    return out + (m[3] ? ' ' + (q ? q[1] : m[3]) : ' majeur');
  }
  function spokenText(t) {
    return t.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]/g, '').replace(/^\s*([-•]|\d+[.)])\s+/gm, '')
      .replace(SYM_RE, (x, sym) => spokenChord(sym))
      .replace(/♭(\d+)/g, 'bémol $1').replace(/♯(\d+)/g, 'dièse $1').replace(/♭/g, ' bémol').replace(/♯/g, ' dièse')
      .replace(/\s+/g, ' ').trim();
  }
  const VOICE = {
    ok: 'speechSynthesis' in window,
    voice: null,
    spoken: 0,
    pick() {
      if (!this.ok) return;
      const vs = speechSynthesis.getVoices().filter(v => /^fr(-|_|$)/i.test(v.lang));
      const score = v => (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0) + (/am[ée]lie|thomas|audrey|aur[ée]lie|marie|daniel/i.test(v.name) ? 2 : 0) + (/fr-FR/i.test(v.lang) ? 1 : 0);
      this.voice = vs.sort((a, b) => score(b) - score(a))[0] || null;
    },
    unlock() { if (!this.ok) return; this.pick(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); },
    say(t) {
      const txt = spokenText(t);
      if (!this.ok || !txt) return;
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = 'fr-FR';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.07;
      speechSynthesis.speak(u);
    },
    // lit chaque phrase dès qu'elle est complète
    feed(text, final) {
      if (!this.ok || !$('speak').checked) return;
      for (;;) {
        const rest = text.slice(this.spoken);
        const m = final ? /^[\s\S]+$/.exec(rest) : /^[\s\S]*?[.!?…:](\s|$)/.exec(rest);
        if (!m || !m[0].trim()) break;
        this.spoken += m[0].length;
        this.say(m[0]);
        if (final) break;
      }
    },
    reset() { this.spoken = 0; if (this.ok) speechSynthesis.cancel(); },
  };
  if (VOICE.ok) { VOICE.pick(); speechSynthesis.onvoiceschanged = () => VOICE.pick(); }

  // ---------- Conversation ----------
  const STORE = 'tj-studio:v1';
  let turns = []; // {role, text, cards:[spec]}
  try { turns = JSON.parse(localStorage.getItem(STORE) || '[]') || []; } catch (e) { turns = []; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(turns.slice(-40))); } catch (e) { /* stockage indisponible */ } };

  // Petit rendu Markdown sûr (paragraphes, listes, gras, italique, code, symboles d'accords)
  const SYM_RE = /\b([A-G](?:b|#|♭|♯)?(?:maj9|maj7|m7b5|m7♭5|m\(maj7\)|mMaj7|m9|m7|m6|m11|dim7|°7|7sus4|7alt|7b9|7♭9|7#9|7♯9|7#11|7♯11|6\/9|13|9|7|6|m|ø))(?=[\s,.;:!?)\]]|$)/g;
  function md(text) {
    const inline = s => esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(SYM_RE, '<span class="sym">$1</span>');
    const blocks = text.trim().split(/\n{2,}/);
    return blocks.map(b => {
      const lines = b.split('\n');
      if (lines.every(l => /^\s*([-•*]|\d+[.)])\s+/.test(l))) {
        const ordered = /^\s*\d/.test(lines[0]);
        return `<${ordered ? 'ol' : 'ul'}>${lines.map(l => `<li>${inline(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ''))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }
  function msgEl(role, text, cards) {
    const wrap = document.createElement('article');
    wrap.className = 'msg ' + (role === 'user' ? 'me' : 'prof');
    wrap.innerHTML = `<div class="bubble">${role === 'user' ? `<p>${esc(text)}</p>` : md(text || '')}</div><div class="cards"></div>`;
    const m = { el: wrap, textEl: wrap.querySelector('.bubble'), cardsEl: wrap.querySelector('.cards'), cards: [] };
    (cards || []).forEach(spec => { try { const o = buildCard(spec, m.cards.length + 1); m.cardsEl.appendChild(o.el); m.cards.push(spec); } catch (e) { /* carte illisible */ } });
    $('thread').appendChild(wrap);
    return m;
  }
  function scrollDown() { const t = $('thread'); const last = t.lastElementChild; if (last) last.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
  function setStatus(s) { $('status').textContent = s || ''; }

  // Ce que Claude relit des échanges passés (il ne garde rien entre deux appels)
  function history() {
    const h = turns.slice(-16).map(t => ({
      role: t.role,
      content: t.role === 'assistant' && t.cards && t.cards.length
        ? (t.text || '(exemples)') + '\n\n[Exemples affichés dans ce message : ' + t.cards.map((c, i) => `${i + 1}. ${c.titre} — ${['md', 'mg', 'basse'].filter(k => c[k]).map(k => `${k}: ${c[k]}`).join(' ; ')}`).join(' | ') + ']'
        : t.text || '…',
    }));
    while (h.length && h[0].role !== 'user') h.shift();
    const rules = tools ? RULES : RULES + '\n\nIci tu n’as pas d’outils : pour chaque exemple, écris un bloc ```exemple {"titre": "…", "mg": "…", "md": "…", "tempo": 100}``` (JSON valide, notation Truc Jazz). La page l’affiche avec partition, clavier et son.';
    return [{ role: 'user', content: rules }].concat(h);
  }

  let sample = null;
  let tools = false;
  let busy = null;
  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    AU.ensure(); // le geste de l'élève autorise le son pour la suite
    stop();
    VOICE.reset();
    if ($('speak').checked) VOICE.unlock();
    turns.push({ role: 'user', text });
    save();
    $('ideas').hidden = true;
    msgEl('user', text);
    const m = msgEl('assistant', '');
    m.textEl.innerHTML = '<p class="thinking">Claude réfléchit…</p>';
    currentMsg = m;
    scrollDown();
    const ctl = new AbortController();
    busy = ctl;
    $('sendBtn').hidden = true;
    $('stopBtn').hidden = false;
    setStatus('');
    let finalText = '';
    try {
      const opts = { signal: ctl.signal, cache: false, onText: ({ text: t }) => { finalText = t; m.textEl.innerHTML = md(t); VOICE.feed(t, false); } };
      if (tools) opts.tools = TOOLS;
      // rapide par défaut : pas de réflexion préalable, chaque aller-retour d'outil prend environ une seconde
      opts.modelTier = $('deep').checked ? 'default' : 'quick';
      const r = await sample(history(), opts);
      finalText = r.text;
      m.textEl.innerHTML = md(r.text);
      VOICE.feed(r.text, true);
      if (r.truncated) setStatus('Réponse coupée : demande-lui la suite.');
      if (!tools) parseFallbackCards(m, r.text);
    } catch (e) {
      const keep = e && e.text;
      finalText = keep || '';
      m.textEl.innerHTML = keep ? md(keep) : '';
      const copy = {
        cancelled: 'Arrêté.', not_granted: 'Tu n’as pas autorisé le studio à utiliser Claude. Recharge la page pour qu’il te le redemande.',
        sampling_disabled: 'Claude n’est pas disponible pour ce compte.', rate_limited: 'Trop de demandes d’un coup ou limite d’usage atteinte : réessaie dans un moment.',
        session_expired: 'Reconnecte-toi à Claude, puis réessaie.', refused: 'Claude n’a pas voulu répondre à ça : reformule ta question.',
        prompt_too_large: 'La conversation est trop longue : touche « Nouvelle conversation ».', tools_unavailable: 'Les exemples ne sont pas disponibles ici.',
      }[e && e.code] || 'Claude ne répond pas pour le moment. Réessaie.';
      setStatus(copy);
      if (!keep && !m.cards.length) m.el.remove();
    } finally {
      busy = null;
      currentMsg = null;
      $('sendBtn').hidden = false;
      $('stopBtn').hidden = true;
      if (finalText || m.cards.length) { turns.push({ role: 'assistant', text: finalText, cards: m.cards }); save(); }
    }
  }
  // Sans outils de page : Claude écrit ses exemples dans des blocs ```exemple {json}```
  function parseFallbackCards(m, text) {
    const re = /```exemple\s*([\s\S]*?)```/g;
    let x;
    while ((x = re.exec(text))) {
      try { const spec = JSON.parse(x[1]); const o = buildCard(spec, m.cards.length + 1); m.cardsEl.appendChild(o.el); m.cards.push(spec); } catch (e) { /* bloc illisible */ }
    }
    m.textEl.innerHTML = md(text.replace(re, ''));
  }

  // ---------- Démarrage ----------
  const DEMO = {
    titre: 'II-V-I en Do, en shells', mg: '[Dm7]D3+F3+C4:4 [G7]G2+F3+B3:4 [Cmaj7]C3+E3+B3:8', tempo: 80,
    explication: 'Touche un accord pour l’entendre seul, ou Écouter pour l’enchaînement.',
  };
  function renderAll() {
    $('thread').innerHTML = '';
    if (!turns.length) {
      const m = msgEl('assistant', 'Salut ! Pose-moi n’importe quelle question sur le piano jazz. Quand je parle de notes, je te les montre sur la portée et le clavier, et tu peux les écouter. Par exemple, voici le II-V-I, l’enchaînement le plus joué du jazz :', [DEMO]);
      m.el.classList.add('intro');
    }
    turns.forEach(t => msgEl(t.role, t.text, t.cards));
    $('ideas').hidden = turns.length > 0;
    requestAnimationFrame(scrollDown);
  }
  function wire() {
    $('composer').addEventListener('submit', e => { e.preventDefault(); const v = $('q').value; $('q').value = ''; autosize(); send(v); });
    $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
    $('q').addEventListener('input', autosize);
    $('stopBtn').addEventListener('click', () => { if (busy) busy.abort(); VOICE.reset(); });
    // préférences gardées sur cet appareil
    ['deep', 'speak'].forEach(id => {
      try { const v = localStorage.getItem('tj-studio:' + id); if (v != null) $(id).checked = v === '1'; } catch (e) { /* rien */ }
      $(id).addEventListener('change', () => { try { localStorage.setItem('tj-studio:' + id, $(id).checked ? '1' : '0'); } catch (e) { /* rien */ } if (id === 'speak' && !$(id).checked) VOICE.reset(); });
    });
    if (!VOICE.ok) $('speakLbl').hidden = true;
    $('newBtn').addEventListener('click', () => { if (busy) busy.abort(); stop(); turns = []; save(); renderAll(); setStatus('Nouvelle conversation.'); });
    document.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => { $('q').value = b.dataset.ask; send(b.dataset.ask); $('q').value = ''; }));
  }
  function autosize() { const q = $('q'); q.style.height = 'auto'; q.style.height = Math.min(160, q.scrollHeight) + 'px'; }

  renderAll();
  wire();
  (async () => {
    const use = window.claude && window.claude.use ? window.claude.use.bind(window.claude) : null;
    sample = use ? await use('sample') : null;
    if (!sample) {
      $('q').disabled = true;
      $('sendBtn').disabled = true;
      setStatus('Ouvre ce studio dans Claude pour discuter : il utilise ton compte Claude. Les exemples restent jouables.');
      return;
    }
    try { const lim = await sample.limits(); tools = !!(lim && lim.tools && lim.tools.maxCount >= TOOLS.length); } catch (e) { tools = false; }
    $('q').disabled = false;
    $('sendBtn').disabled = false;
  })();
})();
