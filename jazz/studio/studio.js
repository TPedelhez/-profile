/* Truc Jazz · Studio : discuter de piano jazz avec Claude, dans un artifact claude.ai.
   Claude répond avec le compte de la personne (capacité « sample ») et dispose des outils de la page :
   montrer (portée + clavier + son), jouer (faire entendre une note, une résolution, des étapes),
   voicings, trucs, et ecouter (ce que le Labo d'écoute a reconnu au piano, relu par le connecteur
   Vercel : l'artifact n'a pas de micro). Les cartes viennent de cards.js (window.TJCards). */
(function () {
  'use strict';

  const TJ = window.TJ;
  const AU = window.TJAudio;
  const C = window.TJCards;
  const { buildCard, cardSummary, play, stop } = C;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pref = (k, d) => { try { const v = localStorage.getItem('tj-studio:' + k); return v == null ? d : v === '1'; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('tj-studio:' + k, v ? '1' : '0'); } catch (e) { /* rien */ } };

  // ---------- Exemples à l'écran, numérotés pour toute la conversation ----------
  let CARDS = [];
  let currentMsg = null; // message de Claude en cours
  let lastText = ''; // texte de sa réponse en cours (pour la voix)
  // Chaque exemple se place dans le texte, à l'endroit où Claude l'a appelé (pos = longueur du texte à ce moment-là)
  function addCard(spec, m, pos) {
    const obj = spec.geste ? buildCard(spec, 0, { geste: true }) : buildCard(spec, CARDS.length + 1); // erreur lisible si la notation est fausse
    if (!spec.geste) CARDS.push(obj);
    if (m) {
      const last = m.blocks[m.blocks.length - 1];
      last.after(obj.el);
      const next = document.createElement('div');
      next.className = 'bubble';
      obj.el.after(next);
      m.blocks.push(next);
      m.at.push(pos != null ? pos : m.text.length);
      m.cards.push(spec);
      m.setText(m.text);
    }
    return obj;
  }

  // ---------- Parler, puis jouer, puis reprendre : une seule file ----------
  // La voix lit d'abord ce qu'il a écrit jusque-là, puis l'exemple joue ; Claude continue quand c'est fini.
  let SEQ = Promise.resolve();
  const ttsIdle = () => new Promise(res => {
    const t0 = Date.now();
    const f = () => (!VOICE.ok || !speechSynthesis.speaking || Date.now() - t0 > 25000 ? res() : setTimeout(f, 120));
    setTimeout(f, 150);
  });
  function perform(obj, run, signal) {
    const p = SEQ.then(async () => {
      if (signal && signal.aborted) return;
      if ($('speak').checked && VOICE.ok) { VOICE.feed(lastText, true); await ttsIdle(); }
      if (signal && signal.aborted) return;
      const k = obj.el.querySelector('.dockk') || obj.el;
      k.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await new Promise(done => run(() => done()));
    });
    SEQ = p.catch(() => {});
    return p;
  }

  // ---------- Piano : ce que le Labo d'écoute a reconnu ----------
  const PONT_URL = 'https://truc-jazz.vercel.app/api/pont';
  const PIANO = { mcp: null, last: null };
  const NAMES = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
  const nameOct = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const pianoCode = () => { try { return localStorage.getItem('tj-studio:code') || ''; } catch (e) { return ''; } };
  function pianoError(code) {
    return {
      access_code: 'code d’accès refusé', site: 'le site ne répond pas', no_mcp: 'connecteur Vercel indisponible ici',
      server_not_connected: 'ajoute le connecteur Vercel dans les réglages de claude.ai', needs_reauth: 'reconnecte le connecteur Vercel dans les réglages de claude.ai',
      not_in_manifest: 'tu n’as pas autorisé le connecteur Vercel pour cette page', approval_required: 'autorisation du connecteur Vercel nécessaire',
      blocked_by_policy: 'connecteur Vercel bloqué par ton organisation', selection_required: 'choisis quel connecteur Vercel utiliser',
    }[code] || 'le Labo est injoignable pour l’instant';
  }
  async function pianoRead(secondes, signal) {
    if (!PIANO.mcp) throw Object.assign(new Error('no_mcp'), { code: 'no_mcp' });
    if (!pianoCode()) throw Object.assign(new Error('access_code'), { code: 'access_code' });
    const url = `${PONT_URL}?code=${encodeURIComponent(pianoCode())}&secondes=${Math.round(secondes || 30)}`;
    const r = await PIANO.mcp.callTool('Vercel', 'web_fetch_vercel_url', { url }, { cache: false, signal });
    let p = r && r.payload;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = {}; } }
    p = p || {};
    if (p.status === 401) throw Object.assign(new Error('access_code'), { code: 'access_code' });
    if (p.status !== 200 || typeof p.text !== 'string') throw Object.assign(new Error('site'), { code: 'site' });
    const d = JSON.parse(p.text);
    PIANO.last = d;
    return d;
  }
  const pianoLines = d => (d.journal || []).map(e => `il y a ${String(e.il_y_a_s).replace('.', ',')} s : ${e.notes.map(nameOct).join(' ')}${e.accord ? ' → ' + TJ.fmtSymbol(e.accord) : ''}`);
  function pianoContext(d) {
    if (d.labo !== 'écoute') return '[Piano : le Labo d’écoute n’écoute pas en ce moment (page fermée ou micro coupé).]';
    const l = pianoLines(d);
    return l.length ? '[Piano — ce que le Labo a reconnu ces 30 dernières secondes, du plus récent au plus ancien (reconnaissance automatique, peut se tromper) :\n' + l.join('\n') + ']'
      : '[Piano : rien de reconnu ces 30 dernières secondes.]';
  }
  function pianoChip(d) {
    if (d.labo !== 'écoute') return 'Labo pas à l’écoute';
    const j = d.journal || [];
    if (!j.length) return 'rien joué ces 30 s';
    return j.slice(0, 4).reverse().map(e => (e.accord ? TJ.fmtSymbol(e.accord) : e.notes.map(nameOct).join(' '))).join(' → ') + ` (il y a ${Math.round(j[0].il_y_a_s)} s)`;
  }
  function pianoInfo(s) { $('pianoInfo').textContent = s || ''; }
  async function pianoCheck() {
    if (!$('piano').checked) { pianoInfo(''); return; }
    if (!pianoCode()) { $('codeRow').hidden = false; pianoInfo('Tape le code d’accès du site Truc Jazz.'); return; }
    pianoInfo('Je cherche le Labo…');
    try {
      const d = await pianoRead(60);
      pianoInfo(d.labo === 'écoute' ? `Labo à l’écoute${d.journal.length ? ' · dernier accord il y a ' + Math.round(d.journal[0].il_y_a_s) + ' s' : ''}.` : 'Le Labo n’écoute pas : ouvre-le, active le micro et coche « Envoyer au studio Claude ».');
    } catch (e) {
      if (e.code === 'access_code') { $('codeRow').hidden = false; pianoInfo('Code refusé : retape-le.'); return; }
      pianoInfo('Piano indisponible : ' + pianoError(e.code) + '.');
    }
  }

  // ---------- Outils pour Claude ----------
  async function toolMontrer(input, ctx) {
    const spec = C.specFromInput(input);
    const obj = addCard(spec, currentMsg);
    const out = cardSummary(obj) + '. Affiché avec la partition et le clavier ; l’élève peut l’écouter.';
    if (!input.jouer) return out;
    await perform(obj, done => C.play(obj, { onEnd: done }), ctx && ctx.signal);
    return out + ' Joué en entier.';
  }
  async function toolJouer(input, ctx) {
    const signal = ctx && ctx.signal;
    if (input.exemple != null) {
      const obj = CARDS[Math.round(Number(input.exemple)) - 1];
      if (!obj) throw new Error(`Pas d’exemple n° ${input.exemple}. Exemples à l’écran : ${CARDS.length ? '1 à ' + CARDS.length : 'aucun'}.`);
      const et = (Array.isArray(input.etapes) ? input.etapes : input.etapes != null ? [input.etapes] : []).map(x => Math.round(Number(x)) - 1);
      if (et.some(i => !(i >= 0 && i < obj.steps.length))) throw new Error(`L’exemple ${obj.n} a ${obj.steps.length} étapes (1 à ${obj.steps.length}).`);
      if (input.egrener) {
        const list = et.length ? et : obj.steps.map((x, i) => i);
        await perform(obj, done => C.playArp(obj, list, { onEnd: done }), signal);
        return `Joué, exemple ${obj.n} : pour chaque étape, ses notes une par une de la plus grave à la plus aiguë, puis plaquées — ${list.map(i => C.stepText(obj.steps[i], i)).join(' ; ')}.`;
      }
      if (!et.length) {
        await perform(obj, done => C.play(obj, { onEnd: done }), signal);
        return `Exemple ${obj.n} joué en entier.`;
      }
      const i = Math.min.apply(null, et);
      const j = Math.max.apply(null, et);
      const part = obj.steps.slice(i, j + 1);
      const moves = part.slice(1).map((s, k) => C.motion(part[k], s)).filter(Boolean);
      await perform(obj, done => C.playSteps(obj, i, j, { onEnd: done }), signal);
      return `Exemple ${obj.n}, joué de l’étape ${i + 1} à ${j + 1} : ${part.map((s, k) => C.stepText(s, i + k)).join(' ; ')}${moves.length ? '. Mouvement des voix : ' + moves.join(' | ') : ''}.`;
    }
    if (!input.notes) throw new Error('Donne notes (ex. « [G7]F4:1 [Cmaj7]E4:2 ») ou exemple + etapes.');
    let accord = '';
    if (input.accord) { const r = TJ.parseUserChord(String(input.accord)); if (r && !r.error) accord = r.display; }
    const spec = { geste: true, titre: input.titre ? String(input.titre).slice(0, 80) : '', tempo: Math.max(40, Math.min(200, Number(input.tempo) || 80)), accord, partition: !!input.partition };
    spec[input.main === 'mg' ? 'mg' : 'md'] = String(input.notes);
    const obj = addCard(spec, currentMsg);
    await perform(obj, done => C.play(obj, { onEnd: done }), signal);
    return C.cardSummary(obj) + '. Joué.';
  }
  async function toolEcouter(input, ctx) {
    const d = await pianoRead(Number(input.secondes) || 30, ctx && ctx.signal).catch(e => { throw new Error('Piano indisponible : ' + pianoError(e.code)); });
    if (d.labo !== 'écoute') return 'Le Labo d’écoute n’écoute pas en ce moment : propose à l’élève de l’ouvrir et d’activer le micro.';
    const l = pianoLines(d);
    return l.length ? { joue: l } : { joue: [], note: 'Rien de reconnu dans cette fenêtre.' };
  }
  const JOUER = {
    description: 'Joue au clavier de la page, comme un prof qui fait entendre ce qu’il explique : (1) notes = quelques notes en notation Truc Jazz (« F3 » ; « [G7]F4:1 [Cmaj7]E4:2 » pour la septième qui descend sur la tierce ; « [Dm7]D3+F3+C4:2 [G7]G2+F3+B3:2 ») : un petit clavier apparaît et s’allume au fur et à mesure ; (2) exemple = numéro d’un exemple affiché, etapes = numéros de ses cases d’accords à rejouer (ex. [2, 3]), egrener = true pour les notes une par une puis ensemble. Rend la main quand c’est fini de jouer, avec ce qui a sonné et le mouvement des voix.',
    inputSchema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'Notation Truc Jazz : « + » ensemble, espace = l’une après l’autre, « :2 » durée en temps, [G7] = accord pour les degrés' },
        accord: { type: 'string', description: 'Accord de référence pour les degrés (ex. G7)' },
        titre: { type: 'string', description: 'Légende courte' },
        main: { type: 'string', enum: ['md', 'mg'] },
        partition: { type: 'boolean', description: 'Afficher aussi la portée' },
        exemple: { type: 'number' },
        etapes: { type: 'array', items: { type: 'number' } },
        egrener: { type: 'boolean' },
        tempo: { type: 'number' },
      },
    },
  };
  // par ordre d'importance, si la plateforme limite le nombre d'outils
  const ALL_TOOLS = [
    { name: 'montrer', description: C.SCHEMAS.montrer.description, inputSchema: C.SCHEMAS.montrer.parameters, execute: toolMontrer },
    { name: 'jouer', description: JOUER.description, inputSchema: JOUER.inputSchema, execute: toolJouer },
    { name: 'voicings', description: C.SCHEMAS.voicings.description, inputSchema: C.SCHEMAS.voicings.parameters, execute: C.voicings },
    { name: 'ecouter', description: 'Relit ce que l’élève vient de jouer au piano, reconnu au micro par le Labo d’écoute (accords et notes, il y a combien de secondes). Ses messages le contiennent déjà quand le piano est branché : n’appelle cet outil que pour regarder une autre fenêtre ou après lui avoir demandé de jouer.', inputSchema: { type: 'object', properties: { secondes: { type: 'number' } } }, execute: toolEcouter },
    { name: 'trucs', description: C.SCHEMAS.trucs.description, inputSchema: C.SCHEMAS.trucs.parameters, execute: C.trucs },
  ];
  let TOOLS = ALL_TOOLS;

  const RULES = `Tu es le prof de piano jazz du « Studio Truc Jazz ». Tu discutes avec un élève qui apprend le jazz sur le moment, par petits trucs, sans programme, les mains sur son piano. Tu tutoies, en français, ton chaleureux et concret, phrases courtes, comme une vraie conversation.

Règle d'or : dès que tu cites des notes ou un accord, appelle « montrer » pour l'afficher (partition + clavier + son), puis parles-en en le citant (« l'exemple 2 »). Pour les notes d'un voicing, appelle d'abord « voicings ». Pour un truc de la bibliothèque, « trucs ».

Tu as aussi les mains sur le clavier de la page : avec « jouer », fais entendre chaque détail comme un prof assis au piano (une note, un intervalle, la septième qui descend sur la tierce, une note de passage, un accord égrené, les étapes 2 et 3 d'un exemple). Le son part au moment où tu appelles l'outil, au milieu de ta réponse : écris d'abord la phrase qui annonce (« Écoute la septième : »), appelle « jouer », puis commente ce qui a sonné. Préfère deux ou trois petits gestes joués à un long discours. Pour une résolution, écris des voix proches (chaque note bouge d'un ton au plus) et ne décris que ce que les outils disent avoir joué ; corrige-toi si un outil signale un saut.

Quand le piano de l'élève est branché, ses messages se terminent par un bloc [Piano — …] : les accords que le Labo d'écoute a reconnus au micro juste avant. Sers-t'en pour commenter ce qu'il a joué (« ton sol sept était juste »), avec prudence : c'est une reconnaissance automatique, une basse peut manquer ou une harmonique être prise pour une note.

${C.NOTATION}

Dans ton texte : noms de notes en Do Ré Mi (ré, fa, si bémol), symboles d'accords en lettres (Dm7, G7). Réponses courtes (60 à 150 mots) sauf si l'élève demande plus. Pas de titres. Finis souvent par une petite chose à essayer tout de suite au piano.`;

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
    const out = SPOKEN_ROOT[m[1]] + (m[2] ? (/b|♭/.test(m[2]) ? ' bémol' : ' dièse') : '');
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
    // lit chaque phrase dès qu'elle est complète (final : tout ce qui reste)
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
  let turns = []; // {role, text, cards:[spec], piano?, chip?}
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
  function msgEl(role, text, cards, chip, at) {
    const wrap = document.createElement('article');
    wrap.className = 'msg ' + (role === 'user' ? 'me' : 'prof');
    wrap.innerHTML = `<div class="bubble">${role === 'user' ? `<p>${esc(text)}</p>` : ''}</div>${chip ? `<p class="chip">🎹 ${esc(chip)}</p>` : ''}`;
    const m = { el: wrap, textEl: wrap.querySelector('.bubble'), blocks: [wrap.querySelector('.bubble')], at: [], cards: [], text: '' };
    // le texte est découpé autour des exemples : bloc 0, exemple 1, bloc 1, exemple 2…
    m.setText = t => {
      m.text = t || '';
      m.blocks.forEach((b, i) => {
        const part = m.text.slice(i ? m.at[i - 1] : 0, i < m.at.length ? m.at[i] : m.text.length);
        b.innerHTML = part.trim() ? md(part) : '';
      });
    };
    if (role !== 'user') {
      m.text = text || '';
      (cards || []).forEach((spec, i) => { try { addCard(spec, m, at && at[i] != null ? at[i] : (text || '').length); } catch (e) { /* carte illisible */ } });
      m.setText(text || '');
    }
    $('thread').appendChild(wrap);
    return m;
  }
  function scrollDown() { const t = $('thread'); const last = t.lastElementChild; if (last) last.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
  function setStatus(s) { $('status').textContent = s || ''; }

  // Ce que Claude relit des échanges passés (il ne garde rien entre deux appels)
  function history() {
    const all = [{ role: 'assistant', text: INTRO_TEXT, cards: [] }].concat(turns);
    let n = 0;
    const h = all.map(t => {
      const listed = (t.cards || []).map(c => c.geste
        ? `au clavier : ${c.md || c.mg}`
        : `${++n}. ${c.titre} — ${['md', 'mg', 'basse'].filter(k => c[k]).map(k => `${k}: ${c[k]}`).join(' ; ')}`);
      if (t.role === 'user') return { role: 'user', content: (t.text || '…') + (t.piano ? '\n\n' + t.piano : '') };
      return { role: 'assistant', content: (t.text || '(exemples)') + (listed.length ? '\n\n[Affiché et joué dans ce message : ' + listed.join(' | ') + ']' : '') };
    });
    let recent = [h[0]].concat(h.slice(1).slice(-16));
    while (recent.length > 1 && recent[1].role !== 'user') recent.splice(1, 1);
    const rules = tools ? RULES : RULES + '\n\nIci tu n’as pas d’outils : pour chaque exemple, écris un bloc ```exemple {"titre": "…", "mg": "…", "md": "…", "tempo": 100}``` (JSON valide, notation Truc Jazz). La page l’affiche avec partition, clavier et son.';
    return [{ role: 'user', content: rules }].concat(recent);
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
    SEQ = Promise.resolve();
    if ($('speak').checked) VOICE.unlock();
    $('ideas').hidden = true;
    const ctl = new AbortController();
    busy = ctl;
    $('sendBtn').hidden = true;
    $('stopBtn').hidden = false;
    const turn = { role: 'user', text };
    // le piano d'abord : ce que le Labo vient d'entendre part avec la question
    if ($('piano').checked && PIANO.mcp) {
      setStatus('Je regarde ce que tu viens de jouer…');
      try {
        const d = await pianoRead(30, ctl.signal);
        turn.piano = pianoContext(d);
        turn.chip = pianoChip(d);
      } catch (e) {
        turn.chip = 'piano indisponible : ' + pianoError(e.code);
      }
    }
    turns.push(turn);
    save();
    msgEl('user', text, null, turn.chip);
    const m = msgEl('assistant', '');
    m.textEl.innerHTML = '<p class="thinking">Claude réfléchit…</p>';
    currentMsg = m;
    lastText = '';
    scrollDown();
    setStatus('');
    let finalText = '';
    try {
      const opts = { signal: ctl.signal, onText: ({ text: t }) => { finalText = t; lastText = t; m.setText(t); VOICE.feed(t, false); } };
      if (tools) opts.tools = TOOLS; else opts.cache = false;
      // rapide par défaut : environ une seconde par aller-retour d'outil (le niveau « default » réfléchit 30 à 90 s)
      opts.modelTier = $('deep').checked ? 'default' : 'quick';
      const r = await sample(history(), opts);
      finalText = r.text;
      lastText = r.text;
      m.setText(r.text);
      await SEQ; // la voix reprend après le dernier exemple joué
      VOICE.feed(r.text, true);
      if (r.truncated) setStatus('Réponse coupée : demande-lui la suite.');
      if (!tools) parseFallbackCards(m, r.text);
    } catch (e) {
      const keep = e && e.text;
      finalText = keep || '';
      m.setText(keep || '');
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
      if (finalText || m.cards.length) { turns.push({ role: 'assistant', text: finalText, cards: m.cards, at: m.at }); save(); }
    }
  }
  // Sans outils de page : Claude écrit ses exemples dans des blocs ```exemple {json}```
  function parseFallbackCards(m, text) {
    const re = /```exemple\s*([\s\S]*?)```/g;
    let x;
    while ((x = re.exec(text))) {
      try { addCard(JSON.parse(x[1]), m, text.replace(re, '').length); } catch (e) { /* bloc illisible */ }
    }
    m.setText(text.replace(re, ''));
  }

  // ---------- Démarrage ----------
  const INTRO_TEXT = 'Salut ! Pose-moi une question de piano jazz, par écrit ou en dictée. Je te montre les notes et je te les fais entendre.';
  function renderAll() {
    $('thread').innerHTML = '';
    CARDS = [];
    const m = msgEl('assistant', INTRO_TEXT);
    m.el.classList.add('intro');
    turns.forEach(t => msgEl(t.role, t.text, t.cards, t.chip, t.at));
    $('ideas').hidden = turns.length > 0;
    requestAnimationFrame(scrollDown);
  }
  function wire() {
    $('composer').addEventListener('submit', e => { e.preventDefault(); const v = $('q').value; $('q').value = ''; autosize(); send(v); });
    $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
    $('q').addEventListener('input', autosize);
    $('stopBtn').addEventListener('click', () => { if (busy) busy.abort(); stop(); VOICE.reset(); });
    // préférences gardées sur cet appareil
    ['deep', 'speak', 'piano'].forEach(id => {
      $(id).checked = pref(id, $(id).checked);
      $(id).addEventListener('change', () => { setPref(id, $(id).checked); if (id === 'speak' && !$(id).checked) VOICE.reset(); });
    });
    $('piano').addEventListener('change', pianoCheck);
    $('codeOk').addEventListener('click', () => {
      const v = $('codeIn').value.trim();
      if (!v) return;
      try { localStorage.setItem('tj-studio:code', v); } catch (e) { /* rien */ }
      $('codeIn').value = '';
      $('codeRow').hidden = true;
      pianoCheck();
    });
    if (!VOICE.ok) $('speakLbl').hidden = true;
    $('newBtn').addEventListener('click', () => { if (busy) busy.abort(); stop(); VOICE.reset(); turns = []; save(); renderAll(); setStatus(''); });
    // le menu se ferme quand on touche ailleurs
    document.addEventListener('click', e => { const mnu = $('menu'); if (mnu && mnu.open && !mnu.contains(e.target)) mnu.open = false; });
    document.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => { $('q').value = b.dataset.ask; send(b.dataset.ask); $('q').value = ''; }));
  }
  function autosize() { const q = $('q'); q.style.height = 'auto'; q.style.height = Math.min(160, q.scrollHeight) + 'px'; }

  renderAll();
  wire();
  (async () => {
    const use = window.claude && window.claude.use ? window.claude.use.bind(window.claude) : null;
    const [s, mcp] = use ? await Promise.all([use('sample'), use('mcp')]) : [null, null];
    sample = s;
    PIANO.mcp = mcp;
    if (!mcp) { $('pianoLbl').hidden = true; } else if ($('piano').checked && pianoCode()) {
      pianoInfo('Piano branché (via le Labo d’écoute).');
    }
    if (!sample) {
      $('q').disabled = true;
      $('sendBtn').disabled = true;
      setStatus('Ouvre ce studio dans Claude pour discuter : il utilise ton compte Claude. Les exemples restent jouables.');
      return;
    }
    try {
      const lim = await sample.limits();
      const max = lim && lim.tools ? lim.tools.maxCount || ALL_TOOLS.length : 0;
      TOOLS = ALL_TOOLS.filter(t => t.name !== 'ecouter' || PIANO.mcp).slice(0, max);
      tools = TOOLS.length > 0;
    } catch (e) { tools = false; }
    $('q').disabled = false;
    $('sendBtn').disabled = false;
  })();
})();
