/* Truc Jazz · Labo d'écoute
   Micro (sans traitements vocaux) → AudioWorklet → détecteur → vérification de la forme attendue.
   Le prof (Claude) reçoit un résumé texte de ce qui a été reconnu. */
(function () {
  'use strict';

  const TJ = window.TJ;
  const AU = window.TJAudio;
  const TRICKS = window.TJ_TRICKS;
  const D = window.TJDetector;
  const $ = id => document.getElementById(id);
  const mod12 = m => ((m % 12) + 12) % 12;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fr = s => s.replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');

  // Préférences partagées avec l'app (notation, tonalité)
  let store = {};
  try { store = JSON.parse(localStorage.getItem('truc-jazz:v1') || '{}') || {}; } catch (e) { store = {}; }
  const solf = store.solf !== false;
  const NAMES = solf
    ? ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
    : ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const LETTER = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const nameOf = m => NAMES[mod12(m)];
  const nameOct = m => nameOf(m) + (Math.floor(m / 12) - 1);

  const S = {
    ctx: null, det: null, running: false, mode: 'target',
    trickId: 'shells', key: TJ.KEY_IV[store.key] ? store.key : 'C',
    shapes: [], idx: 0, matcher: null, onsetT: 0, okStreak: 0, advancing: false, lastCheck: null,
    frame: null, lastFrame: null, muteUntil: 0, testing: null,
    results: [], freeLog: [], freePending: null, tune: [], cpu: [], history: [],
  };

  // ---------- Formes des trucs ----------
  function trickShapes(t, key) {
    const iv = TJ.KEY_IV[key];
    const v = t.versions[t.defaultVersion || 0];
    const mk = n => { const sp = TJ.transpose(n.n, iv); return { midi: TJ.midiOf(sp), sp }; };
    const out = [];
    const src = v.shapes || t.shapes;
    if (src) {
      TJ.parseTrack(src, 'L').events.forEach(e => { if (e.label && e.label.charAt(0) !== '*') out.push({ label: e.label, notes: e.notes.map(mk) }); });
    } else {
      const ev = [];
      ['L', 'R'].forEach(h => { if (v[h]) TJ.parseTrack(v[h], h).events.forEach(e => ev.push(Object.assign({ track: h }, e))); });
      ev.forEach(e => {
        if (!e.label || e.label.charAt(0) === '*') return;
        let notes = e.notes.slice();
        ev.forEach(o => { if (o !== e && o.track !== e.track && !o.label && Math.abs(o.t - e.t) < 1e-6 && o.notes.length > 1) notes = notes.concat(o.notes); });
        out.push({ label: e.label, notes: notes.map(mk) });
      });
    }
    const seen = new Set();
    return out
      .map(s => ({ sym: TJ.transposeSymbol(s.label, iv), notes: s.notes.slice().sort((a, b) => a.midi - b.midi) }))
      .filter(s => {
        const k = s.sym + s.notes.map(n => n.midi).join(',');
        if (s.notes.length < 2 || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }
  const PLAYABLE = TRICKS.filter(t => trickShapes(t, 'C').length > 0);

  // ---------- Clavier ----------
  const isWhite = m => [0, 2, 4, 5, 7, 9, 11].indexOf(mod12(m)) >= 0;
  let keys = new Map();
  let range = [0, 0];
  function setRange(lo, hi) {
    if (range[0] === lo && range[1] === hi) return;
    range = [lo, hi];
    const whites = [];
    for (let m = lo; m <= hi; m++) if (isWhite(m)) whites.push(m);
    let html = '';
    whites.forEach((m, i) => { html += `<div class="k w" data-m="${m}" style="--i:${i}"><span class="lab"></span></div>`; });
    for (let m = lo; m <= hi; m++) if (!isWhite(m)) html += `<div class="k b" data-m="${m}" style="--i:${whites.indexOf(m - 1) + 1}"><span class="lab"></span></div>`;
    const kb = $('kb');
    kb.style.setProperty('--nw', whites.length);
    kb.innerHTML = html;
    keys = new Map();
    kb.querySelectorAll('.k').forEach(k => keys.set(Number(k.dataset.m), k));
    requestAnimationFrame(() => {
      const w = $('kbWrap');
      w.scrollLeft = Math.max(0, (w.scrollWidth - w.clientWidth) / 2);
    });
  }
  function fitRange(midis) {
    let lo = Math.min.apply(null, midis) - 5;
    let hi = Math.max.apply(null, midis) + 5;
    while (mod12(lo) !== 0 && mod12(lo) !== 5) lo--;
    while (mod12(hi) !== 4 && mod12(hi) !== 11) hi++;
    while (hi - lo < 30) { lo -= 1; while (mod12(lo) !== 0 && mod12(lo) !== 5) lo--; if (hi - lo < 30) { hi += 1; while (mod12(hi) !== 4 && mod12(hi) !== 11) hi++; } }
    setRange(Math.max(28, lo), Math.min(100, hi));
  }

  let lastPaint = '';
  function paint() {
    const f = S.frame;
    const heard = new Set(f && f.t >= S.muteUntil ? f.active : []);
    const target = S.mode === 'target' && S.shapes[S.idx] ? S.shapes[S.idx].notes.map(n => n.midi) : [];
    const chk = S.mode === 'target' ? S.lastCheck : null;
    const goodPc = new Set(chk ? chk.present : []);
    const bad = new Set(chk ? chk.extra : []);
    let sig = '';
    keys.forEach((k, m) => {
      const isT = target.indexOf(m) >= 0;
      const good = isT && goodPc.has(mod12(m));
      const isBad = bad.has(m);
      let cls = isWhite(m) ? 'k w' : 'k b';
      if (isT) cls += ' tg';
      if (good) cls += ' good';
      if (isBad) cls += ' bad';
      if (heard.has(m)) cls += ' heard';
      sig += cls;
      if (k.className !== cls) k.className = cls;
      const lab = isT || isBad || heard.has(m) ? nameOf(m) : '';
      if (k.firstChild.textContent !== lab) k.firstChild.textContent = lab;
    });
    lastPaint = sig;
  }

  // ---------- Vue « Joue la forme » ----------
  function fillSelects() {
    $('trickSel').innerHTML = PLAYABLE.map(t => `<option value="${t.id}"${t.id === S.trickId ? ' selected' : ''}>${esc(t.title.replace(/\[\[|\]\]|\{\{|\}\}/g, ''))}</option>`).join('');
    $('keySel').innerHTML = TJ.KEYS.map(k => `<option value="${k.k}"${k.k === S.key ? ' selected' : ''}>${esc(TJ.pcName(k.k, null, solf))}</option>`).join('');
    $('trickSel').addEventListener('change', e => { S.trickId = e.target.value; loadShapes(); });
    $('keySel').addEventListener('change', e => { S.key = e.target.value; loadShapes(); });
  }
  function loadShapes() {
    S.shapes = trickShapes(PLAYABLE.find(t => t.id === S.trickId) || PLAYABLE[0], S.key);
    S.idx = 0;
    S.matcher = null;
    S.lastCheck = null;
    renderTarget();
    const all = [];
    S.shapes.forEach(s => s.notes.forEach(n => all.push(n.midi)));
    fitRange(all);
  }
  function renderTarget() {
    const sh = S.shapes[S.idx];
    if (!sh) return;
    const chk = S.lastCheck;
    const good = new Set(chk ? chk.present : []);
    $('targetCard').innerHTML = `
      <div class="tc-sym"><span class="sym">${esc(TJ.fmtSymbol(sh.sym))}</span></div>
      <div class="tc-body">
        <div class="tc-notes">${sh.notes.map(n => `<span class="nn${good.has(mod12(n.midi)) ? ' good' : ''}">${esc(TJ.noteName(n.sp, solf))}</span>`).join('')}</div>
        <div class="tc-meta"><span>Forme ${S.idx + 1} sur ${S.shapes.length}</span>
          <button class="btn" type="button" id="hearBtn">Écouter</button>
          <button class="btn" type="button" id="skipBtn">Suivante</button></div>
      </div>`;
    $('hearBtn').addEventListener('click', () => hearShape(sh));
    $('skipBtn').addEventListener('click', () => nextShape());
  }
  function hearShape(sh) {
    if (!AU.ensure()) return;
    const t = AU.now() + 0.02;
    sh.notes.forEach((n, j) => AU.ep(n.midi, t + j * 0.03, 1.4, 1.1 / Math.sqrt(sh.notes.length)));
    // pendant que l'app joue, le micro l'entendrait : on ignore ce qui arrive
    S.muteUntil = Math.max(S.muteUntil, (S.ctx ? S.ctx.currentTime : 0) + 2.2);
  }
  function nextShape() {
    S.idx = (S.idx + 1) % S.shapes.length;
    S.matcher = null;
    S.lastCheck = null;
    S.advancing = false;
    renderTarget();
  }
  function setVerdict(html, cls) {
    const v = $('verdict');
    v.className = 'verdict' + (cls ? ' ' + cls : '');
    v.innerHTML = html;
  }
  function renderStats() {
    const r = S.results;
    if (!r.length) { $('stats').textContent = ''; return; }
    const ok = r.filter(x => x.ok);
    const ms = ok.map(x => x.ms).sort((a, b) => a - b);
    const med = ms.length ? ms[Math.floor(ms.length / 2)] : null;
    $('stats').textContent = `${ok.length} réussie${ok.length > 1 ? 's' : ''} sur ${r.length} essai${r.length > 1 ? 's' : ''}` +
      (med != null ? ` · reconnaissance médiane ${Math.round(med)} ms après l’attaque` : '');
  }

  function targetFrame(f) {
    const sh = S.shapes[S.idx];
    if (!sh || S.advancing) return;
    if (f.onset) {
      const pre = S.lastFrame ? S.det.snapshot(S.lastFrame) : null;
      S.matcher = S.det.matcher(sh.notes.map(n => n.midi), pre, f.t);
      S.onsetT = f.t;
      S.okStreak = 0;
    }
    if (!S.matcher) return;
    const age = f.t - S.onsetT;
    const r = S.matcher.update(f);
    S.lastCheck = r;
    S.okStreak = r.ok ? S.okStreak + 1 : 0;
    if (S.okStreak >= 2) {
      const ms = age * 1000;
      S.results.push({ ok: true, ms, sym: sh.sym, notes: sh.notes.map(n => n.midi) });
      setVerdict(fr(`✓ ${esc(TJ.fmtSymbol(sh.sym))} reconnu ${Math.round(ms)} ms après l’attaque`), 'ok');
      renderTarget();
      renderStats();
      S.matcher = null;
      S.advancing = true;
      setTimeout(nextShape, 900);
    } else if (age > 0.7) {
      const miss = r.missing.map(pc => NAMES[pc]);
      const extra = Array.from(new Set(r.extra.map(nameOf)));
      S.results.push({ ok: false, sym: sh.sym, notes: sh.notes.map(n => n.midi), missing: miss, extra });
      const parts = [];
      if (miss.length) parts.push(`il manque ${miss.join(', ')}`);
      if (extra.length) parts.push(`en trop : ${extra.join(', ')}`);
      setVerdict(fr(`Pas encore : ${parts.join(' · ') || 'rejoue toutes les notes ensemble'}. Rejoue la forme.`), 'ko');
      renderTarget();
      renderStats();
      S.matcher = null;
    }
  }

  // ---------- Vue « Écoute libre » ----------
  const TEMPL = [
    ['maj7', [0, 4, 11]], ['6', [0, 4, 9]], ['7', [0, 4, 10]], ['m7', [0, 3, 10]], ['m7b5', [0, 3, 6, 10]],
    ['dim7', [0, 3, 6, 9]], ['m6', [0, 3, 9]], ['m(maj7)', [0, 3, 11]], ['7sus4', [0, 5, 10]],
    ['+', [0, 4, 8]], ['', [0, 4, 7]], ['m', [0, 3, 7]], ['sus4', [0, 5, 7]],
  ];
  const ALLOWED = [1, 2, 3, 5, 6, 7, 8, 9]; // tensions et quinte
  function chordName(midis) {
    const pcs = Array.from(new Set(midis.map(mod12)));
    if (pcs.length < 2) return null;
    const bass = mod12(Math.min.apply(null, midis));
    let best = null;
    for (let root = 0; root < 12; root++) {
      const rel = pcs.map(pc => mod12(pc - root));
      for (const [sfx, core] of TEMPL) {
        if (!core.every(c => rel.indexOf(c) >= 0 || (c === 0 && core.length > 2))) continue;
        const coreHit = core.filter(c => rel.indexOf(c) >= 0).length;
        if (coreHit < Math.min(3, core.length)) continue;
        const other = rel.filter(r => core.indexOf(r) < 0);
        const bad = other.filter(r => ALLOWED.indexOf(r) < 0).length;
        const score = coreHit * 2 + other.length * 0.3 - bad * 3 - (rel.indexOf(0) < 0 ? 1.5 : 0) + (root === bass ? 1 : 0) + (core.length >= 3 && sfx.length ? 0.2 : 0);
        if (!best || score > best.score) best = { score, sym: LETTER[root] + sfx, rootless: rel.indexOf(0) < 0 };
      }
    }
    return best && best.score > 2 ? best : null;
  }
  function freeFrame(f) {
    if (f.onset) S.freePending = f.t + 0.12;
    if (S.freePending != null && f.t >= S.freePending) {
      S.freePending = null;
      // On ne garde que les notes nettes : les harmoniques aiguës faibles sont des échos.
      const maxS = f.notes.reduce((x, n) => Math.max(x, n.s), 0);
      const strong = new Set(f.notes.filter(n => n.s >= maxS * 0.4).map(n => n.midi));
      const notes = f.active.filter(m => strong.has(m));
      if (!notes.length) return;
      const ch = chordName(notes);
      S.freeLog.unshift({ t: f.t, notes: notes.slice().sort((a, b) => a - b), chord: ch });
      if (S.freeLog.length > 40) S.freeLog.pop();
      renderFreeLog();
    }
  }
  function renderFreeLog() {
    const ol = $('freeLog');
    if (!S.freeLog.length) { ol.innerHTML = '<li class="empty-row">Les accords que tu joues apparaîtront ici.</li>'; return; }
    const t0 = S.freeLog[0].t;
    ol.innerHTML = S.freeLog.slice(0, 20).map(e => `<li>
      <span class="sym">${e.chord ? esc(TJ.fmtSymbol(e.chord.sym)) : '·'}</span>
      <span class="notes">${e.notes.map(nameOct).join(' ')}</span>
      <small>${e === S.freeLog[0] ? 'à l’instant' : '−' + (t0 - e.t).toFixed(1) + ' s'}</small></li>`).join('');
  }

  // ---------- Accordage du piano (La de référence) ----------
  function tuneFrame(f) {
    if (!f.notes.length || f.level < 0.004) return;
    const maxS = f.notes.reduce((x, n) => Math.max(x, n.s), 0);
    for (const n of f.notes) {
      if (n.s < maxS * 0.6) continue;
      const f0 = D.midiFreq(n.midi, S.det.a4);
      let best = null;
      for (const p of f.peaks) {
        if (Math.abs(p.f / f0 - 1) < 0.03 && (!best || p.a > best.a)) best = p;
      }
      if (best && best.a > 3) S.tune.push(1200 * Math.log2(best.f / f0));
    }
    if (S.tune.length >= 60) {
      const sorted = S.tune.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      S.tune = [];
      if (Math.abs(med) > 3) S.det.a4 *= Math.pow(2, med / 1200);
      const cents = 1200 * Math.log2(S.det.a4 / 440);
      $('tuneInfo').textContent = `Accordage de ton piano : La = ${S.det.a4.toFixed(1)} Hz (${cents >= 0 ? '+' : ''}${Math.round(cents)} cents)`;
    }
  }

  // ---------- Micro ----------
  function onSamples(samples, tEnd) {
    const t0 = performance.now();
    const frames = S.det.push(samples, tEnd);
    for (const f of frames) onFrame(f);
    const dt = performance.now() - t0;
    // Charge de calcul : si on dépasse ~60 % du temps réel, on espace les analyses.
    S.cpu.push(dt / (samples.length / S.ctx.sampleRate * 1000));
    if (S.cpu.length >= 50) {
      const load = S.cpu.reduce((a, b) => a + b, 0) / S.cpu.length;
      S.cpu = [];
      if (load > 0.6 && S.det.hop < 1024) S.det.hop *= 2;
      $('cpuInfo').textContent = `Calcul : ${Math.round(load * 100)} % du temps réel · analyse toutes les ${(S.det.hop / S.ctx.sampleRate * 1000).toFixed(1)} ms`;
    }
  }
  function onFrame(f) {
    S.frame = f;
    if (S.testing) {
      if (f.onset) S.testing.hits.push(f.t);
    } else if (f.t >= S.muteUntil) {
      if (S.mode === 'target') targetFrame(f);
      else freeFrame(f);
      tuneFrame(f);
    }
    S.lastFrame = f;
  }

  async function startMic() {
    if (S.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('micInfo').innerHTML = '<p class="warn">Ce navigateur ne donne pas accès au micro. Ouvre la page dans Chrome, Safari ou Firefox récent, en https.</p>';
      return;
    }
    if (!AU.ensure()) return;
    S.ctx = AU.context();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (e) {
      $('micInfo').innerHTML = '<p class="warn">Accès au micro refusé. Autorise-le dans les réglages du navigateur, puis recharge la page.</p>';
      return;
    }
    try {
      await S.ctx.audioWorklet.addModule('capture-worklet.js');
    } catch (e) {
      $('micInfo').innerHTML = '<p class="warn">Impossible de démarrer l’analyse audio dans ce navigateur.</p>';
      return;
    }
    const src = S.ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(S.ctx, 'tj-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const sink = S.ctx.createGain();
    sink.gain.value = 0;
    src.connect(node);
    node.connect(sink);
    sink.connect(S.ctx.destination);
    S.det = new D.Detector(S.ctx.sampleRate, { a4: 440 });
    node.port.onmessage = e => onSamples(e.data.s, e.data.t);
    S.running = true;

    const st = stream.getAudioTracks()[0].getSettings ? stream.getAudioTracks()[0].getSettings() : {};
    const off = st.echoCancellation === false && st.noiseSuppression !== true && st.autoGainControl !== true;
    const est = [];
    if (S.ctx.baseLatency) est.push(`tampon audio ${Math.round(S.ctx.baseLatency * 1000)} ms`);
    if (st.latency) est.push(`micro ${Math.round(st.latency * 1000)} ms annoncés`);
    $('micInfo').innerHTML = `<p><span class="ok">Micro actif</span> · ${Math.round(S.ctx.sampleRate / 100) / 10} kHz · ` +
      (off ? '<span class="ok">traitements « visio » coupés</span>' : '<span class="warn">le navigateur garde des traitements vocaux (moins précis)</span>') +
      (est.length ? ` · ${est.join(', ')}` : '') + '</p>';
    $('micBtn').textContent = 'Micro actif';
    $('micBtn').disabled = true;
    $('micTools').hidden = false;
    setVerdict('Plaque la forme : toutes les notes ensemble.');
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* facultatif */ }
    requestAnimationFrame(loop);
    setTimeout(() => $(S.mode === 'target' ? 'targetPane' : 'freePane').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }

  function loop() {
    if (S.frame) {
      const db = 20 * Math.log10(Math.max(1e-5, S.frame.level));
      $('meterBar').style.width = Math.max(0, Math.min(100, (db + 60) / 50 * 100)) + '%';
    }
    paint();
    if (S.mode === 'target' && S.lastCheck) {
      const sh = S.shapes[S.idx];
      if (sh) {
        const good = new Set(S.lastCheck.present);
        document.querySelectorAll('.tc-notes .nn').forEach((el, i) => el.classList.toggle('good', good.has(mod12(sh.notes[i].midi))));
      }
    }
    requestAnimationFrame(loop);
  }

  // ---------- Mesure de latence : l'app joue des clics et les réécoute ----------
  function click(t) {
    const ctx = S.ctx;
    const len = Math.floor(ctx.sampleRate * 0.004);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(ctx.destination);
    src.start(t);
  }
  function latencyTest() {
    if (!S.running || S.testing) return;
    const n = 6;
    const t0 = S.ctx.currentTime + 0.5;
    const clicks = [];
    for (let i = 0; i < n; i++) { const t = t0 + i * 0.5; click(t); clicks.push(t); }
    S.testing = { clicks, hits: [] };
    $('latOut').hidden = false;
    $('latOut').textContent = 'Écoute des clics… ne joue pas pendant 3 secondes.';
    setTimeout(() => {
      const test = S.testing;
      S.testing = null;
      const deltas = [];
      test.clicks.forEach(c => {
        const h = test.hits.find(x => x >= c && x < c + 0.4);
        if (h != null) deltas.push((h - c) * 1000);
      });
      if (deltas.length < 3) {
        $('latOut').textContent = fr('Je n’ai pas assez entendu les clics. Monte le volume du haut-parleur (sans casque) et recommence.');
        return;
      }
      deltas.sort((a, b) => a - b);
      const rt = deltas[Math.floor(deltas.length / 2)];
      const out = (S.ctx.outputLatency || S.ctx.baseLatency || 0) * 1000;
      const inp = out ? Math.max(0, rt - out) : rt / 2;
      $('latOut').textContent = fr(`Aller-retour haut-parleur → micro : ${Math.round(rt)} ms (${deltas.length}/${n} clics entendus). ` +
        `Côté micro, il reste environ ${Math.round(inp)} ms${out ? ` (le navigateur annonce ${Math.round(out)} ms côté haut-parleur)` : ' (estimation : la moitié de l’aller-retour)'}. ` +
        'Ton piano, tu l’entends sans aucun délai : ce chiffre ne concerne que l’écran.');
    }, (n * 0.5 + 1.0) * 1000);
  }

  // ---------- Le prof ----------
  function sessionText() {
    const lines = [];
    const t = PLAYABLE.find(x => x.id === S.trickId);
    lines.push(`Notation des notes : ${solf ? 'Do Ré Mi' : 'lettres'}.`);
    if (S.det) lines.push(`Accordage estimé du piano : La = ${S.det.a4.toFixed(1)} Hz.`);
    if (t) lines.push(`Truc travaillé : « ${t.title.replace(/\[\[|\]\]|\{\{|\}\}/g, '')} », tonalité de ${TJ.pcName(S.key, null, solf)}.`);
    const r = S.results.slice(-15);
    if (r.length) {
      lines.push('Essais de formes (du plus ancien au plus récent) :');
      r.forEach(x => {
        const sh = `${TJ.fmtSymbol(x.sym)} (${x.notes.map(nameOct).join(' ')})`;
        lines.push(x.ok ? `- ${sh} : réussi, reconnu en ${Math.round(x.ms)} ms` : `- ${sh} : raté${x.missing && x.missing.length ? ', manquait ' + x.missing.join(', ') : ''}${x.extra && x.extra.length ? ', en trop ' + x.extra.join(', ') : ''}`);
      });
    }
    const fl = S.freeLog.slice(0, 12).reverse();
    if (fl.length) {
      lines.push('Accords joués librement (du plus ancien au plus récent) :');
      fl.forEach(e => lines.push(`- ${e.notes.map(nameOct).join(' ')}${e.chord ? ' → ' + TJ.fmtSymbol(e.chord.sym) + (e.chord.rootless ? ' (sans fondamentale)' : '') : ''}`));
    }
    if (!r.length && !fl.length) lines.push('Rien n’a encore été joué au micro.');
    return lines.join('\n');
  }

  async function askProf(question) {
    const thread = $('profThread');
    const q = document.createElement('p');
    q.className = 'msg q';
    q.textContent = question;
    const a = document.createElement('p');
    a.className = 'msg a';
    a.textContent = '…';
    thread.appendChild(q);
    thread.appendChild(a);
    $('profBtn').disabled = true;
    let text = '';
    try {
      const res = await fetch('/api/prof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, session: sessionText(), history: S.history.slice(-3) }),
      });
      if (res.status === 503) {
        a.className = 'msg err';
        a.textContent = fr('Le prof n’est pas encore branché : il faut ajouter une clé API Anthropic (variable ANTHROPIC_API_KEY) dans les réglages du projet Vercel, puis redéployer.');
        return;
      }
      if (!res.ok || !res.body) throw new Error('http ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        a.textContent = text;
      }
      S.history.push({ q: question, a: text });
    } catch (e) {
      a.className = 'msg err';
      a.textContent = text || fr('Le prof ne répond pas ici. Il ne fonctionne que sur la version en ligne de l’app (Vercel), avec une clé API configurée.');
    } finally {
      $('profBtn').disabled = false;
    }
  }

  // ---------- Toast ----------
  let toastT = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, 3000);
  }

  // ---------- Démarrage ----------
  fillSelects();
  loadShapes();
  renderFreeLog();
  paint();
  $('micBtn').addEventListener('click', startMic);
  $('latBtn').addEventListener('click', latencyTest);
  document.querySelectorAll('.mode-seg [data-mode]').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    document.querySelectorAll('.mode-seg [data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    $('targetPane').hidden = S.mode !== 'target';
    $('freePane').hidden = S.mode !== 'free';
    $('freeLogPane').hidden = S.mode !== 'free';
    S.lastCheck = null;
    S.matcher = null;
    if (S.mode === 'free') setRange(36, 88);
    else loadShapes();
  }));
  $('profForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('profQ').value.trim();
    if (!q) { toast('Écris ta question au prof.'); return; }
    $('profQ').value = '';
    askProf(q);
  });
})();
