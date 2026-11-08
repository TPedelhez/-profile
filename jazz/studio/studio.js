/* Truc Jazz · Studio : discuter de piano jazz avec Claude, dans un artifact claude.ai.
   Claude répond avec le compte de la personne (capacité « sample ») et dispose de trois outils
   de la page : montrer (portée + clavier + son), voicings (notes exactes d'un accord),
   trucs (bibliothèque Truc Jazz). Les cartes viennent de cards.js (window.TJCards). */
(function () {
  'use strict';

  const TJ = window.TJ;
  const AU = window.TJAudio;
  const C = window.TJCards;
  const { buildCard, cardSummary, play, stop } = C;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Outils pour Claude ----------
  let currentMsg = null; // message assistant en cours
  function toolMontrer(input) {
    const spec = C.specFromInput(input);
    const obj = buildCard(spec, currentMsg ? currentMsg.cards.length + 1 : 1); // lève une erreur lisible si la notation est fausse
    if (currentMsg) { currentMsg.cardsEl.appendChild(obj.el); currentMsg.cards.push(spec); }
    setStatus(`Exemple ${obj.n} affiché`);
    if (input.jouer) setTimeout(() => play(obj), 300);
    return cardSummary(obj) + '. Affiché avec la partition et le clavier ; l’élève peut l’écouter.';
  }
  const TOOLS = [
    { name: 'montrer', description: C.SCHEMAS.montrer.description, inputSchema: C.SCHEMAS.montrer.parameters, execute: toolMontrer },
    { name: 'voicings', description: C.SCHEMAS.voicings.description, inputSchema: C.SCHEMAS.voicings.parameters, execute: C.voicings },
    { name: 'trucs', description: C.SCHEMAS.trucs.description, inputSchema: C.SCHEMAS.trucs.parameters, execute: C.trucs },
  ];

  const RULES = `Tu es le prof de piano jazz du « Studio Truc Jazz ». Tu discutes avec un élève qui apprend le jazz sur le moment, par petits trucs, sans programme. Tu tutoies, en français, ton chaleureux et concret, phrases courtes.

Règle d'or : dès que tu cites des notes ou un accord, même pour une question simple (accord, voicing, gamme, phrase, grille), appelle l'outil « montrer » pour l'afficher (partition + clavier + son), puis parles-en en le citant (« l'exemple 2 »). Un exemple court et juste vaut mieux qu'une longue explication. Pour les notes d'un voicing, appelle d'abord « voicings » : il donne les notes exactes. Pour un truc de la bibliothèque, appelle « trucs ».

${C.NOTATION}

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
    const intro = { role: 'assistant', text: INTRO_TEXT, cards: [DEMO] };
    const h = [intro].concat(turns.slice(-16)).map(t => ({
      role: t.role,
      content: t.role === 'assistant' && t.cards && t.cards.length
        ? (t.text || '(exemples)') + '\n\n[Exemples affichés dans ce message : ' + t.cards.map((c, i) => `${i + 1}. ${c.titre} — ${['md', 'mg', 'basse'].filter(k => c[k]).map(k => `${k}: ${c[k]}`).join(' ; ')}`).join(' | ') + ']'
        : t.text || '…',
    }));
    if (turns.length > 16) while (h.length > 1 && h[1].role !== 'user') h.splice(1, 1);
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
  const INTRO_TEXT = 'Salut ! Pose-moi n’importe quelle question sur le piano jazz. Quand je parle de notes, je te les montre sur la portée et le clavier, et tu peux les écouter. Par exemple, voici le II-V-I, l’enchaînement le plus joué du jazz :';
  const DEMO = {
    titre: 'II-V-I en Do, en shells', mg: '[Dm7]D3+F3+C4:4 [G7]G2+F3+B3:4 [Cmaj7]C3+E3+B3:8', tempo: 80,
    explication: 'Touche un accord pour l’entendre seul, ou Écouter pour l’enchaînement.',
  };
  function renderAll() {
    $('thread').innerHTML = '';
    if (!turns.length) {
      const m = msgEl('assistant', INTRO_TEXT, [DEMO]);
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
