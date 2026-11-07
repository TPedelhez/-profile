/* Truc Jazz · Labo d'écoute
   Micro (sans traitements vocaux) → AudioWorklet → détecteur → vérification de la forme attendue.
   Le prof (OpenAI ou Claude) reçoit un résumé texte de ce qui a été reconnu. */
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

  // ---------- Boîte noire : journal de session (événements + son des ratés) ----------
  // Envoyé au stockage privé du projet (Vercel Blob) toutes les 15 s, avec le code d'accès.
  const APP_VERSION = '2026-11-07-boite-noire';
  const LOG_KEY = 'truc-jazz:log';
  const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const LOG = {
    on: (() => { try { return localStorage.getItem(LOG_KEY) !== 'off'; } catch (e) { return true; } })(),
    session: new Date().toISOString().slice(0, 10) + '-' + rnd(8),
    seq: 0,
    queue: [],
    t0: performance.now(),
    clips: 0,
    okClips: 0,
    blocked: false,
    ev(type, data) {
      if (!this.on || this.blocked) return;
      this.queue.push(Object.assign({ t: Math.round(performance.now() - this.t0), type }, data || {}));
      if (this.queue.length >= 60) this.flush();
    },
    flush(beacon) {
      if (!this.on || this.blocked || !this.queue.length) return;
      const events = this.queue.splice(0);
      const body = JSON.stringify({ session: this.session, seq: this.seq++, code: accessCode(), events });
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' })); return; }
      fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 })
        .then(r => { if (r.status === 401) { this.blocked = true; logUi(); } })
        .catch(() => { this.queue = events.concat(this.queue).slice(-400); this.seq--; });
    },
  };
  setInterval(() => LOG.flush(), 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') LOG.flush(true); });
  window.addEventListener('pagehide', () => LOG.flush(true));
  window.addEventListener('error', e => LOG.ev('js_error', { msg: String(e.message || e).slice(0, 300), src: (e.filename || '').split('/').pop(), line: e.lineno }));

  // Les 8 dernières secondes de son du micro, pour en extraire un extrait autour d'un raté
  const RING = { buf: null, pos: 0, sr: 48000, tEnd: 0 };
  function ringPush(samples, tEnd) {
    if (!RING.buf) return;
    const b = RING.buf;
    for (let i = 0; i < samples.length; i++) { b[RING.pos] = samples[i]; RING.pos = (RING.pos + 1) % b.length; }
    RING.tEnd = tEnd;
  }
  function ringSlice(t1, t2) {
    const b = RING.buf;
    const n = Math.round((t2 - t1) * RING.sr);
    const back = Math.round((RING.tEnd - t1) * RING.sr);
    if (!b || back > b.length || n <= 0) return null;
    const out = new Float32Array(n);
    let start = (RING.pos - back + b.length * 2) % b.length;
    for (let i = 0; i < n; i++) out[i] = b[(start + i) % b.length];
    return out;
  }
  function wav(samples, sr) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return new Blob([buf], { type: 'audio/wav' });
  }
  // Envoie ~3,5 s de son autour d'une attaque (1 s avant, 2,5 s après) quand l'audio est arrivé
  function sendClip(onsetT, label, extra) {
    if (!LOG.on || LOG.blocked || LOG.clips >= 40 || !RING.buf) return;
    LOG.clips++;
    const wait = Math.max(0, onsetT + 2.5 - RING.tEnd) * 1000 + 100;
    setTimeout(() => {
      const pcm = ringSlice(onsetT - 1, onsetT + 2.5);
      if (!pcm) return;
      const name = label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/♭/g, 'b').replace(/♯/g, '#');
      fetch(`/api/clip?session=${LOG.session}&label=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-access-code': accessCode() }, body: wav(pcm, RING.sr),
      }).then(r => r.json()).then(d => LOG.ev('clip_saved', Object.assign({ label: name, pathname: d.pathname || null, onset: +onsetT.toFixed(3) }, extra || {})))
        .catch(() => LOG.ev('clip_error', { label: name }));
    }, wait);
  }
  function logUi() {
    const el = $('logInfo');
    if (!el) return;
    $('logToggle').checked = LOG.on;
    el.textContent = !LOG.on ? 'Boîte noire coupée : rien n’est enregistré.'
      : LOG.blocked ? 'Boîte noire en pause : code d’accès manquant ou incorrect.'
        : `Session ${LOG.session} enregistrée (privée).`;
  }
  LOG.ev('session_start', {
    v: APP_VERSION, ua: navigator.userAgent, lang: navigator.language, screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
    solf: store.solf !== false, path: location.pathname,
  });

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
    $('trickSel').addEventListener('change', e => { S.trickId = e.target.value; loadShapes(); LOG.ev('trick', { id: S.trickId, key: S.key }); });
    $('keySel').addEventListener('change', e => { S.key = e.target.value; loadShapes(); LOG.ev('trick', { id: S.trickId, key: S.key }); });
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
      LOG.ev('shape_ok', { trick: S.trickId, key: S.key, sym: sh.sym, notes: sh.notes.map(n => n.midi), ms: Math.round(ms), onset: +S.onsetT.toFixed(3) });
      if (LOG.okClips < 3) { LOG.okClips++; sendClip(S.onsetT, 'ok-' + sh.sym, { ok: true }); }
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
      LOG.ev('shape_fail', {
        trick: S.trickId, key: S.key, sym: sh.sym, notes: sh.notes.map(n => n.midi), missing: r.missing, extra: r.extra,
        heard: f.notes.map(n => [n.midi, +n.s.toFixed(1)]), level: +f.level.toFixed(4), onset: +S.onsetT.toFixed(3), a4: +S.det.a4.toFixed(1),
      });
      sendClip(S.onsetT, 'rate-' + sh.sym, { ok: false });
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
      LOG.ev('heard', { notes: notes.slice().sort((a, b) => a - b), chord: ch ? ch.sym : null, mode: S.mode, at: +f.t.toFixed(3) });
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
      if (!S.tuneLogAt || performance.now() - S.tuneLogAt > 10000) { S.tuneLogAt = performance.now(); LOG.ev('tune', { a4: +S.det.a4.toFixed(2), med: +med.toFixed(1) }); }
      const cents = 1200 * Math.log2(S.det.a4 / 440);
      $('tuneInfo').textContent = `Accordage de ton piano : La = ${S.det.a4.toFixed(1)} Hz (${cents >= 0 ? '+' : ''}${Math.round(cents)} cents)`;
    }
  }

  // ---------- Micro ----------
  function onSamples(samples, tEnd) {
    const t0 = performance.now();
    ringPush(samples, tEnd);
    const frames = S.det.push(samples, tEnd);
    for (const f of frames) onFrame(f);
    const dt = performance.now() - t0;
    // Charge de calcul : si on dépasse ~60 % du temps réel, on espace les analyses.
    S.cpu.push(dt / (samples.length / S.ctx.sampleRate * 1000));
    if (S.cpu.length >= 50) {
      const load = S.cpu.reduce((a, b) => a + b, 0) / S.cpu.length;
      S.cpu = [];
      if (load > 0.6 && S.det.hop < 1024) S.det.hop *= 2;
      if (!S.cpuLogAt || performance.now() - S.cpuLogAt > 10000) { S.cpuLogAt = performance.now(); LOG.ev('cpu', { load: +load.toFixed(2), hop: S.det.hop }); }
      $('cpuInfo').textContent = `Calcul : ${Math.round(load * 100)} % du temps réel · analyse toutes les ${(S.det.hop / S.ctx.sampleRate * 1000).toFixed(1)} ms`;
    }
  }
  function onFrame(f) {
    S.frame = f;
    if (f.onset) S.lastOnsetT = f.t;
    if (S.testing) {
      if (f.onset) S.testing.hits.push(f.t);
    } else if (f.t >= S.muteUntil) {
      if (S.mode === 'target') targetFrame(f);
      freeFrame(f); // le journal de ce qui est joué sert aussi au prof, dans les deux modes
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
      LOG.ev('mic_error', { name: e && e.name });
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
    RING.sr = S.ctx.sampleRate;
    RING.buf = new Float32Array(Math.round(S.ctx.sampleRate * 8));

    const st = stream.getAudioTracks()[0].getSettings ? stream.getAudioTracks()[0].getSettings() : {};
    const off = st.echoCancellation === false && st.noiseSuppression !== true && st.autoGainControl !== true;
    const est = [];
    if (S.ctx.baseLatency) est.push(`tampon audio ${Math.round(S.ctx.baseLatency * 1000)} ms`);
    if (st.latency) est.push(`micro ${Math.round(st.latency * 1000)} ms annoncés`);
    $('micInfo').innerHTML = `<p><span class="ok">Micro actif</span> · ${Math.round(S.ctx.sampleRate / 100) / 10} kHz · ` +
      (off ? '<span class="ok">traitements « visio » coupés</span>' : '<span class="warn">le navigateur garde des traitements vocaux (moins précis)</span>') +
      (est.length ? ` · ${est.join(', ')}` : '') + '</p>';
    LOG.ev('mic_start', { sr: S.ctx.sampleRate, settings: st, baseLatency: S.ctx.baseLatency || null, outputLatency: S.ctx.outputLatency || null, off });
    if (LOG.on && !accessCode() && askAccessCode) askAccessCode();
    logUi();
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
      LOG.ev('latency_test', { deltas: deltas.map(Math.round), heard: deltas.length, clicks: n, out: Math.round((S.ctx.outputLatency || S.ctx.baseLatency || 0) * 1000) });
      const rt = deltas[Math.floor(deltas.length / 2)];
      const out = (S.ctx.outputLatency || S.ctx.baseLatency || 0) * 1000;
      const inp = out ? Math.max(0, rt - out) : rt / 2;
      $('latOut').textContent = fr(`Aller-retour haut-parleur → micro : ${Math.round(rt)} ms (${deltas.length}/${n} clics entendus). ` +
        `Côté micro, il reste environ ${Math.round(inp)} ms${out ? ` (le navigateur annonce ${Math.round(out)} ms côté haut-parleur)` : ' (estimation : la moitié de l’aller-retour)'}. ` +
        'Ton piano, tu l’entends sans aucun délai : ce chiffre ne concerne que l’écran.');
    }, (n * 0.5 + 1.0) * 1000);
  }

  // ---------- Le prof ----------
  function ago(t) {
    const now = S.ctx ? S.ctx.currentTime : t;
    const d = Math.max(0, now - t);
    return d < 1 ? 'à l’instant' : `il y a ${d.toFixed(1).replace('.', ',')} s`;
  }
  function sessionText() {
    const lines = [];
    const t = PLAYABLE.find(x => x.id === S.trickId);
    lines.push(`Notation des notes : ${solf ? 'Do Ré Mi' : 'lettres'}. Mode de l’app : ${S.mode === 'target' ? '« Joue la forme »' : '« Écoute libre »'}.`);
    if (S.det) lines.push(`Accordage estimé du piano : La = ${S.det.a4.toFixed(1)} Hz.`);
    if (t && S.mode === 'target') {
      lines.push(`Truc travaillé : « ${t.title.replace(/\[\[|\]\]|\{\{|\}\}/g, '')} », tonalité de ${TJ.pcName(S.key, null, solf)}.`);
      const sh = S.shapes[S.idx];
      if (sh) lines.push(`Forme demandée en ce moment : ${TJ.fmtSymbol(sh.sym)} (${sh.notes.map(n => nameOct(n.midi)).join(' ')}).`);
    }
    const r = S.results.slice(-12);
    if (r.length) {
      lines.push('Essais de formes (du plus ancien au plus récent) :');
      r.forEach(x => {
        const sh = `${TJ.fmtSymbol(x.sym)} (${x.notes.map(nameOct).join(' ')})`;
        lines.push(x.ok ? `- ${sh} : réussi, reconnu en ${Math.round(x.ms)} ms` : `- ${sh} : raté${x.missing && x.missing.length ? ', manquait ' + x.missing.join(', ') : ''}${x.extra && x.extra.length ? ', en trop ' + x.extra.join(', ') : ''}`);
      });
    }
    const fl = S.freeLog.slice(0, 16).reverse();
    if (fl.length) {
      lines.push('Ce qui vient d’être joué, attaque par attaque (reconnaissance libre, approximative : une basse peut manquer ou une harmonique passer pour une note ; du plus ancien au plus récent) :');
      fl.forEach(e => lines.push(`- ${ago(e.t)} : ${e.notes.map(nameOct).join(' ')}${e.chord ? ' → ' + TJ.fmtSymbol(e.chord.sym) + (e.chord.rootless ? ' (sans fondamentale)' : '') : ''}`));
    }
    if (!r.length && !fl.length) lines.push('Rien n’a encore été joué au micro.');
    return lines.join('\n');
  }

  // --- Voix du prof : lue phrase par phrase dès que le texte arrive ---
  const TTS = {
    ok: 'speechSynthesis' in window,
    voice: null,
    pending: 0,
    onIdle: null,
    pick() {
      if (!this.ok) return;
      const vs = speechSynthesis.getVoices().filter(v => /^fr(-|_|$)/i.test(v.lang));
      const score = v => (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0) + (/am[ée]lie|thomas|audrey|aur[ée]lie|marie|daniel/i.test(v.name) ? 2 : 0) + (/fr-FR/i.test(v.lang) ? 1 : 0);
      this.voice = vs.sort((a, b) => score(b) - score(a))[0] || null;
    },
    unlock() { // iOS : la synthèse doit démarrer pendant un geste de l'utilisateur
      if (!this.ok) return;
      this.pick();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    },
    say(text, onStart) {
      if (!this.ok || !text.trim()) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.07;
      this.pending++;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.pending = Math.max(0, this.pending - 1);
        if (!this.pending && this.onIdle) { const f = this.onIdle; this.onIdle = null; f(); }
      };
      u.onstart = () => { if (onStart) onStart(); };
      u.onend = u.onerror = finish;
      // filet de sécurité : certains moteurs n'annoncent pas toujours la fin d'une phrase
      setTimeout(finish, 4000 + text.length * 120);
      speechSynthesis.speak(u);
      // pendant que le prof parle, le micro l'entend : le détecteur ignore ce qui arrive
      if (S.ctx) S.muteUntil = Math.max(S.muteUntil, S.ctx.currentTime + 1 + text.length * 0.07);
    },
    stop() {
      if (!this.ok) return;
      speechSynthesis.cancel();
      this.pending = 0;
      if (S.ctx) S.muteUntil = S.ctx.currentTime + 0.3;
      if (this.onIdle) { const f = this.onIdle; this.onIdle = null; f(); }
    },
    whenIdle(f) { if (!this.pending) f(); else this.onIdle = f; },
  };
  if (TTS.ok) { TTS.pick(); speechSynthesis.onvoiceschanged = () => TTS.pick(); }

  // Code d'accès (si le propriétaire en a défini un dans Vercel), gardé sur cet appareil
  const CODE_KEY = 'truc-jazz:code';
  function accessCode() { try { return localStorage.getItem(CODE_KEY) || ''; } catch (e) { return ''; } }
  function askAccessCode() {
    const c = window.prompt('Code d’accès du prof (défini dans Vercel, variable ACCESS_CODE) :');
    if (c == null) return false;
    try { localStorage.setItem(CODE_KEY, c.trim()); } catch (e) { /* pas de stockage : on redemandera */ }
    return true;
  }
  async function apiFetch(url, init, retried) {
    init = init || {};
    init.headers = Object.assign({}, init.headers, { 'x-access-code': accessCode() });
    const res = await fetch(url, init);
    if (res.status === 401 && !retried && askAccessCode()) return apiFetch(url, init, true);
    return res;
  }

  let profAbort = null;
  async function askProf(question, opts) {
    opts = opts || {};
    const voice = !!opts.voice;
    const thread = $('profThread');
    const q = document.createElement('p');
    q.className = 'msg q';
    q.textContent = question;
    const a = document.createElement('p');
    a.className = 'msg a';
    a.textContent = '…';
    thread.appendChild(q);
    thread.appendChild(a);
    a.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('profBtn').disabled = true;
    const t0 = opts.t0 || performance.now();
    let tText = null;
    let tVoice = null;
    let text = '';
    let spoken = 0;
    const showLat = () => {
      if (!voice || tText == null) return;
      $('voiceLat').textContent = `Tu as fini de parler → réponse écrite en ${((tText - t0) / 1000).toFixed(1).replace('.', ',')} s` +
        (tVoice != null ? ` · voix en ${((tVoice - t0) / 1000).toFixed(1).replace('.', ',')} s` : '');
    };
    // découpe en phrases dès qu'elles sont complètes
    const flush = final => {
      const rest = text.slice(spoken);
      const re = final ? /[\s\S]+$/ : /^[\s\S]*?[.!?…:](\s|$)/;
      let m;
      let chunk = '';
      while ((m = re.exec(text.slice(spoken)))) {
        chunk = m[0];
        spoken += chunk.length;
        if (voice) TTS.say(chunk, () => { if (tVoice == null) { tVoice = performance.now(); showLat(); } });
        if (final) break;
      }
      return rest;
    };
    profAbort = new AbortController();
    LOG.ev('prof_ask', { q: question, voice });
    let provider = null;
    try {
      const res = await apiFetch('/api/prof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, session: sessionText(), history: S.history.slice(-3), voice }),
        signal: profAbort.signal,
      });
      if (res.status === 401) {
        a.className = 'msg err';
        a.textContent = fr('Code d’accès incorrect.');
        return;
      }
      if (res.status === 503) {
        a.className = 'msg err';
        a.textContent = fr('Le prof n’est pas encore branché : il faut une clé API (OPENAI_API_KEY ou ANTHROPIC_API_KEY) dans les réglages du projet Vercel, puis redéployer.');
        if (voice) TTS.say('Je ne suis pas encore branché : il manque la clé API dans Vercel.');
        return;
      }
      if (!res.ok || !res.body) throw new Error('http ' + res.status);
      provider = res.headers.get('X-Prof-Provider');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (tText == null && text.trim()) { tText = performance.now(); showLat(); }
        a.textContent = text;
        flush(false);
      }
      flush(true);
      S.history.push({ q: question, a: text });
      LOG.ev('prof_answer', { a: text, provider, voice, textMs: tText != null ? Math.round(tText - t0) : null, voiceMs: tVoice != null ? Math.round(tVoice - t0) : null });
    } catch (e) {
      LOG.ev('prof_error', { msg: String(e && (e.name || e.message) || e), partial: text.slice(0, 200) });
      if (e && e.name === 'AbortError') { a.textContent = (text || '') + ' (interrompu)'; return; }
      a.className = 'msg err';
      a.textContent = text || fr('Le prof ne répond pas ici. Il ne fonctionne que sur la version en ligne de l’app (Vercel), avec une clé API configurée.');
    } finally {
      profAbort = null;
      $('profBtn').disabled = false;
    }
  }

  // --- Ta voix : reconnaissance vocale du navigateur ---
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const V = { rec: null, on: false, handsFree: false, busy: false, interim: '', timer: 0, lastResult: 0, consumed: false };
  function setVoiceState(state, extra) {
    const btn = $('talkBtn');
    const live = $('voiceLive');
    btn.dataset.state = state;
    const labels = { idle: 'Parler au prof', listen: 'Je t’écoute… (touche pour arrêter)', think: 'Le prof réfléchit…', speak: 'Le prof parle… (touche pour couper)' };
    btn.querySelector('span').textContent = labels[state];
    if (extra != null) live.textContent = extra;
  }
  function listen() {
    if (!SR || V.busy) return;
    V.consumed = false;
    V.interim = '';
    const rec = new SR();
    V.rec = rec;
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      if (V.consumed) return;
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      V.lastResult = performance.now();
      V.interim = (final || interim).trim();
      $('voiceLive').textContent = V.interim ? '« ' + V.interim + ' »' : '';
      clearTimeout(V.timer);
      // Fin de phrase : résultat final, ou 0,7 s sans nouveau mot (plus rapide que l'attente du navigateur)
      if (final.trim()) send(final.trim());
      else V.timer = setTimeout(() => { if (V.interim) send(V.interim); }, 700);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      LOG.ev('voice_error', { error: e.error });
      const msg = {
        'not-allowed': 'Accès au micro refusé pour la reconnaissance vocale.',
        'service-not-allowed': 'La reconnaissance vocale est désactivée sur cet appareil.',
        'audio-capture': 'Le micro est déjà pris : sur ce téléphone, l’écoute du piano et la reconnaissance vocale ne peuvent pas tourner en même temps. Écris ta question en attendant.',
        network: 'La reconnaissance vocale a besoin d’Internet.',
      }[e.error] || 'La reconnaissance vocale s’est arrêtée (' + e.error + ').';
      stopVoice(msg);
    };
    rec.onend = () => {
      V.rec = null;
      if (V.on && !V.busy && !V.consumed) { try { listen(); } catch (err) { /* déjà relancée */ } }
    };
    try { rec.start(); } catch (err) { /* une écoute tourne déjà */ }
    setVoiceState('listen', '');
  }
  function send(text) {
    if (!V.consumed && text) LOG.ev('voice_heard', { text });
    // un bruit isolé (« euh », une note de piano mal comprise) n'est pas une question
    if (V.consumed || (text.split(/\s+/).length < 2 && text.length < 6)) return;
    V.consumed = true;
    clearTimeout(V.timer);
    const t0 = V.lastResult || performance.now();
    if (V.rec) { try { V.rec.abort(); } catch (err) { /* ok */ } }
    V.busy = true;
    setVoiceState('think');
    askProf(text, { voice: true, t0 }).then(() => {
      setVoiceState(TTS.pending ? 'speak' : 'think');
      TTS.whenIdle(() => {
        V.busy = false;
        if (V.on && V.handsFree) listen();
        else { V.on = false; setVoiceState('idle'); }
      });
    });
    const poll = setInterval(() => { if (TTS.pending && V.busy) setVoiceState('speak'); if (!V.busy) clearInterval(poll); }, 150);
  }
  function stopVoice(msg) {
    V.on = false;
    V.busy = false;
    clearTimeout(V.timer);
    if (V.rec) { try { V.rec.abort(); } catch (err) { /* ok */ } }
    if (profAbort) profAbort.abort();
    TTS.stop();
    setVoiceState('idle', msg || '');
  }
  function toggleVoice() {
    const st = $('talkBtn').dataset.state;
    if (st === 'speak' || st === 'think') { stopVoice(); return; }
    if (V.on) { stopVoice(); return; }
    TTS.unlock();
    // réveille la fonction serveur pendant que tu parles (évite le démarrage à froid)
    fetch('/api/prof', { method: 'GET' }).catch(() => {});
    V.on = true;
    V.handsFree = $('handsFree').checked;
    listen();
  }

  // ---------- Prof temps réel (OpenAI Realtime, WebRTC) ----------
  // Le son du micro part en direct vers le modèle vocal : il entend ta voix et ton piano.
  // En plus, l'app lui envoie en texte ce que le détecteur a reconnu (noms exacts des notes).
  const RT = { pc: null, dc: null, mic: null, audio: null, an: null, buf: null, on: false,
    lastCtx: '', lastCtxAt: 0, tStop: null, latShown: true, bubble: null, text: '', speaking: false, lastPiano: -1 };
  function rtStatus(msg) { $('rtStatus').textContent = msg; }
  function rtSend(obj) { if (RT.dc && RT.dc.readyState === 'open') RT.dc.send(JSON.stringify(obj)); }
  function rtContext(force) {
    const txt = sessionText();
    const now = performance.now();
    if (!force && (txt === RT.lastCtx || now - RT.lastCtxAt < 2500)) return;
    RT.lastCtx = txt;
    RT.lastCtxAt = now;
    rtSend({ type: 'conversation.item.create', item: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: '[App] Infos automatiques du détecteur (pas une question de l’élève) :\n' + txt }] } });
  }
  function rtBubble() {
    const p = document.createElement('p');
    p.className = 'msg a rt';
    p.textContent = '…';
    $('profThread').appendChild(p);
    p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return p;
  }
  function rtEvent(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        LOG.ev('rt_speech_start');
        rtStatus('Il t’écoute…');
        rtContext(false);
        break;
      case 'input_audio_buffer.speech_stopped':
        LOG.ev('rt_speech_stop');
        RT.tStop = performance.now();
        RT.latShown = false;
        rtStatus('Il réfléchit…');
        break;
      case 'response.output_audio_transcript.delta':
        if (!RT.bubble) { RT.bubble = rtBubble(); RT.text = ''; }
        RT.text += ev.delta || '';
        RT.bubble.textContent = RT.text;
        break;
      case 'response.output_audio_transcript.done':
        LOG.ev('rt_answer', { a: ev.transcript || RT.text });
        if (RT.bubble) { RT.bubble.textContent = ev.transcript || RT.text; S.history.push({ q: '(à l’oral)', a: RT.bubble.textContent }); }
        RT.bubble = null;
        break;
      case 'response.done':
        rtStatus('À toi : parle-lui, ou joue.');
        break;
      case 'error':
        LOG.ev('rt_error', { msg: (ev.error && ev.error.message) || null });
        rtStatus('Erreur du modèle vocal : ' + ((ev.error && ev.error.message) || 'inconnue'));
        break;
      default:
    }
  }
  // Écoute la voix du prof : sert à mesurer son délai de réponse et à couper le détecteur de piano pendant qu'il parle
  function rtWatch(stream) {
    if (!AU.ensure()) return;
    const ctx = AU.context();
    const src = ctx.createMediaStreamSource(stream);
    RT.an = ctx.createAnalyser();
    RT.an.fftSize = 1024;
    RT.buf = new Float32Array(RT.an.fftSize);
    src.connect(RT.an);
  }
  function rtTick() {
    if (!RT.on) return;
    if (RT.an) {
      RT.an.getFloatTimeDomainData(RT.buf);
      let e = 0;
      for (let i = 0; i < RT.buf.length; i++) e += RT.buf[i] * RT.buf[i];
      const speaking = Math.sqrt(e / RT.buf.length) > 0.01;
      if (speaking) {
        if (S.ctx) S.muteUntil = Math.max(S.muteUntil, S.ctx.currentTime + 0.4);
        if (!RT.latShown && RT.tStop != null) {
          RT.latShown = true;
          LOG.ev('rt_latency', { ms: Math.round(performance.now() - RT.tStop) });
          $('rtLat').textContent = `Tu as fini de parler → il répond à voix haute en ${((performance.now() - RT.tStop) / 1000).toFixed(2).replace('.', ',')} s`;
        }
        if (!RT.speaking) rtStatus('Il parle… (tu peux lui couper la parole)');
      }
      RT.speaking = speaking;
    }
    // Option : ne pas lui envoyer le piano (le micro se coupe 1,2 s après chaque attaque)
    if (RT.mic && $('rtGate').checked && S.running) {
      const playing = S.lastOnsetT != null && S.ctx.currentTime - S.lastOnsetT < 1.2;
      RT.mic.enabled = !playing;
    } else if (RT.mic) {
      RT.mic.enabled = true;
    }
    requestAnimationFrame(rtTick);
  }
  async function rtStart() {
    const btn = $('rtBtn');
    btn.disabled = true;
    rtStatus('Connexion…');
    try {
      if (!AU.ensure()) throw new Error('audio');
      const res = await apiFetch('/api/realtime', { method: 'POST' });
      if (res.status === 503) { rtStatus('Pas encore branché : ajoute ta clé OpenAI (variable OPENAI_API_KEY) dans le projet Vercel, puis redéploie.'); return; }
      if (res.status === 401) { rtStatus('Code d’accès incorrect.'); return; }
      if (!res.ok) {
        let d = {};
        try { d = await res.json(); } catch (e) { /* réponse vide */ }
        rtStatus('OpenAI a refusé la session' + (d.status ? ' (' + d.status + ')' : '') + (d.detail ? ' : ' + d.detail : '.'));
        return;
      }
      const { value } = await res.json();
      // Pour lui, on garde l'annulation d'écho : sans elle, il s'entend lui-même dans le haut-parleur.
      const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      const pc = new RTCPeerConnection();
      RT.audio = RT.audio || Object.assign(document.createElement('audio'), { autoplay: true });
      RT.audio.hidden = true;
      document.body.appendChild(RT.audio);
      pc.ontrack = e => { RT.audio.srcObject = e.streams[0]; rtWatch(e.streams[0]); };
      RT.mic = ms.getTracks()[0];
      pc.addTrack(RT.mic, ms);
      const dc = pc.createDataChannel('oai-events');
      dc.onmessage = e => { try { rtEvent(JSON.parse(e.data)); } catch (err) { /* événement illisible */ } };
      dc.onopen = () => { rtContext(true); rtStatus('Connecté. Parle-lui, ou joue.'); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!sdp.ok) throw new Error('sdp ' + sdp.status);
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdp.text() });
      pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].indexOf(pc.connectionState) >= 0 && RT.on) rtStop('Appel terminé (' + pc.connectionState + ').'); };
      RT.pc = pc;
      RT.dc = dc;
      RT.on = true;
      LOG.ev('rt_connected', { gate: $('rtGate').checked });
      btn.textContent = 'Raccrocher';
      btn.dataset.on = '1';
      requestAnimationFrame(rtTick);
    } catch (e) {
      rtStatus('Impossible d’ouvrir l’appel vocal (' + (e.message || e) + ').');
      rtStop();
    } finally {
      btn.disabled = false;
    }
  }
  function rtStop(msg) {
    if (RT.on || msg) LOG.ev('rt_stop', { msg: msg || null });
    RT.on = false;
    try { if (RT.pc) RT.pc.close(); } catch (e) { /* déjà fermé */ }
    if (RT.mic) RT.mic.stop();
    if (RT.audio) RT.audio.srcObject = null;
    RT.pc = RT.dc = RT.mic = RT.an = null;
    RT.bubble = null;
    const btn = $('rtBtn');
    btn.textContent = 'Appeler le prof ChatGPT';
    delete btn.dataset.on;
    if (msg) rtStatus(msg);
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

  // ---------- Interrupteur de la boîte noire ----------
  function initLogToggle() {
    const t = $('logToggle');
    if (!t) return;
    t.addEventListener('change', () => {
      LOG.on = t.checked;
      try { localStorage.setItem(LOG_KEY, LOG.on ? 'on' : 'off'); } catch (e) { /* tant pis */ }
      if (LOG.on) { LOG.blocked = false; if (!accessCode()) askAccessCode(); LOG.ev('log_on'); } else { LOG.queue = []; }
      logUi();
    });
    logUi();
  }

  // ---------- Démarrage ----------
  initLogToggle();
  fillSelects();
  loadShapes();
  renderFreeLog();
  paint();
  $('micBtn').addEventListener('click', startMic);
  $('latBtn').addEventListener('click', latencyTest);
  document.querySelectorAll('.mode-seg [data-mode]').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    LOG.ev('mode', { mode: S.mode });
    document.querySelectorAll('.mode-seg [data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    $('targetPane').hidden = S.mode !== 'target';
    $('freePane').hidden = S.mode !== 'free';
    $('freeLogPane').hidden = S.mode !== 'free';
    S.lastCheck = null;
    S.matcher = null;
    if (S.mode === 'free') setRange(36, 88);
    else loadShapes();
  }));
  if (SR) {
    $('talkBtn').addEventListener('click', toggleVoice);
    setVoiceState('idle', '');
  } else {
    $('voiceBox').hidden = true;
    $('voiceNo').hidden = false;
  }
  if (window.RTCPeerConnection) {
    $('rtBtn').addEventListener('click', () => { if (RT.on) rtStop('Raccroché.'); else rtStart(); });
    $('rtGate').addEventListener('change', e => {
      if (e.target.checked && !S.running) toast('Active d’abord le micro du piano (en haut) : c’est lui qui sait quand tu joues.');
    });
  } else {
    $('rtBox').hidden = true;
  }
  $('profForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('profQ').value.trim();
    if (!q) { toast('Écris ta question au prof.'); return; }
    $('profQ').value = '';
    askProf(q);
  });
})();
