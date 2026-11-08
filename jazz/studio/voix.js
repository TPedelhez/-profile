/* Truc Jazz · Studio vocal : conversation en direct avec le prof (OpenAI Realtime, WebRTC).
   Le modèle entend ta voix (et ton piano), te répond à voix haute, et appelle des outils de la page :
   montrer (partition + clavier + son), voicings, trucs, ecouter (ce que tu viens de jouer, reconnu au micro). */
(function () {
  'use strict';

  const TJ = window.TJ;
  const AU = window.TJAudio;
  const C = window.TJCards;
  const D = window.TJDetector;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mod12 = m => ((m % 12) + 12) % 12;
  const NAMES = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
  const nameOct = m => NAMES[mod12(m)] + (Math.floor(m / 12) - 1);
  const IDLE_MS = 4 * 60 * 1000;

  // ---------- Préférences, code d'accès ----------
  const pref = (k, d) => { try { const v = localStorage.getItem('tj-voix:' + k); return v == null ? d : v === '1'; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('tj-voix:' + k, v ? '1' : '0'); } catch (e) { /* rien */ } };
  const CODE_KEY = 'truc-jazz:code';
  const accessCode = () => { try { return localStorage.getItem(CODE_KEY) || ''; } catch (e) { return ''; } };
  function askAccessCode() {
    const c = window.prompt('Code d’accès du prof (défini dans Vercel, variable ACCESS_CODE) :');
    if (c == null) return false;
    try { localStorage.setItem(CODE_KEY, c.trim()); } catch (e) { /* on redemandera */ }
    return true;
  }
  async function apiFetch(url, init, retried) {
    init = Object.assign({}, init);
    init.headers = Object.assign({}, init.headers, { 'x-access-code': accessCode() });
    const res = await fetch(url, init);
    if (res.status === 401 && !retried && askAccessCode()) return apiFetch(url, init, true);
    return res;
  }

  // ---------- Boîte noire ----------
  const LOG = {
    session: new Date().toISOString().slice(0, 10) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''),
    seq: 0, queue: [], t0: performance.now(),
    ev(type, data) {
      if (!$('logToggle').checked) return;
      this.queue.push(Object.assign({ t: Math.round(performance.now() - this.t0), type, app: 'studio-vocal' }, data || {}));
      if (this.queue.length >= 40) this.flush();
    },
    flush(beacon) {
      if (!this.queue.length || !accessCode()) return;
      const body = JSON.stringify({ session: this.session, seq: this.seq++, code: accessCode(), events: this.queue.splice(0) });
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' })); return; }
      fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 }).catch(() => {});
    },
  };
  setInterval(() => LOG.flush(), 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') LOG.flush(true); });

  // ---------- Fil de la conversation ----------
  function addMsg(kind, text) {
    const el = document.createElement('article');
    el.className = 'msg ' + kind;
    el.innerHTML = `<div class="bubble"><p>${esc(text)}</p></div><div class="cards"></div>`;
    $('thread').appendChild(el);
    el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return { el, p: el.querySelector('.bubble p'), cards: el.querySelector('.cards'), n: 0, text: '' };
  }
  const status = s => { $('status').textContent = s || ''; };

  // ---------- Écoute du piano (facultative) ----------
  const PIANO = { on: false, det: null, ctx: null, journal: [], pending: null, last: null, muteUntil: 0, sentUpTo: 0 };
  const TEMPL = [['maj7', [0, 4, 11]], ['6', [0, 4, 9]], ['7', [0, 4, 10]], ['m7', [0, 3, 10]], ['m7b5', [0, 3, 6, 10]], ['dim7', [0, 3, 6, 9]],
    ['m6', [0, 3, 9]], ['m(maj7)', [0, 3, 11]], ['7sus4', [0, 5, 10]], ['+', [0, 4, 8]], ['', [0, 4, 7]], ['m', [0, 3, 7]]];
  const LETTER = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  function chordName(midis) {
    const pcs = Array.from(new Set(midis.map(mod12)));
    if (pcs.length < 2) return null;
    const bass = mod12(Math.min.apply(null, midis));
    let best = null;
    for (let root = 0; root < 12; root++) {
      const rel = pcs.map(pc => mod12(pc - root));
      for (const [sfx, core] of TEMPL) {
        const hit = core.filter(c => rel.indexOf(c) >= 0).length;
        if (hit < Math.min(3, core.length) || (core.length > 2 && core.slice(1).some(c => rel.indexOf(c) < 0))) continue;
        const bad = rel.filter(r => core.indexOf(r) < 0 && [1, 2, 3, 5, 6, 7, 8, 9].indexOf(r) < 0).length;
        const score = hit * 2 - bad * 3 - (rel.indexOf(0) < 0 ? 1.5 : 0) + (root === bass ? 1 : 0);
        if (!best || score > best.score) best = { score, sym: LETTER[root] + sfx };
      }
    }
    return best && best.score > 2 ? best.sym : null;
  }
  // Sur iPhone et iPad, ouvrir le micro une deuxième fois coupe le premier : l'écoute du piano partage alors le micro de l'appel.
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function startPiano(shared) {
    if (PIANO.on) return true;
    try {
      AU.ensure();
      PIANO.ctx = AU.context();
      const stream = shared || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      await PIANO.ctx.audioWorklet.addModule('../ecoute/capture-worklet.js');
      const src = PIANO.ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(PIANO.ctx, 'tj-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const sink = PIANO.ctx.createGain();
      sink.gain.value = 0;
      src.connect(node); node.connect(sink); sink.connect(PIANO.ctx.destination);
      PIANO.det = new D.Detector(PIANO.ctx.sampleRate, { a4: 440 });
      PIANO.stream = stream;
      PIANO.shared = !!shared;
      PIANO.nodes = [src, node, sink];
      node.port.onmessage = e => {
        const frames = PIANO.det.push(e.data.s, e.data.t);
        for (const f of frames) {
          if (f.t < PIANO.muteUntil) continue;
          if (f.onset) PIANO.pending = f.t + 0.12;
          if (PIANO.pending != null && f.t >= PIANO.pending) {
            PIANO.pending = null;
            const maxS = f.notes.reduce((x, n) => Math.max(x, n.s), 0);
            const strong = new Set(f.notes.filter(n => n.s >= maxS * 0.4).map(n => n.midi));
            const notes = f.active.filter(m => strong.has(m)).sort((a, b) => a - b);
            if (notes.length) {
              PIANO.journal.push({ t: f.t, notes, chord: chordName(notes) });
              if (PIANO.journal.length > 40) PIANO.journal.shift();
            }
          }
        }
      };
      PIANO.on = true;
      return true;
    } catch (e) {
      status('Impossible d’écouter le piano : autorise le micro, puis réessaie.');
      $('pianoToggle').checked = false;
      return false;
    }
  }
  function stopPiano() {
    PIANO.on = false;
    (PIANO.nodes || []).forEach(n => { try { n.disconnect(); } catch (e) { /* déjà débranché */ } });
    if (PIANO.nodes && PIANO.nodes[1]) PIANO.nodes[1].port.onmessage = null;
    PIANO.nodes = null;
    if (PIANO.stream && !PIANO.shared) PIANO.stream.getTracks().forEach(t => t.stop());
    PIANO.stream = null;
  }
  function journalText(secondes) {
    if (!PIANO.on) return null;
    const now = PIANO.ctx.currentTime;
    const win = Math.max(3, Math.min(120, Number(secondes) || 30));
    const items = PIANO.journal.filter(j => now - j.t <= win);
    return items.map(j => `il y a ${(now - j.t).toFixed(1)} s : ${j.notes.map(nameOct).join(' ')}${j.chord ? ' → ' + TJ.fmtSymbol(j.chord) : ''}`);
  }

  // ---------- Outils du prof ----------
  const ECOUTER = {
    description: 'Renvoie ce que l’élève vient de jouer au piano, reconnu au micro par l’app (accords et notes, il y a combien de secondes). À appeler quand il te demande d’écouter, si c’était juste, ou de commenter ce qu’il vient de jouer. La reconnaissance peut se tromper (une basse manquante, une harmonique prise pour une note).',
    parameters: { type: 'object', properties: { secondes: { type: 'number', description: 'Fenêtre à regarder, 30 s par défaut' } } },
  };
  const JOUER = {
    description: 'Joue au clavier de l’écran, comme un prof qui fait entendre ce qu’il explique. Sers-t’en sans arrêt, pour le moindre détail. Deux façons : '
      + '(1) notes = quelques notes en notation Truc Jazz : « F3 » (une note), « [G7]F4:1 [Cmaj7]E4:2 » (la septième de sol sept qui descend sur la tierce de do ; l’accord entre crochets donne les degrés affichés), « [Dm7]D3+F3+C4:2 [G7]G2+F3+B3:2 » (deux accords) ; un petit clavier apparaît et les touches s’allument au fur et à mesure. '
      + '(2) exemple = numéro d’un exemple affiché, avec etapes = numéros des cases d’accords sous sa partition (ex. [2, 3] pour rejouer le passage du deuxième au troisième accord) ; egrener = true fait entendre les notes d’une étape une par une, de la plus grave à la plus aiguë, puis ensemble ; sans etapes, tout l’exemple. '
      + 'Le résultat arrive quand c’est fini de jouer, avec ce qui a sonné et le mouvement de chaque voix : attends-le sans parler, puis commente.',
    parameters: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'Notation Truc Jazz : « + » = ensemble, espace = l’une après l’autre, « :2 » = durée en temps' },
        accord: { type: 'string', description: 'Accord de référence pour afficher les degrés sur les touches (ex. G7)' },
        titre: { type: 'string', description: 'Légende courte, ex. « La 7e descend sur la tierce »' },
        main: { type: 'string', enum: ['md', 'mg'], description: 'md (rouge, par défaut) ou mg (bleu)' },
        partition: { type: 'boolean', description: 'Afficher aussi la portée (faux par défaut)' },
        exemple: { type: 'number', description: 'Numéro d’un exemple déjà affiché' },
        etapes: { type: 'array', items: { type: 'number' }, description: 'Étapes de cet exemple à rejouer (1 = la première case d’accord)' },
        egrener: { type: 'boolean', description: 'Notes de l’étape une par une, puis ensemble' },
        tempo: { type: 'number', description: 'Noires par minute (80 par défaut pour notes)' },
      },
    },
  };
  const CARDS = []; // exemples affichés, numérotés pour toute la séance
  const sounded = obj => obj.steps.map(C.stepText).join(' ; ');
  function addCard(obj, msg) {
    msg.cards.appendChild(obj.el);
    obj.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // Une lecture différée : jouée quand le prof a fini sa phrase ; le résultat part quand c'est fini
  const later = (obj, run, output) => ({ defer: true, obj, run, output });
  function runTool(name, args, msg) {
    if (name === 'montrer') {
      const spec = C.specFromInput(args);
      const obj = C.buildCard(spec, CARDS.length + 1); // erreur lisible si la notation est fausse
      CARDS.push(obj);
      addCard(obj, msg);
      const out = C.cardSummary(obj) + '. Affiché à l’écran avec la partition et le clavier.';
      return args.jouer ? later(obj, done => C.play(obj, { onEnd: done }), out + ' Joué en entier.') : out;
    }
    if (name === 'jouer') {
      const tempo = Math.max(40, Math.min(200, Number(args.tempo) || 80));
      if (args.exemple != null) {
        const obj = CARDS[Math.round(args.exemple) - 1];
        if (!obj) throw new Error(`Pas d’exemple n° ${args.exemple}. Exemples affichés : ${CARDS.length ? '1 à ' + CARDS.length : 'aucun'}.`);
        const et = (Array.isArray(args.etapes) ? args.etapes : args.etapes != null ? [args.etapes] : []).map(x => Math.round(Number(x)) - 1);
        if (et.some(i => !(i >= 0 && i < obj.steps.length))) throw new Error(`L’exemple ${obj.n} a ${obj.steps.length} étapes (1 à ${obj.steps.length}).`);
        obj.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (args.egrener) {
          const list = et.length ? et : obj.steps.map((x, i) => i);
          return later(obj, done => C.playArp(obj, list, { onEnd: done }),
            `Joué, exemple ${obj.n} : pour chaque étape, ses notes une par une de la plus grave à la plus aiguë, puis plaquées ensemble — ${list.map(i => C.stepText(obj.steps[i], i)).join(' ; ')}.`);
        }
        if (!et.length) return later(obj, done => C.play(obj, { onEnd: done }), `Exemple ${obj.n} joué en entier : ${sounded(obj)}.`);
        const i = Math.min.apply(null, et);
        const j = Math.max.apply(null, et);
        const part = obj.steps.slice(i, j + 1);
        const moves = part.slice(1).map((s, k) => C.motion(part[k], s)).filter(Boolean);
        return later(obj, done => C.playSteps(obj, i, j, { onEnd: done, bpm: obj.spec.tempo }),
          `Exemple ${obj.n}, joué de l’étape ${i + 1} à ${j + 1} : ${part.map((s, k) => C.stepText(s, i + k)).join(' ; ')}${moves.length ? '. Mouvement des voix : ' + moves.join(' | ') : ''}.`);
      }
      if (!args.notes) throw new Error('Donne notes (ex. « C4:1 B3:2 ») ou exemple + etapes.');
      let accord = '';
      if (args.accord) { const r = TJ.parseUserChord(String(args.accord)); if (r && !r.error) accord = r.display; }
      const spec = { titre: args.titre ? String(args.titre).slice(0, 80) : '', tempo, accord, partition: !!args.partition };
      spec[args.main === 'mg' ? 'mg' : 'md'] = String(args.notes);
      const obj = C.buildCard(spec, 0, { geste: true });
      addCard(obj, msg);
      return later(obj, done => C.play(obj, { onEnd: done }), C.cardSummary(obj) + '.');
    }
    if (name === 'voicings') return C.voicings(args);
    if (name === 'trucs') return C.trucs(args);
    if (name === 'ecouter') {
      const j = journalText(args.secondes);
      if (j == null) return 'L’écoute du piano n’est pas activée : propose à l’élève de cocher « Il écoute aussi mon piano ».';
      return j.length ? { joue: j } : { joue: [], note: 'Rien de reconnu dans cette fenêtre.' };
    }
    throw new Error('Outil inconnu : ' + name);
  }

  const INSTRUCTIONS = `Tu es le prof de piano jazz du « Studio vocal Truc Jazz », en conversation vocale en direct. L'élève a les mains sur son piano acoustique, son téléphone ou son ordinateur posé sur le pupitre. Il apprend le jazz sur le moment, par petits trucs, sans programme.

Comment tu parles : en français, en tutoyant, chaleureux et concret, comme un prof assis à côté du piano. Très court : une à trois phrases, puis tu laisses la place. Va droit au but. Propose souvent une petite chose à essayer tout de suite au clavier. Dis les accords comme on les prononce (« ré mineur sept », « sol sept ») ; ne lis jamais la notation à voix haute.

L'écran : dès que tu parles de notes concrètes (accord, voicing, gamme, phrase, grille), appelle « montrer » : l'exemple s'affiche avec la partition, les cases d'accords (les étapes) et le clavier. Pour les notes exactes d'un voicing, appelle d'abord « voicings ». Pour un truc de la bibliothèque, « trucs ».

Tu as les mains sur le piano de l'écran : joue tout le temps, comme un vrai prof assis au piano qui fait entendre chaque détail en même temps qu'il l'explique. Avec « jouer » tu peux faire entendre n'importe quoi : une note seule, un intervalle, la septième qui descend sur la tierce, une note de passage, une tension, un accord égrené note par note, ou rejouer les étapes 2 et 3 d'un exemple pour faire entendre la résolution. Avance par petits allers-retours : une phrase courte qui annonce (« écoute la septième… »), puis l'appel à « jouer » (ou « montrer » avec jouer: true) ; tu te tais pendant que ça joue, le résultat te revient à la fin avec ce qui a sonné et le mouvement de chaque voix ; alors une phrase de commentaire, et tu rejoues, compares ou fais essayer. Préfère trois petits gestes joués à un long discours. Pour une résolution, écris des voix proches : chaque note bouge d'un ton au plus (la septième descend d'un demi-ton sur la tierce), quitte à changer d'octave. Les outils te renvoient ce qui a vraiment sonné et le mouvement de chaque voix : ne décris que ça, et corrige-toi si un outil signale un saut. Ne dis jamais la notation.

Pour savoir ce que l'élève vient de jouer, appelle « ecouter » (tu entends aussi le son, mais pour les noms exacts des notes, fie-toi à « ecouter »). Des messages « [App] » peuvent aussi te dire ce qu'il a joué : ce ne sont pas des questions, ne leur réponds pas seuls.

${C.NOTATION}`;
  const instructions = () => INSTRUCTIONS + (CARDS.length ? '\n\nDéjà à l’écran au début : ' + CARDS.map(o => C.cardSummary(o)).join('\n') : '');

  function toolDefs() {
    const defs = Object.keys(C.SCHEMAS).map(name => ({ type: 'function', name, description: C.SCHEMAS[name].description, parameters: C.SCHEMAS[name].parameters }));
    defs.push({ type: 'function', name: 'jouer', description: JOUER.description, parameters: JOUER.parameters });
    defs.push({ type: 'function', name: 'ecouter', description: ECOUTER.description, parameters: ECOUTER.parameters });
    return defs;
  }

  // ---------- Appel temps réel ----------
  const RT = {
    pc: null, dc: null, mic: null, audio: null, an: null, buf: null, on: false,
    speaking: false, lastVoice: 0, tStop: null, latShown: true, msg: null, done: new Set(), outputs: [],
    queue: [], playing: false, respDone: true, bufActive: false, sawBuf: false, nextAt: 0,
    unmuteAt: 0, pendingUser: null, respItem: null, respOut: [], drop: false, skipNext: false,
    cardPlaying: false, lastActivity: 0, model: '', heard: new Map(),
  };
  const send = obj => { if (RT.dc && RT.dc.readyState === 'open') RT.dc.send(JSON.stringify(obj)); };

  function sendPianoContext() {
    const j = journalText(20);
    if (!j || !j.length) return;
    const last = PIANO.journal[PIANO.journal.length - 1];
    if (!last || last.t <= PIANO.sentUpTo) return;
    PIANO.sentUpTo = last.t;
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[App] Ce que l’élève vient de jouer (reconnu au micro, pas une question) :\n' + j.join('\n') }] } });
  }

  function execCall(item) {
    if (!item || item.type !== 'function_call' || !item.call_id || RT.done.has(item.call_id)) return;
    RT.done.add(item.call_id);
    if (!RT.msg) RT.msg = addMsg('prof', '');
    let output;
    let args = {};
    try {
      args = JSON.parse(item.arguments || '{}');
      output = runTool(item.name, args, RT.msg);
      LOG.ev('tool', { name: item.name, args: JSON.stringify(args).slice(0, 400) });
    } catch (e) {
      output = { erreur: e.message };
      LOG.ev('tool_error', { name: item.name, msg: e.message, args: JSON.stringify(args).slice(0, 400) });
    }
    if (output && output.defer) { RT.queue.push({ call_id: item.call_id, obj: output.obj, run: output.run, output: output.output }); return; }
    RT.outputs.push({ call_id: item.call_id, output: typeof output === 'string' ? output : JSON.stringify(output) });
  }

  // Les résultats des outils repartent quand sa phrase est finie et que tout a été joué ; alors il reprend la parole
  function flush(silent) {
    if (!silent && (!RT.respDone || RT.queue.length || RT.playing)) return;
    if (!RT.outputs.length) { if (!silent) status('À toi : parle-lui, joue, ou écris.'); return; }
    RT.outputs.splice(0).forEach(o => send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: o.call_id, output: o.output } }));
    if (silent) return;
    send({ type: 'response.create' });
    status('Il reprend…');
  }
  // le clavier qui joue reste visible au-dessus du panneau d'appel
  function reveal(obj) {
    const k = obj.el.querySelector('.dockk') || obj.el;
    k.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // Transcriptions fantômes : ce que la reconnaissance « entend » dans un bruit ou de la musique
  function isGhost(t) {
    const x = String(t || '').toLowerCase().replace(/[.,;:!?…«»"'’()\-\s]+/g, ' ').trim();
    if (!x || !/[a-zà-ÿ]/.test(x)) return true;
    if (/^(chat ?gpt|chat|bonjour|musique|applaudissements|rires|générique)$/.test(x)) return true;
    return /sous titr|amara|abonnez|merci d avoir regard|♪/.test(x);
  }
  function cancelResponse() {
    RT.drop = true;
    send({ type: 'response.cancel' });
    send({ type: 'output_audio_buffer.clear' });
  }
  function dropGhost(itemId, bubble, text) {
    LOG.ev('ghost', { q: text });
    if (bubble) bubble.el.remove();
    if (itemId) send({ type: 'conversation.item.delete', item_id: itemId });
    if (RT.pendingUser === itemId) { RT.pendingUser = null; RT.skipNext = true; }
    else if (RT.respItem === itemId && !RT.respDone) cancelResponse();
  }
  // Bouton « Couper » : il se tait tout de suite (et la démonstration s'arrête)
  function cut() {
    if (RT.queue.length || RT.playing) cancelQueue('coupé par l’élève');
    if (!RT.respDone) send({ type: 'response.cancel' });
    send({ type: 'output_audio_buffer.clear' });
    RT.bufActive = false;
    RT.unmuteAt = 0;
    LOG.ev('cut', {});
    status('Coupé. À toi.');
  }
  function startNext() {
    const it = RT.queue.shift();
    RT.playing = true;
    if (it.obj) reveal(it.obj);
    status('Il joue… écoute.');
    let ended = false;
    const done = interrupted => {
      if (ended) return;
      ended = true;
      RT.playing = false;
      RT.outputs.push({ call_id: it.call_id, output: interrupted ? it.output + ' (interrompu avant la fin)' : it.output });
      RT.nextAt = performance.now() + 300;
      if (!RT.queue.length) setTimeout(() => flush(), 150);
    };
    try { it.run(done); } catch (e) { done(true); }
  }
  // Il parle par-dessus une démonstration en attente : on l'annule, sans relancer de réponse (sa voix en déclenche une)
  function cancelQueue(why) {
    const pending = RT.queue.splice(0);
    pending.forEach(it => RT.outputs.push({ call_id: it.call_id, output: 'Pas joué : ' + why + '.' }));
    if (RT.playing) C.stop();
    flush(true);
  }

  function onEvent(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        RT.lastActivity = performance.now();
        status('Il t’écoute…');
        if (RT.queue.length || RT.playing) cancelQueue('l’élève a parlé');
        sendPianoContext();
        break;
      case 'output_audio_buffer.started':
        if (!RT.sawBuf) LOG.ev('buf_events', {});
        RT.bufActive = true;
        RT.sawBuf = true;
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        RT.bufActive = false;
        break;
      case 'input_audio_buffer.speech_stopped': {
        RT.pendingUser = ev.item_id || null;
        RT.tStop = performance.now();
        RT.latShown = false;
        // bulle « ta voix », remplie quand la transcription arrive
        const m = addMsg('me voice', '…');
        if (ev.item_id) RT.heard.set(ev.item_id, m);
        status('Il réfléchit…');
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const m = RT.heard.get(ev.item_id);
        const t = (ev.transcript || '').trim();
        RT.heard.delete(ev.item_id);
        if (isGhost(t)) { dropGhost(ev.item_id, m, t); break; }
        if (m) { m.p.textContent = t || '(ta voix)'; if (t) m.el.classList.add('heard'); }
        if (t) LOG.ev('said', { q: t });
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const m = RT.heard.get(ev.item_id);
        if (m) m.p.textContent = '(ta voix)';
        RT.heard.delete(ev.item_id);
        break;
      }
      case 'response.created':
        // une bulle par réponse : parole, geste joué, parole… dans l'ordre où ça se passe
        RT.msg = null;
        RT.respDone = false;
        RT.respItem = RT.pendingUser;
        RT.pendingUser = null;
        RT.respOut = [];
        if (RT.skipNext) { RT.skipNext = false; cancelResponse(); }
        break;
      case 'response.output_item.added':
        if (ev.item && ev.item.id) RT.respOut.push(ev.item.id);
        break;
      case 'response.output_audio_transcript.delta':
        if (!RT.msg) RT.msg = addMsg('prof', '');
        RT.msg.text += ev.delta || '';
        RT.msg.p.textContent = RT.msg.text;
        break;
      case 'response.output_audio_transcript.done':
        if (!RT.msg && ev.transcript) RT.msg = addMsg('prof', '');
        if (RT.msg && ev.transcript) { RT.msg.text = ev.transcript; RT.msg.p.textContent = ev.transcript; }
        if (RT.msg) LOG.ev('answer', { a: RT.msg.text });
        break;
      case 'response.output_item.done':
        execCall(ev.item);
        break;
      case 'response.function_call_arguments.done':
        if (ev.name) execCall({ type: 'function_call', call_id: ev.call_id, name: ev.name, arguments: ev.arguments });
        break;
      case 'response.done':
        RT.respDone = true;
        if (RT.drop) {
          // réponse à un bruit, annulée : on l'efface du fil et de la conversation
          RT.drop = false;
          if (RT.msg && !RT.msg.cards.children.length) RT.msg.el.remove();
          RT.msg = null;
          RT.respOut.forEach(id => send({ type: 'conversation.item.delete', item_id: id }));
          status('À toi : parle-lui, joue, ou écris.');
          break;
        }
        if (ev.response && Array.isArray(ev.response.output)) ev.response.output.forEach(execCall);
        if (ev.response && ev.response.status === 'cancelled' && RT.queue.length) cancelQueue('réponse coupée');
        else flush();
        break;
      case 'error': {
        const msg = (ev.error && ev.error.message) || 'inconnue';
        LOG.ev('rt_error', { msg, code: (ev.error && ev.error.code) || null });
        // annuler une réponse déjà finie ou effacer un élément disparu : sans importance
        if (/cancel|not found|does not exist|no active response/i.test(msg + ' ' + ((ev.error && ev.error.code) || ''))) break;
        status('Erreur du modèle vocal : ' + msg);
        break;
      }
      default:
    }
  }

  // La voix du prof : délai de réponse, et moments de silence pour jouer les exemples
  function tick() {
    if (!RT.on) return;
    const now = performance.now();
    if (RT.an) {
      RT.an.getFloatTimeDomainData(RT.buf);
      let e = 0;
      for (let i = 0; i < RT.buf.length; i++) e += RT.buf[i] * RT.buf[i];
      const speaking = Math.sqrt(e / RT.buf.length) > 0.01;
      if (speaking) {
        RT.lastVoice = now;
        RT.lastActivity = now;
        if (PIANO.on) PIANO.muteUntil = PIANO.ctx.currentTime + 0.4;
        if (!RT.latShown && RT.tStop != null) {
          RT.latShown = true;
          const ms = Math.round(now - RT.tStop);
          $('lat').textContent = `Tu as fini de parler → il répond en ${(ms / 1000).toFixed(2).replace('.', ',')} s`;
          LOG.ev('latency', { ms });
        }
        if (!RT.speaking) status('Il parle… (touche « Couper » pour l’interrompre)');
      }
      RT.speaking = speaking;
    }
    // Micro de l'appel fermé pendant qu'il parle ou qu'un exemple joue, et 350 ms après :
    // sinon sa voix ou le piano de l'écran reviennent dans le micro et le coupent en pleine phrase.
    if (RT.speaking || RT.bufActive || RT.cardPlaying) RT.unmuteAt = now + 350;
    const open = now >= RT.unmuteAt;
    if (RT.mic && RT.mic.enabled !== open) RT.mic.enabled = open;
    const busy = RT.speaking || RT.bufActive || RT.playing || RT.queue.length > 0 || !RT.respDone;
    if ($('cutBtn').hidden === busy) $('cutBtn').hidden = !busy;
    // la démonstration attend la fin de sa phrase (et un petit souffle)
    const quiet = now - RT.lastVoice > (RT.bufActive ? 1500 : RT.sawBuf ? 250 : 500);
    if (RT.queue.length && !RT.playing && RT.respDone && quiet && now >= RT.nextAt) startNext();
    if (now - RT.lastActivity > IDLE_MS) { hangUp('Raccroché après 4 minutes sans échange, pour ne pas payer pour rien.'); return; }
    requestAnimationFrame(tick);
  }

  // Pendant qu'un exemple joue, on coupe le micro de l'appel (sinon il s'entend et s'interrompt)
  C.setPlayListener((playing, seconds) => {
    RT.cardPlaying = playing;
    if (RT.mic && playing) RT.mic.enabled = false; // rouvert par tick() un peu après la fin
    if (PIANO.on && playing) PIANO.muteUntil = PIANO.ctx.currentTime + seconds + 0.5;
    if (playing) RT.lastActivity = performance.now();
  });

  async function call() {
    const btn = $('callBtn');
    btn.disabled = true;
    status('Connexion…');
    try {
      if (!AU.ensure()) throw new Error('son indisponible');
      const res = await apiFetch('/api/realtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mini: $('miniToggle').checked }) });
      if (res.status === 503) { status('Pas encore branché : il manque la clé OpenAI dans Vercel.'); return; }
      if (res.status === 401) { status('Code d’accès incorrect.'); return; }
      if (!res.ok) { let d = {}; try { d = await res.json(); } catch (e) { /* vide */ } status('OpenAI a refusé la session' + (d.detail ? ' : ' + d.detail : '.')); return; }
      const { value, model } = await res.json();
      RT.model = model;
      const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      RT.stream = ms;
      if ($('pianoToggle').checked) await startPiano(IOS ? ms : null);
      const pc = new RTCPeerConnection();
      RT.audio = RT.audio || Object.assign(document.createElement('audio'), { autoplay: true });
      RT.audio.hidden = true;
      document.body.appendChild(RT.audio);
      pc.ontrack = e => {
        RT.audio.srcObject = e.streams[0];
        const ctx = AU.context();
        const src = ctx.createMediaStreamSource(e.streams[0]);
        RT.an = ctx.createAnalyser();
        RT.an.fftSize = 1024;
        RT.buf = new Float32Array(RT.an.fftSize);
        src.connect(RT.an);
      };
      RT.mic = ms.getTracks()[0];
      pc.addTrack(RT.mic, ms);
      const dc = pc.createDataChannel('oai-events');
      dc.onmessage = e => { try { onEvent(JSON.parse(e.data)); } catch (err) { /* événement illisible */ } };
      dc.onopen = () => {
        send({ type: 'session.update', session: { type: 'realtime', instructions: instructions(), tools: toolDefs(), tool_choice: 'auto' } });
        status('Connecté. Parle-lui ! Quand il parle ou joue, ton micro se coupe : « Couper » pour l’interrompre.');
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' }, body: offer.sdp,
      });
      if (!sdp.ok) throw new Error('connexion refusée (' + sdp.status + ')');
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdp.text() });
      pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].indexOf(pc.connectionState) >= 0 && RT.on) hangUp('Appel coupé (' + pc.connectionState + ').'); };
      Object.assign(RT, { pc, dc, on: true, lastActivity: performance.now(), lastVoice: 0, done: new Set(), outputs: [], queue: [], playing: false, respDone: true, bufActive: false, sawBuf: false });
      btn.textContent = 'Raccrocher';
      btn.dataset.on = '1';
      $('thread').classList.add('live');
      LOG.ev('connected', { model, piano: PIANO.on });
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* facultatif */ }
      requestAnimationFrame(tick);
    } catch (e) {
      status('Impossible d’ouvrir l’appel : ' + (e.message || e) + '.');
      hangUp();
    } finally {
      btn.disabled = false;
    }
  }

  function hangUp(msg) {
    if (RT.on) LOG.ev('hangup', { msg: msg || null });
    RT.on = false;
    try { if (RT.pc) RT.pc.close(); } catch (e) { /* déjà fermé */ }
    if (RT.mic) RT.mic.stop();
    if (RT.audio) RT.audio.srcObject = null;
    if (RT.playing) C.stop();
    Object.assign(RT, { pc: null, dc: null, mic: null, stream: null, an: null, msg: null, queue: [], playing: false, outputs: [], drop: false, skipNext: false, pendingUser: null });
    $('cutBtn').hidden = true;
    RT.heard.forEach(m => { if (m.p.textContent === '…') m.p.textContent = '(ta voix)'; });
    RT.heard.clear();
    stopPiano();
    const btn = $('callBtn');
    btn.textContent = 'Appeler le prof';
    delete btn.dataset.on;
    $('thread').classList.remove('live');
    if (msg) status(msg);
    LOG.flush();
  }

  function sendText(text) {
    text = text.trim();
    if (!text) return;
    if (!RT.on) { status('Appelle d’abord le prof, puis parle-lui ou écris-lui.'); return; }
    addMsg('me', text);
    RT.lastActivity = performance.now();
    if (RT.queue.length || RT.playing) cancelQueue('l’élève a écrit');
    sendPianoContext();
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    send({ type: 'response.create' });
    LOG.ev('typed', { q: text });
  }

  // pour les tests de bout en bout (outils et consignes réels, sans appel vocal)
  window.TJVoix = { toolDefs, instructions, isGhost, runTool: (name, args) => runTool(name, args, RT.msg || (RT.msg = addMsg('prof', ''))), state: () => ({ mic: RT.mic ? RT.mic.enabled : null, cut: !$('cutBtn').hidden }) };

  // ---------- Démarrage ----------
  // hauteur du panneau d'appel, pour que les exemples ne passent pas dessous
  try {
    const dock = document.querySelector('.dock-in');
    new ResizeObserver(() => document.documentElement.style.setProperty('--dockh', dock.offsetHeight + 'px')).observe(dock);
  } catch (e) { /* navigateur ancien : tant pis */ }
  $('miniToggle').checked = pref('mini', false);
  $('pianoToggle').checked = pref('piano', false);
  $('logToggle').checked = pref('log', true);
  ['mini', 'piano', 'log'].forEach(k => $(k + 'Toggle').addEventListener('change', e => setPref(k, e.target.checked)));
  $('pianoToggle').addEventListener('change', async e => {
    if (!RT.on) return;
    if (e.target.checked) await startPiano(IOS ? RT.stream : null); else stopPiano();
  });
  $('callBtn').addEventListener('click', () => { if (RT.on) hangUp('Raccroché.'); else call(); });
  $('cutBtn').addEventListener('click', cut);
  window.addEventListener('error', e => LOG.ev('js_error', { msg: String(e.message || e).slice(0, 200), src: String(e.filename || '').split('/').pop(), line: e.lineno || null }));
  $('composer').addEventListener('submit', e => { e.preventDefault(); const v = $('q').value; $('q').value = ''; sendText(v); });
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
  document.querySelectorAll('[data-say]').forEach(b => b.addEventListener('click', () => { if (RT.on) sendText(b.dataset.say); else status('Appelle d’abord le prof.'); }));
  // un exemple de départ, jouable sans appel
  try {
    const intro = $('introCards');
    const obj = C.buildCard({ titre: 'II-V-I en Do, en shells', mg: '[Dm7]D3+F3+C4:4 [G7]G2+F3+B3:4 [Cmaj7]C3+E3+B3:8', tempo: 80 }, 1);
    CARDS.push(obj);
    intro.appendChild(obj.el);
  } catch (e) { /* pas d'exemple */ }
  if (!window.RTCPeerConnection || !navigator.mediaDevices) {
    $('callBtn').disabled = true;
    status('Ce navigateur ne permet pas l’appel vocal. Essaie Chrome ou Safari récent.');
  }
})();
