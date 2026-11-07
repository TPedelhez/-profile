/* Truc Jazz · interface
   Pas de curriculum : on part de la situation du moment, on tire un truc, on le joue. */
(function () {
  'use strict';

  const TJ = window.TJ;
  const AU = window.TJAudio;
  const TRICKS = window.TJ_TRICKS;
  const BY_ID = {};
  TRICKS.forEach(t => { BY_ID[t.id] = t; });

  const has = (t, tag) => t.tags.indexOf(tag) >= 0;
  const TAGS = {
    voicings: 'Accords', impro: 'Impro', comping: 'Accompagner', groove: 'Groove',
    reharmo: 'Réharmo', 'intro-fin': 'Intros et fins', 'main-gauche': 'Main gauche',
  };
  const LEVEL = ['', 'Facile', 'Moyen', 'Corsé'];
  const SITUATIONS = [
    { id: 'plats', title: 'Mes accords sonnent plats', sub: 'Des voicings qui sonnent jazz tout de suite', test: t => has(t, 'voicings') },
    { id: 'impro', title: 'Je veux improviser', sub: 'Des idées de phrases, pas des gammes à rallonge', test: t => has(t, 'impro') },
    { id: 'accomp', title: 'J’accompagne quelqu’un', sub: 'Rythme et accords pour soutenir', test: t => has(t, 'comping') },
    { id: 'mg', title: 'Ma main gauche s’ennuie', sub: 'Shells, walking bass, stride', test: t => has(t, 'main-gauche') },
    { id: 'pimenter', title: 'Je veux pimenter une grille', sub: 'Substitutions et détours', test: t => has(t, 'reharmo') },
    { id: 'fin', title: 'Il me faut une intro ou une fin', sub: 'Démarrer et conclure avec classe', test: t => has(t, 'intro-fin') },
    { id: 'swing', title: 'Je veux que ça swingue', sub: 'Placement, rythme, groove', test: t => has(t, 'groove') },
    { id: 'vite', title: 'J’ai deux minutes', sub: 'Un truc qui tient dans une pause', test: t => t.min <= 2 },
  ];
  const SIT_BY_ID = {};
  SITUATIONS.forEach(s => { SIT_BY_ID[s.id] = s; });
  const EXAMPLES = ['Bb7', 'Ebmaj7', 'F#m7b5', 'Ab7b9', 'Dm6', 'C7alt', 'G7sus4', 'Sib7M'];
  const STATUS_TXT = { review: 'À revoir', known: 'Acquis', seen: 'Déjà vu', new: 'Nouveau' };

  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/></svg>',
    dice: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
  };

  // ---------- Stockage (navigateur uniquement, facultatif) ----------
  const STORE_KEY = 'truc-jazz:v1';
  const store = { s: {}, key: 'C', solf: true, daily: null };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) Object.assign(store, JSON.parse(raw));
  } catch (e) { /* stockage indisponible : l'app marche quand même */ }
  if (!TJ.KEY_IV[store.key]) store.key = 'C';
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* idem */ }
  }
  const stat = id => store.s[id] || {};
  function setStat(id, patch) {
    store.s[id] = Object.assign({}, store.s[id], patch);
    save();
  }
  function statusOf(id) {
    const s = stat(id);
    return s.review ? 'review' : s.known ? 'known' : s.seen ? 'seen' : 'new';
  }

  // ---------- État ----------
  const S = {
    view: 'home', trick: null, vIdx: 0, prog: null, shapes: [], sel: -1, matched: new Set(),
    bpm: 110, swing: false, drums: false, loop: true,
    situation: null, backHash: '#', backLabel: 'Maintenant',
    libTag: '', libStatus: 'all', chordInput: 'G7', chord: null,
  };
  const held = new Set();
  let midiCount = 0;
  let midiAsked = false;

  // ---------- Texte ----------
  const keyIv = () => TJ.KEY_IV[store.key] || TJ.KEY_IV.C;
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  // Espaces fines insécables de la typographie française.
  const fr = s => s.replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
  const PH = /\[\[([^\]]+)\]\]|\{\{([A-G](?:bb|b|##|#)?)\}\}/g;
  const symHtml = sym => `<span class="sym">${esc(TJ.fmtSymbol(sym))}</span>`;
  const noteHtml = name => `<span class="nn">${esc(name)}</span>`;
  function rich(text) {
    const k = keyIv();
    return fr(esc(text)).replace(PH, (m, chord, note) => (chord ? symHtml(TJ.transposeSymbol(chord, k)) : noteHtml(TJ.pcName(note, k, store.solf))));
  }
  function plain(text) {
    const k = keyIv();
    return text.replace(PH, (m, chord, note) => (chord ? TJ.fmtSymbol(TJ.transposeSymbol(chord, k)) : TJ.pcName(note, k, store.solf)));
  }
  function labelHtml(raw) {
    if (!raw) return '';
    if (raw.charAt(0) === '*') return `<span class="slabel">${rich(raw.slice(1))}</span>`;
    return symHtml(TJ.transposeSymbol(raw, keyIv()));
  }
  function labelPlain(raw) {
    if (!raw) return '';
    if (raw.charAt(0) === '*') return plain(raw.slice(1));
    return TJ.fmtSymbol(TJ.transposeSymbol(raw, keyIv()));
  }

  // ---------- Squelette ----------
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="wrap">
      <header class="top">
        <a class="brand" href="#" aria-label="Truc Jazz, accueil">Truc <b>Jazz</b></a>
        <div class="tools">
          <button class="pill-btn" id="notaBtn" type="button" title="Changer la notation des notes"></button>
          <button class="pill-btn" id="midiBtn" type="button" title="Brancher un clavier MIDI pour que l’app voie ce que tu joues"></button>
        </div>
        <nav class="tabs" aria-label="Navigation">
          <a href="#" data-v="home">Maintenant</a>
          <a href="#trucs" data-v="trucs">Tous les trucs</a>
          <a href="#depanneur" data-v="depanneur">Dépanneur<span class="long"> d’accords</span></a>
        </nav>
      </header>
      <main id="view"></main>
    </div>
    <div class="dock" id="dock" hidden>
      <div class="dock-in">
        <div class="transport" id="transport">
          <button class="play" id="playBtn" type="button"></button>
          <div class="now" id="nowChord" aria-live="polite"></div>
          <div class="trans-r">
            <label class="tempo" for="bpmIn"><span aria-hidden="true">♩ =</span><output id="bpmOut" for="bpmIn"></output>
              <input type="range" id="bpmIn" min="50" max="220" step="2" aria-label="Tempo"></label>
            <button class="tog" id="swingTog" type="button" title="Croches swing (longue-courte)">Swing</button>
            <button class="tog" id="drumTog" type="button" title="Charley au pied sur les temps 2 et 4">Charley</button>
            <button class="tog" id="loopTog" type="button" title="Rejouer en boucle">Boucle</button>
          </div>
        </div>
        <div class="felt" aria-hidden="true"></div>
        <div class="kb-wrap" id="kbWrap"><div class="kb" id="kb" role="group" aria-label="Clavier : touche une note pour l’entendre"></div></div>
      </div>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;

  const view = document.getElementById('view');
  const dock = document.getElementById('dock');
  const toastEl = document.getElementById('toast');
  const $ = id => document.getElementById(id);

  // ---------- Clavier ----------
  const isWhite = m => [0, 2, 4, 5, 7, 9, 11].indexOf(TJ.mod(m, 12)) >= 0;
  const HAND_PRI = { B: 0, L: 1, R: 2 };

  class Keyboard {
    constructor(el) {
      this.el = el;
      this.lo = 0;
      this.hi = 0;
      this.keys = new Map();
      this.play = new Map();
      this.shape = new Map();
      this.showShape = true;
      el.addEventListener('pointerdown', e => {
        const k = e.target.closest('.k');
        if (!k) return;
        e.preventDefault();
        if (!AU.ensure()) return;
        AU.ep(Number(k.dataset.m), AU.now() + 0.01, 0.9, 0.75);
        k.setAttribute('data-tap', '');
        setTimeout(() => k.removeAttribute('data-tap'), 180);
      });
    }
    setRange(lo, hi) {
      if (lo === this.lo && hi === this.hi) { this.paint(); return; }
      this.lo = lo;
      this.hi = hi;
      const whites = [];
      for (let m = lo; m <= hi; m++) if (isWhite(m)) whites.push(m);
      let html = '';
      whites.forEach((m, i) => { html += `<div class="k w" data-m="${m}" style="--i:${i}"><span class="lab"></span></div>`; });
      for (let m = lo; m <= hi; m++) {
        if (!isWhite(m)) html += `<div class="k b" data-m="${m}" style="--i:${whites.indexOf(m - 1) + 1}"><span class="lab"></span></div>`;
      }
      this.el.style.setProperty('--nw', whites.length);
      this.el.innerHTML = html;
      this.keys = new Map();
      this.el.querySelectorAll('.k').forEach(k => this.keys.set(Number(k.dataset.m), k));
      this.paint();
    }
    paint() {
      this.keys.forEach((k, m) => {
        const p = this.play.get(m);
        const s = this.showShape ? this.shape.get(m) : null;
        let cls = isWhite(m) ? 'k w' : 'k b';
        let lab = '';
        if (p) { cls += ' on-' + p.hand; lab = esc(p.name); }
        else if (s) { cls += ' on-' + s.hand; lab = esc(s.name) + (s.deg ? `<i>${esc(s.deg)}</i>` : ''); }
        if (held.has(m)) cls += ' on-M';
        if (k.className !== cls) k.className = cls;
        const labEl = k.firstChild;
        if (labEl.innerHTML !== lab) labEl.innerHTML = lab;
      });
    }
  }
  const kb = new Keyboard($('kb'));

  function rangeFor(midis) {
    if (!midis.length) return [48, 76];
    const m12 = m => TJ.mod(m, 12);
    let lo = Math.min.apply(null, midis) - 2;
    let hi = Math.max.apply(null, midis) + 2;
    while (lo % 12 !== 0 && m12(lo) !== 5) lo--;
    while (m12(hi) !== 4 && m12(hi) !== 11) hi++;
    const whites = () => { let c = 0; for (let m = lo; m <= hi; m++) if (isWhite(m)) c++; return c; };
    let flip = false;
    while (whites() < 15 && (lo > 24 || hi < 105)) {
      if (flip && lo > 24) { lo--; while (m12(lo) !== 0 && m12(lo) !== 5) lo--; }
      else { hi++; while (m12(hi) !== 4 && m12(hi) !== 11) hi++; }
      flip = !flip;
    }
    return [lo, hi];
  }
  function centerKb() {
    const w = $('kbWrap');
    w.scrollLeft = Math.max(0, (w.scrollWidth - w.clientWidth) / 2);
  }

  // ---------- Lecture ----------
  const P = { playing: false, prog: null, nextAt: 0, lenSec: 0, sched: [], marks: [], raf: 0, sig: '', mark: null };
  let wakeLock = null;

  function beatSec(prog, beat) {
    const spb = 60 / prog.bpm;
    if (!prog.swing) return beat * spb;
    const b = Math.floor(beat + 1e-9);
    const x = beat - b;
    const y = x <= 0.5 ? x * 4 / 3 : 2 / 3 + (x - 0.5) * 2 / 3;
    return (b + y) * spb;
  }

  function scheduleIter(t0) {
    const prog = P.prog;
    prog.events.forEach(ev => {
      const s = t0 + beatSec(prog, ev.t);
      const e = t0 + beatSec(prog, ev.t + ev.d);
      const n = ev.notes.length;
      const off = ev.t - Math.floor(ev.t + 1e-9);
      const accent = prog.swing && Math.abs(off - 0.5) < 0.01 ? 1.15 : 1;
      ev.notes.forEach((nt, i) => {
        const st = s + (ev.roll ? i * 0.11 : (n > 1 ? i * 0.005 : 0));
        const dur = Math.max(0.05, (e - st) * (n > 1 ? 0.95 : 0.9));
        if (nt.hand === 'B') AU.bass(nt.midi, st, dur, 0.9 * accent);
        else AU.ep(nt.midi, st, dur, Math.min(1, (n > 1 ? 1.25 / Math.sqrt(n) : 0.85) * accent));
        P.sched.push({ s: st, e: st + dur, m: nt.midi, hand: nt.hand, name: nt.name });
      });
      if (ev.labelHtml) P.marks.push({ s, html: ev.labelHtml });
    });
    if (prog.drums) for (let b = 1; b < prog.length; b += 2) AU.hat(t0 + beatSec(prog, b), 1);
  }

  function play(prog) {
    stop();
    if (!AU.ensure()) { toast('Le son n’est pas disponible dans ce navigateur.'); return; }
    P.prog = prog;
    P.playing = true;
    P.sched = [];
    P.marks = [];
    P.sig = '';
    P.lenSec = beatSec(prog, prog.length);
    const t0 = AU.now() + 0.08;
    scheduleIter(t0);
    P.nextAt = t0 + P.lenSec;
    kb.showShape = false;
    updatePlayBtn();
    try {
      if (!wakeLock && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
    } catch (e) { /* écran de veille : tant pis */ }
    P.raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!P.playing) return;
    P.playing = false;
    cancelAnimationFrame(P.raf);
    AU.stopAll();
    P.sched = [];
    P.marks = [];
    kb.play = new Map();
    kb.showShape = true;
    kb.paint();
    P.mark = null;
    setNow(S.sel >= 0 && S.shapes[S.sel] ? S.shapes[S.sel].labelHtml : '');
    updatePlayBtn();
  }

  function tick() {
    if (!P.playing) return;
    const t = AU.now();
    if (t > P.nextAt - 0.4) {
      if (S.loop) {
        scheduleIter(P.nextAt);
        P.nextAt += P.lenSec;
      } else if (t > P.nextAt + 0.5) {
        stop();
        return;
      }
    }
    P.sched = P.sched.filter(x => x.e > t - 0.05);
    const map = new Map();
    P.sched.forEach(x => {
      if (x.s <= t && t < x.e) {
        const cur = map.get(x.m);
        if (!cur || HAND_PRI[x.hand] > HAND_PRI[cur.hand]) map.set(x.m, x);
      }
    });
    let sig = '';
    map.forEach((v, m) => { sig += m + v.hand + ','; });
    if (sig !== P.sig) { P.sig = sig; kb.play = map; kb.paint(); }
    let cur = null;
    P.marks.forEach(mk => { if (mk.s <= t && (!cur || mk.s >= cur.s)) cur = mk; });
    P.marks = P.marks.filter(mk => mk === cur || mk.s > t);
    if (cur && cur !== P.mark) { P.mark = cur; setNow(cur.html); }
    P.raf = requestAnimationFrame(tick);
  }

  function setNow(html) {
    const el = $('nowChord');
    if (el.innerHTML !== (html || '')) el.innerHTML = html || '';
  }
  function updatePlayBtn() {
    $('playBtn').innerHTML = P.playing ? `${ICON.stop}<span>Stop</span>` : `${ICON.play}<span>Écouter</span>`;
    $('playBtn').setAttribute('aria-pressed', P.playing ? 'true' : 'false');
  }

  // ---------- Programmes (ce que joue le dock) ----------
  function mkNote(n, k) {
    const sp = TJ.transpose(n.n, k);
    return { midi: TJ.midiOf(sp), sp, hand: n.hand, deg: n.deg, name: TJ.noteName(sp, store.solf) };
  }

  function makeShape(label, notes) {
    const sym = label && label.charAt(0) !== '*' ? TJ.transposeSymbol(label, keyIv()) : null;
    const sorted = notes.slice().sort((a, b) => a.midi - b.midi);
    return {
      labelHtml: labelHtml(label),
      labelPlain: labelPlain(label),
      scale: !!label && label.charAt(0) === '*' && notes.length > 5,
      notes: sorted.map(n => Object.assign({}, n, { degTxt: n.deg ? TJ.fmtDeg(n.deg) : (sym ? TJ.degreeOf(sym, n.midi) : '') })),
    };
  }

  // Formes déduites des accords étiquetés : on y joint les accords des autres mains qui tombent au même moment.
  function deriveShapes(events) {
    const out = [];
    const seen = new Set();
    events.forEach(e => {
      if (!e.label) return;
      let notes = e.notes.slice();
      events.forEach(o => {
        if (o !== e && o.track !== e.track && !o.label && Math.abs(o.t - e.t) < 1e-6 && o.notes.length > 1) notes = notes.concat(o.notes);
      });
      const key = e.label + ':' + notes.map(n => n.midi).sort((a, b) => a - b).join(',');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(makeShape(e.label, notes));
    });
    return out;
  }

  function buildTrickProgram(trick, vi) {
    const v = trick.versions[vi];
    const k = keyIv();
    const events = [];
    let length = 0;
    ['B', 'L', 'R'].forEach(h => {
      if (!v[h]) return;
      const tr = TJ.parseTrack(v[h], h);
      length = Math.max(length, tr.length);
      tr.events.forEach(e => events.push({
        t: e.t, d: e.d, roll: e.roll, label: e.label, track: h,
        labelHtml: e.label ? labelHtml(e.label) : '',
        notes: e.notes.map(n => mkNote(n, k)),
      }));
    });
    events.sort((a, b) => a.t - b.t);
    const src = v.shapes || trick.shapes;
    const shapes = src
      ? TJ.parseTrack(src, 'L').events.filter(e => e.notes.length).map(e => makeShape(e.label, e.notes.map(n => mkNote(n, k))))
      : deriveShapes(events);
    return { events, length, shapes, bpm: S.bpm, swing: S.swing, drums: S.drums, loop: trick.loop };
  }

  function helperProgram() {
    const events = S.shapes.map((sh, i) => ({ t: i * 2, d: 2, roll: false, labelHtml: sh.labelHtml + `<small>${esc(sh.name)}</small>`, notes: sh.notes }));
    return { events, length: S.shapes.length * 2, shapes: S.shapes, bpm: S.bpm, swing: false, drums: false, loop: false };
  }

  function currentProgram() {
    if (S.view === 'trick') return buildTrickProgram(S.trick, S.vIdx);
    if (S.view === 'depanneur' && S.shapes.length) return helperProgram();
    return null;
  }

  function showDock(prog) {
    dock.hidden = false;
    document.body.classList.add('has-dock');
    $('transport').classList.toggle('simple', S.view === 'depanneur');
    const midis = [];
    prog.events.forEach(e => e.notes.forEach(n => midis.push(n.midi)));
    prog.shapes.forEach(s => s.notes.forEach(n => midis.push(n.midi)));
    const r = rangeFor(midis);
    kb.shape = new Map();
    kb.play = new Map();
    kb.setRange(r[0], r[1]);
    requestAnimationFrame(centerKb);
    syncTransport();
    setNow('');
    syncDockHeight();
  }
  function hideDock() {
    dock.hidden = true;
    document.body.classList.remove('has-dock');
  }
  function syncTransport() {
    $('bpmIn').value = S.bpm;
    $('bpmOut').textContent = S.bpm;
    $('swingTog').setAttribute('aria-pressed', S.swing ? 'true' : 'false');
    $('drumTog').setAttribute('aria-pressed', S.drums ? 'true' : 'false');
    $('loopTog').setAttribute('aria-pressed', S.loop ? 'true' : 'false');
    updatePlayBtn();
  }
  function syncDockHeight() {
    document.documentElement.style.setProperty('--dock-h', (dock.hidden ? 0 : dock.offsetHeight) + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(syncDockHeight).observe(dock);

  function restartIfPlaying() {
    if (!P.playing) return;
    const prog = currentProgram();
    if (prog) play(prog);
  }

  $('playBtn').addEventListener('click', () => {
    if (P.playing) { stop(); return; }
    const prog = currentProgram();
    if (prog) play(prog);
  });
  $('bpmIn').addEventListener('input', e => { S.bpm = Number(e.target.value); $('bpmOut').textContent = S.bpm; });
  $('bpmIn').addEventListener('change', restartIfPlaying);
  $('swingTog').addEventListener('click', () => { S.swing = !S.swing; syncTransport(); restartIfPlaying(); });
  $('drumTog').addEventListener('click', () => { S.drums = !S.drums; syncTransport(); restartIfPlaying(); });
  $('loopTog').addEventListener('click', () => { S.loop = !S.loop; syncTransport(); });

  // ---------- Formes (cartes) ----------
  function shapeHtml(sh, i, extra) {
    const notes = sh.notes.slice().reverse();
    return `<button class="shape${S.matched.has(i) ? ' ok' : ''}${sh.scale ? ' scale' : ''}" type="button" data-i="${i}" aria-pressed="${S.sel === i}">
      <span class="shape-l">${sh.labelHtml}</span>
      ${extra ? `<span class="shape-name">${esc(sh.name)}</span>` : ''}
      <ul class="stack">${notes.map(n => `<li><i class="dot ${n.hand}" aria-hidden="true"></i><span>${esc(n.name)}</span><b class="deg">${esc(n.degTxt || '')}</b></li>`).join('')}</ul>
      ${extra ? `<span class="shape-desc">${esc(sh.desc)}</span>` : ''}
      <span class="ok-mark">✓ joué</span>
    </button>`;
  }

  function selectShape(i, sound) {
    const sh = S.shapes[i];
    if (!sh) return;
    stop();
    S.sel = i;
    document.querySelectorAll('.shape').forEach(el => el.setAttribute('aria-pressed', Number(el.dataset.i) === i ? 'true' : 'false'));
    const map = new Map();
    sh.notes.forEach(n => map.set(n.midi, { hand: n.hand, name: n.name, deg: n.degTxt }));
    kb.shape = map;
    kb.paint();
    setNow(sh.labelHtml);
    const lo = Math.min.apply(null, sh.notes.map(n => n.midi));
    const keyEl = kb.keys.get(lo);
    if (keyEl) {
      const w = $('kbWrap');
      const x = keyEl.offsetLeft - w.clientWidth * 0.25;
      if (x < w.scrollLeft || keyEl.offsetLeft > w.scrollLeft + w.clientWidth * 0.6) w.scrollLeft = Math.max(0, x);
    }
    if (sound === false || !AU.ensure()) return;
    const t = AU.now() + 0.02;
    sh.notes.forEach((n, j) => {
      if (sh.scale) AU.ep(n.midi, t + j * 0.17, 0.4, 0.8);
      else AU.ep(n.midi, t + j * 0.025, 1.8, 1.2 / Math.sqrt(sh.notes.length));
    });
  }

  function bindShapes() {
    document.querySelectorAll('.shape').forEach(el => el.addEventListener('click', () => selectShape(Number(el.dataset.i))));
  }

  // ---------- Choix d'un truc ----------
  function weight(t) {
    const s = stat(t.id);
    if (s.review) return 5;
    if (s.known) return 0.4;
    if (!s.seen) return 3;
    return 1.5;
  }
  function pick(pool, excludeId) {
    const list = pool.filter(t => t.id !== excludeId);
    if (!list.length) return pool[0];
    const total = list.reduce((a, t) => a + weight(t), 0);
    let r = Math.random() * total;
    for (const t of list) { r -= weight(t); if (r <= 0) return t; }
    return list[list.length - 1];
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function dailyTrick() {
    const today = todayStr();
    if (store.daily && store.daily.date === today && BY_ID[store.daily.id]) return BY_ID[store.daily.id];
    const unseen = TRICKS.filter(t => !stat(t.id).seen);
    const pool = unseen.length ? unseen : TRICKS;
    let h = 0;
    for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0;
    const t = pool[h % pool.length];
    store.daily = { date: today, id: t.id };
    save();
    return t;
  }
  function firstSym(t) {
    const v = t.versions[t.defaultVersion || 0];
    for (const h of ['L', 'R', 'B']) {
      if (!v[h]) continue;
      const e = TJ.parseTrack(v[h], h).events.find(x => x.label && x.label.charAt(0) !== '*');
      if (e) return e.label;
    }
    return 'C';
  }
  function goTrick(t) { location.hash = '#t-' + t.id; }

  // ---------- Vues ----------
  function setNav() {
    document.querySelectorAll('.tabs a').forEach(a => {
      if (a.dataset.v === S.view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('notaBtn').textContent = store.solf ? 'Do Ré Mi' : 'C D E';
    $('midiBtn').textContent = midiCount ? 'MIDI connecté' : 'Clavier MIDI';
    $('midiBtn').setAttribute('aria-pressed', midiCount ? 'true' : 'false');
  }

  const nextCard = t => `<a class="next-card" href="#t-${t.id}"><span>${rich(t.title)}</span><small>${TAGS[t.tags[0]]} · ${t.min} min</small></a>`;

  function showHome() {
    S.view = 'home';
    S.situation = null;
    S.shapes = [];
    const daily = dailyTrick();
    const review = TRICKS.filter(t => stat(t.id).review);
    const seen = TRICKS.filter(t => stat(t.id).seen).length;
    const known = TRICKS.filter(t => stat(t.id).known).length;
    view.innerHTML = `
      <section class="hero">
        <h1 class="display">${fr('Là, maintenant, qu’est-ce qu’il te faut ?')}</h1>
        <p class="lede">${fr('Pas de programme ni de niveau à valider. Dis où tu en es au piano : tu repars avec un petit truc de jazz jouable dans les cinq minutes.')}</p>
        <button class="cta" id="surprise" type="button">${ICON.dice}<span>Donne-moi un truc</span></button>
      </section>
      <section class="situations" aria-label="Où tu en es">
        ${SITUATIONS.map(s => `<button class="sit" type="button" data-sit="${s.id}"><span class="sit-t">${esc(s.title)}</span><span class="sit-s">${esc(s.sub)}</span><span class="sit-n">${TRICKS.filter(s.test).length} trucs</span></button>`).join('')}
      </section>
      <a class="sleeve" href="#t-${daily.id}">
        <span class="sleeve-sym" aria-hidden="true">${esc(TJ.fmtSymbol(TJ.transposeSymbol(firstSym(daily), keyIv())))}</span>
        <span class="eyebrow">Le truc du jour</span>
        <span class="sleeve-t">${rich(daily.title)}</span>
        <span class="sleeve-h">${rich(daily.hook)}</span>
        <span class="sleeve-go">Jouer ce truc →</span>
      </a>
      ${review.length ? `<section class="block"><h2 class="eyebrow">À revoir</h2><div class="next">${review.map(nextCard).join('')}</div></section>` : ''}
      <p class="progress">${seen ? `${seen} truc${seen > 1 ? 's' : ''} déjà vu${seen > 1 ? 's' : ''}, ${known} acquis, sur ${TRICKS.length}.` : `${TRICKS.length} trucs t’attendent, dans n’importe quel ordre.`}
        <a href="#trucs">Voir tous les trucs</a></p>`;
    $('surprise').addEventListener('click', () => { S.situation = null; goTrick(pick(TRICKS)); });
    view.querySelectorAll('.sit').forEach(b => b.addEventListener('click', () => {
      const sit = SIT_BY_ID[b.dataset.sit];
      S.situation = sit.id;
      goTrick(pick(TRICKS.filter(sit.test)));
    }));
  }

  function cardHtml(t) {
    const st = statusOf(t.id);
    return `<a class="card" href="#t-${t.id}">
      <span class="card-tag">${t.tags.map(g => TAGS[g]).join(' · ')}</span>
      <span class="card-t">${rich(t.title)}</span>
      <span class="card-h">${rich(t.hook)}</span>
      <span class="card-f"><span>${t.min} min · ${LEVEL[t.lvl]}</span><span class="st st-${st}">${STATUS_TXT[st]}</span></span>
    </a>`;
  }

  function showLibrary() {
    S.view = 'trucs';
    S.shapes = [];
    const matchStatus = t => S.libStatus === 'all' || statusOf(t.id) === S.libStatus || (S.libStatus === 'new' && statusOf(t.id) === 'new');
    const byTag = t => !S.libTag || has(t, S.libTag);
    const list = TRICKS.filter(t => byTag(t) && matchStatus(t));
    const count = k => TRICKS.filter(t => byTag(t) && (k === 'all' || statusOf(t.id) === k)).length;
    const empty = S.libStatus === 'review'
      ? 'Rien à revoir pour l’instant. Sur une fiche, touche « Rappelle-le moi » pour la retrouver ici.'
      : S.libStatus === 'known'
        ? 'Aucun truc acquis pour l’instant. Sur une fiche, touche « Je l’ai » quand il est dans les doigts.'
        : 'Aucun truc ne correspond à ces filtres.';
    view.innerHTML = `
      <section class="page-head">
        <h1 class="display sm">Tous les trucs</h1>
        <p class="lede">${fr(`${TRICKS.length} petits trucs indépendants. Aucun ordre à suivre : prends celui qui te parle aujourd’hui.`)}</p>
      </section>
      <div class="filters">
        <div class="chips" role="group" aria-label="Thème">${[['', 'Tout']].concat(Object.keys(TAGS).map(k => [k, TAGS[k]])).map(x => `<button class="chip" type="button" data-tag="${x[0]}" aria-pressed="${S.libTag === x[0]}">${x[1]}</button>`).join('')}</div>
        <div class="seg small" role="group" aria-label="Où tu en es">${[['all', 'Tous'], ['new', 'Nouveaux'], ['review', 'À revoir'], ['known', 'Acquis']].map(x => `<button type="button" data-st="${x[0]}" aria-pressed="${S.libStatus === x[0]}">${x[1]} <span class="count">${count(x[0])}</span></button>`).join('')}</div>
      </div>
      <div class="cards">${list.length ? list.map(cardHtml).join('') : `<p class="empty">${fr(empty)}</p>`}</div>`;
    view.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => { S.libTag = b.dataset.tag; showLibrary(); }));
    view.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => { S.libStatus = b.dataset.st; showLibrary(); }));
  }

  function showTrick(id) {
    const t = BY_ID[id];
    S.view = 'trick';
    S.trick = t;
    S.vIdx = t.defaultVersion || 0;
    const v = t.versions[S.vIdx];
    S.bpm = v.bpm || t.bpm || 110;
    S.swing = v.swing != null ? v.swing : !!t.swing;
    S.drums = v.drums != null ? v.drums : !!t.drums;
    S.loop = t.loop !== false;
    setStat(id, { seen: Date.now() });
    renderTrick();
  }

  function renderTrick(keepScroll) {
    const y = window.scrollY;
    const t = S.trick;
    const prog = buildTrickProgram(t, S.vIdx);
    S.prog = prog;
    S.shapes = prog.shapes;
    S.sel = -1;
    S.matched = new Set();
    const s = stat(t.id);
    const sit = S.situation ? SIT_BY_ID[S.situation] : null;
    view.innerHTML = `
      <article class="trick">
        <a class="back" href="${S.backHash}">← ${esc(S.backLabel)}</a>
        <header class="trick-head">
          <p class="meta">${t.tags.map(g => `<span class="tag">${TAGS[g]}</span>`).join('')}<span>${t.min} min</span><span>${LEVEL[t.lvl]}</span></p>
          <h1 class="display trick-title">${rich(t.title)}</h1>
          <p class="hook">${rich(t.hook)}</p>
        </header>
        <div class="trick-controls">
          <label class="keysel" for="keySel"><span>Tonalité</span>
            <select id="keySel">${TJ.KEYS.map(k => `<option value="${k.k}"${k.k === store.key ? ' selected' : ''}>${esc(TJ.pcName(k.k, null, store.solf))}</option>`).join('')}</select>
          </label>
          <button class="pill-btn" id="keyRand" type="button">Autre tonalité au hasard</button>
          ${t.versions.length > 1 ? `<div class="seg" role="group" aria-label="Versions">${t.versions.map((v, i) => `<button type="button" data-v="${i}" aria-pressed="${i === S.vIdx}">${rich(v.name)}</button>`).join('')}</div>` : ''}
        </div>
        <section class="block">
          <h2 class="eyebrow">Les formes <span>Touche une forme pour l’entendre et la voir sur le clavier</span></h2>
          <div class="shape-row" id="shapes">${S.shapes.map((sh, i) => shapeHtml(sh, i)).join('')}</div>
        </section>
        <section class="block prose"><h2 class="eyebrow">Le truc</h2>${t.body.map(p => `<p>${rich(p)}</p>`).join('')}</section>
        <section class="block"><h2 class="eyebrow">À toi</h2><ol class="steps">${t.steps.map(x => `<li>${rich(x)}</li>`).join('')}</ol></section>
        <aside class="dare"><h2 class="eyebrow">Défi · une minute</h2><p>${rich(t.dare)}</p></aside>
        <div class="actions">
          <button class="btn" id="gotIt" type="button" aria-pressed="${!!s.known}">${s.known ? '✓ Acquis' : 'Je l’ai'}</button>
          <button class="btn" id="review" type="button" aria-pressed="${!!s.review}">${s.review ? fr('Dans « À revoir »') : 'Rappelle-le moi'}</button>
          <button class="cta sm" id="another" type="button">${sit ? esc('Un autre truc : ' + sit.title.toLowerCase()) : 'Un autre truc'}</button>
        </div>
        <section class="block"><h2 class="eyebrow">Ça mène à</h2><div class="next">${t.next.map(n => nextCard(BY_ID[n])).join('')}</div></section>
      </article>`;

    $('keySel').addEventListener('change', e => { store.key = e.target.value; save(); stop(); renderTrick(true); });
    $('keyRand').addEventListener('click', () => {
      const others = TJ.KEYS.filter(k => k.k !== store.key);
      store.key = others[Math.floor(Math.random() * others.length)].k;
      save();
      stop();
      renderTrick(true);
      toast('Tonalité : ' + TJ.pcName(store.key, null, store.solf));
    });
    view.querySelectorAll('.seg [data-v]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.v);
      if (i === S.vIdx) return;
      const wasPlaying = P.playing;
      stop();
      S.vIdx = i;
      const v = t.versions[i];
      if (v.swing != null) S.swing = v.swing;
      renderTrick(true);
      if (wasPlaying) play(buildTrickProgram(t, S.vIdx));
    }));
    $('gotIt').addEventListener('click', () => {
      const known = !stat(t.id).known;
      setStat(t.id, { known, review: known ? false : stat(t.id).review });
      renderTrick(true);
      toast(known ? 'Noté comme acquis. Il reviendra plus rarement.' : 'Retiré des acquis.');
    });
    $('review').addEventListener('click', () => {
      const review = !stat(t.id).review;
      setStat(t.id, { review });
      renderTrick(true);
      toast(review ? 'Ajouté à « À revoir », sur l’accueil.' : 'Retiré de « À revoir ».');
    });
    $('another').addEventListener('click', () => {
      const pool = sit ? TRICKS.filter(sit.test) : TRICKS;
      goTrick(pick(pool, t.id));
    });
    bindShapes();
    showDock(prog);
    if (keepScroll) window.scrollTo(0, y);
  }

  function showHelper() {
    S.view = 'depanneur';
    S.bpm = 60;
    S.loop = false;
    view.innerHTML = `
      <section class="page-head">
        <h1 class="display sm">Dépanneur d’accords</h1>
        <p class="lede">${fr('Tu lis une grille et un accord te bloque ? Tape-le : tu as tout de suite plusieurs façons de le jouer, de la plus simple à la plus riche.')}</p>
      </section>
      <form class="chord-form" id="chordForm" autocomplete="off">
        <label for="chordIn" class="sr">Accord</label>
        <input id="chordIn" class="chord-in" value="${esc(S.chordInput)}" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="B♭7, Ebm7b5, Sib7M…">
        <button class="cta sm" type="submit">Voir</button>
      </form>
      <div class="chips" aria-label="Exemples">${EXAMPLES.map(c => `<button type="button" class="chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <p class="hint">${fr('Tu peux écrire à la française (Sib7M, Rém7, Fa#ø) ou à l’américaine (Bbmaj7, Dm7, F#m7b5).')}</p>
      <div id="helperOut"></div>`;
    const input = $('chordIn');
    let deb = 0;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => { S.chordInput = input.value; renderHelperOut(); }, 180);
    });
    $('chordForm').addEventListener('submit', e => {
      e.preventDefault();
      S.chordInput = input.value;
      renderHelperOut();
      if (S.shapes.length) selectShape(0);
    });
    view.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
      input.value = b.dataset.c;
      S.chordInput = b.dataset.c;
      renderHelperOut();
      if (S.shapes.length) selectShape(0);
    }));
    renderHelperOut();
  }

  function renderHelperOut() {
    const out = $('helperOut');
    if (!out) return;
    stop();
    S.sel = -1;
    S.matched = new Set();
    const r = TJ.parseUserChord(S.chordInput);
    if (!r) { out.innerHTML = ''; S.shapes = []; hideDock(); return; }
    if (r.error) {
      out.innerHTML = `<p class="err">${fr(`Je ne reconnais pas « ${esc(S.chordInput)} ». Essaie par exemple B♭7, Dm7, F♯m7♭5, A♭7♭9 ou Sib7M.`)}</p>`;
      S.shapes = [];
      hideDock();
      return;
    }
    S.chord = r;
    const n = d => noteHtml(TJ.noteName(TJ.noteFromDeg(r.root, d), store.solf));
    const symLabel = symHtml(r.display);
    S.shapes = TJ.voicingsFor(r).map(v => ({
      name: v.name, desc: v.desc, trick: v.trick, labelHtml: symLabel, labelPlain: TJ.fmtSymbol(r.display),
      notes: v.notes.map(x => Object.assign({}, x, { name: TJ.noteName(x.sp, store.solf) })),
    }));
    const bassNote = r.bass ? TJ.parsePc(r.bass) : null;
    out.innerHTML = `
      <div class="chord-card">
        <div class="cc-sym">${symLabel}</div>
        <div class="cc-info"><b>${esc(r.q.name)}</b>
          <span class="formula">${r.q.formula.map(d => `<span><b>${esc(TJ.fmtDeg(d))}</b>${n(d)}</span>`).join('')}</span></div>
        <p class="cc-tip">${fr(r.q.tip(n))}</p>
        ${r.note ? `<p class="cc-note">${fr(esc(r.note))}</p>` : ''}
        ${bassNote ? `<p class="cc-note">${fr(`Basse : ${noteHtml(TJ.noteName(bassNote, store.solf))}. Le bassiste la joue, ou ta main gauche tout en bas.`)}</p>` : ''}
      </div>
      <h2 class="eyebrow">${S.shapes.length} façons de le jouer <span>Touche une carte, ou Écouter pour les enchaîner</span></h2>
      <div class="voicings">${S.shapes.map((sh, i) => `<div class="vcard">${shapeHtml(sh, i, true)}<a class="vlink" href="#t-${sh.trick}">${rich(BY_ID[sh.trick].title)} →</a></div>`).join('')}</div>`;
    bindShapes();
    showDock(helperProgram());
  }

  // ---------- MIDI ----------
  function onMidi(e) {
    const st = e.data[0] & 0xf0;
    const note = e.data[1];
    const vel = e.data[2];
    if (st === 0x90 && vel > 0) held.add(note);
    else if (st === 0x80 || (st === 0x90 && vel === 0)) held.delete(note);
    else return;
    kb.paint();
    checkMatch();
  }
  function checkMatch() {
    if (!S.shapes.length || held.size < 2) return;
    const pcs = new Set();
    held.forEach(m => pcs.add(TJ.mod(m, 12)));
    S.shapes.forEach((sh, i) => {
      if (S.matched.has(i)) return;
      const sp = new Set(sh.notes.map(n => TJ.mod(n.midi, 12)));
      if (sp.size !== pcs.size) return;
      for (const p of sp) if (!pcs.has(p)) return;
      S.matched.add(i);
      const el = document.querySelector(`.shape[data-i="${i}"]`);
      if (el) el.classList.add('ok');
      if (S.matched.size === S.shapes.length && S.shapes.length > 1) toast('Toutes les formes sont passées sous tes doigts. Tu peux marquer ce truc comme acquis.');
      else toast(`Bien joué : ${sh.labelPlain}${sh.name ? ' · ' + sh.name : ''} ✓`);
    });
  }
  function connectMidi() {
    if (!navigator.requestMIDIAccess) {
      toast('Ce navigateur ne gère pas le MIDI. Essaie Chrome ou Edge sur ordinateur, ou Chrome sur Android.');
      return;
    }
    navigator.requestMIDIAccess().then(acc => {
      const bind = () => {
        midiCount = 0;
        acc.inputs.forEach(inp => { inp.onmidimessage = onMidi; midiCount++; });
        setNav();
      };
      bind();
      acc.onstatechange = bind;
      if (!midiAsked) toast(midiCount ? 'Clavier connecté : tes notes s’allument en doré, et les formes jouées se cochent.' : 'MIDI activé, mais aucun clavier détecté. Branche-le : il sera reconnu tout seul.');
      midiAsked = true;
    }).catch(() => toast('L’accès MIDI a été refusé. Autorise-le dans le navigateur pour que l’app voie ce que tu joues.'));
  }
  $('midiBtn').addEventListener('click', connectMidi);
  $('notaBtn').addEventListener('click', () => {
    store.solf = !store.solf;
    save();
    stop();
    if (S.view === 'trick') renderTrick(true);
    else if (S.view === 'depanneur') { renderHelperOut(); }
    else route();
    setNav();
  });

  // ---------- Toast ----------
  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.hidden = true; }, 3200);
  }

  // ---------- Navigation ----------
  let lastList = '#';
  function route() {
    stop();
    const h = location.hash.slice(1);
    if (h.indexOf('t-') === 0 && BY_ID[h.slice(2)]) {
      S.backHash = lastList;
      S.backLabel = lastList === '#trucs' ? 'Tous les trucs' : lastList === '#depanneur' ? 'Dépanneur' : 'Maintenant';
      showTrick(h.slice(2));
    } else {
      hideDock();
      if (h === 'trucs') { lastList = '#trucs'; showLibrary(); }
      else if (h === 'depanneur') { lastList = '#depanneur'; showHelper(); }
      else { lastList = '#'; showHome(); }
    }
    setNav();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || dock.hidden) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || tag === 'a') return;
    e.preventDefault();
    $('playBtn').click();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

  route();

  // Hors-ligne quand l'app est servie depuis son propre site (GitHub Pages, etc.).
  try {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.top === window.self && !window.claude) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  } catch (e) { /* pas de mode hors-ligne ici */ }
})();
