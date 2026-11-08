// Truc Jazz · analyse des sessions enregistrées par la boîte noire.
//
//   ACCESS_CODE=… node jazz/tools/analyse-sessions.mjs              → bilan de toutes les sessions
//   ACCESS_CODE=… node jazz/tools/analyse-sessions.mjs <session>    → bilan d'une session
//   … --replay                                                      → rejoue aussi les extraits sonores
//                                                                     dans le détecteur actuel
// Variables : ACCESS_CODE (obligatoire), BASE_URL (défaut https://truc-jazz.vercel.app)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const BASE = process.env.BASE_URL || 'https://truc-jazz.vercel.app';
const CODE = process.env.ACCESS_CODE;
if (!CODE) { console.error('Il faut ACCESS_CODE=… dans l’environnement.'); process.exit(1); }
const args = process.argv.slice(2);
const replay = args.includes('--replay');
const only = args.find(a => !a.startsWith('--'));
const headers = { 'x-access-code': CODE };

const NAMES = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
const nm = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const pc = p => NAMES[p];
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p90 = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(0.9 * (s.length - 1))] : null; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) + ' %' : '–');

async function getJson(path) {
  const r = await fetch(BASE + path, { headers });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

// Détecteur de l'app, chargé tel quel
function loadDetector() {
  const here = dirname(fileURLToPath(import.meta.url));
  const ctx = { console, Math, Float32Array, Float64Array, Uint32Array, Map, Set, Array, Number, Object, JSON };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(here, '../ecoute/detector.js'), 'utf8'), ctx);
  return ctx.TJDetector;
}
function parseWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sr = v.getUint32(24, true);
  const n = (buf.byteLength - 44) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(44 + i * 2, true) / 32768;
  return { sr, samples: out };
}
function replayClip(D, wav, target, a4) {
  const det = new D.Detector(wav.sr, { a4: a4 || 440 });
  const frames = [];
  for (let i = 0; i < wav.samples.length; i += 128) {
    const blk = wav.samples.subarray(i, i + 128);
    frames.push(...det.push(blk, (i + blk.length) / wav.sr));
  }
  // l'attaque est à ~1 s dans l'extrait
  const on = frames.find(f => f.onset && f.t > 0.85 && f.t < 1.3) || frames.find(f => f.t >= 1.0);
  const i0 = frames.indexOf(on);
  const pre = i0 > 0 ? det.snapshot(frames[i0 - 1]) : null;
  const m = det.matcher(target, pre, on.t);
  let streak = 0;
  let okAt = null;
  let last = null;
  for (const f of frames.slice(i0)) {
    if (f.t - on.t > 0.7) break;
    last = m.update(f);
    streak = last.ok ? streak + 1 : 0;
    if (streak >= 2 && okAt == null) okAt = f.t - on.t;
  }
  const at = frames.find(f => f.t >= on.t + 0.15) || on;
  return { ok: okAt != null, ms: okAt != null ? Math.round(okAt * 1000) : null, last, heard: at.notes.map(n => nm(n.midi) + ':' + n.s.toFixed(0)), onsetDetected: !!on.onset };
}

function report(s) {
  const ev = s.events;
  const by = t => ev.filter(e => e.type === t);
  const start = by('session_start')[0] || {};
  const mic = by('mic_start')[0];
  console.log(`\n══ Session ${s.session} · ${ev.length} événements · ${s.clips.length} extraits sonores`);
  if (start.ua) console.log(`Appareil : ${start.ua}`);
  if (mic) console.log(`Micro : ${mic.sr} Hz · traitements coupés : ${mic.off} · latences annoncées : tampon ${Math.round((mic.baseLatency || 0) * 1000)} ms, sortie ${Math.round((mic.outputLatency || 0) * 1000)} ms`);
  const lt = by('latency_test').pop();
  if (lt) console.log(`Test de latence : aller-retour médian ${med(lt.deltas)} ms (${lt.heard}/${lt.clicks} clics entendus)`);
  const tune = by('tune').pop();
  if (tune) console.log(`Accordage détecté : La = ${tune.a4} Hz`);
  const cpu = by('cpu').map(e => e.load);
  if (cpu.length) console.log(`Calcul : ${Math.round(100 * med(cpu))} % du temps réel en médiane, analyse toutes les ${by('cpu').pop().hop} échantillons`);

  const ok = by('shape_ok');
  const ko = by('shape_fail');
  if (ok.length + ko.length) {
    console.log(`\nFormes : ${ok.length} réussies, ${ko.length} ratées (${pct(ok.length, ok.length + ko.length)} de réussite)`);
    const ms = ok.map(e => e.ms);
    console.log(`Délai de reconnaissance : médiane ${med(ms)} ms, 90 % sous ${p90(ms)} ms`);
    const per = new Map();
    for (const e of ok.concat(ko)) {
      const k = `${e.sym} (${e.notes.map(nm).join(' ')})`;
      const r = per.get(k) || { ok: 0, ko: 0, missing: {}, extra: {} };
      if (e.type === 'shape_ok') r.ok++; else {
        r.ko++;
        (e.missing || []).forEach(p => { r.missing[pc(p)] = (r.missing[pc(p)] || 0) + 1; });
        (e.extra || []).forEach(m => { r.extra[nm(m)] = (r.extra[nm(m)] || 0) + 1; });
      }
      per.set(k, r);
    }
    console.log('Par forme (réussies / ratées · notes manquantes · notes en trop) :');
    [...per.entries()].sort((a, b) => b[1].ko - a[1].ko).forEach(([k, r]) => {
      const mi = Object.entries(r.missing).map(([n, c]) => `${n}×${c}`).join(' ');
      const ex = Object.entries(r.extra).map(([n, c]) => `${n}×${c}`).join(' ');
      console.log(`  ${k} : ${r.ok}/${r.ko}${mi ? ' · manque ' + mi : ''}${ex ? ' · en trop ' + ex : ''}`);
    });
  }
  const heard = by('heard');
  if (heard.length) console.log(`\nAccords entendus (journal) : ${heard.length}, dont ${heard.filter(h => h.chord).length} nommés`);

  const asks = by('prof_ask');
  const answers = by('prof_answer');
  if (asks.length) {
    console.log(`\nProf (écrit / voix du navigateur) : ${asks.length} questions, ${answers.length} réponses, ${by('prof_error').length} erreurs`);
    const tx = answers.map(a => a.textMs).filter(x => x != null);
    const vx = answers.map(a => a.voiceMs).filter(x => x != null);
    if (tx.length) console.log(`  premier mot en ${med(tx)} ms (médiane)${vx.length ? `, voix en ${med(vx)} ms` : ''}`);
    asks.forEach((q, i) => { const a = answers[i]; console.log(`  » ${q.q}\n    ${a ? (a.provider || '?') + ' : ' + a.a.replace(/\s+/g, ' ').slice(0, 240) : '(pas de réponse)'}`); });
  }
  const ve = by('voice_error');
  if (ve.length) console.log(`  erreurs de reconnaissance vocale : ${ve.map(e => e.error).join(', ')}`);

  const rtc = by('rt_connected');
  if (rtc.length) {
    const lat = by('rt_latency').map(e => e.ms);
    console.log(`\nProf ChatGPT temps réel : ${rtc.length} appel(s), ${by('rt_speech_start').length} prises de parole détectées, ${by('rt_answer').length} réponses`);
    if (lat.length) console.log(`  délai fin de ta phrase → sa voix : médiane ${med(lat)} ms, 90 % sous ${p90(lat)} ms`);
    by('rt_answer').forEach(a => console.log(`  « ${a.a.replace(/\s+/g, ' ').slice(0, 200)} »`));
    by('rt_error').forEach(e => console.log(`  erreur : ${e.msg}`));
  }
  // Studio vocal : le fil de la conversation, avec les signalements mis en évidence
  const sv = ev.filter(e => e.app === 'studio-vocal');
  if (sv.length) {
    const lat = by('latency').map(e => e.ms);
    console.log(`\nStudio vocal : ${by('said').length} phrases de l'élève, ${by('answer').length} réponses, ${by('tool').length} outils (${by('tool_error').length} en erreur), ${by('ghost').length} fantômes écartés, ${by('cut').length} coupures, ${by('feedback').length} signalements`);
    if (lat.length) console.log(`  délai fin de ta phrase → sa voix : médiane ${med(lat)} ms, 90 % sous ${p90(lat)} ms`);
    const line = e => {
      const t = (e.t / 1000).toFixed(1).padStart(6) + ' s ';
      if (e.type === 'said') return t + `élève   « ${e.q} »`;
      if (e.type === 'typed') return t + `écrit   « ${e.q} »`;
      if (e.type === 'answer') return t + `prof    « ${e.a.replace(/\s+/g, ' ').slice(0, 220)} »`;
      if (e.type === 'tool') return t + `outil   ${e.name} ${e.args}`.slice(0, 260);
      if (e.type === 'tool_error') return t + `OUTIL EN ERREUR ${e.name} : ${e.msg}`;
      if (e.type === 'ghost') return t + `fantôme écarté « ${e.q} »`;
      if (e.type === 'feedback') return t + `★ SIGNALÉ (${e.by}) : ${e.note || '(sans texte)'}${e.screen ? ' · écran : ' + e.screen : ''}`;
      if (e.type === 'rt_error' || e.type === 'js_error') return t + `ERREUR ${e.msg}${e.src ? ' (' + e.src + ':' + e.line + ')' : ''}`;
      return t + e.type + (e.ms != null ? ' ' + e.ms + ' ms' : '') + (e.model ? ' ' + e.model : '') + (e.msg ? ' ' + e.msg : '');
    };
    sv.filter(e => !['latency', 'buf_events'].includes(e.type)).forEach(e => console.log('  ' + line(e)));
  }
  const js = by('js_error');
  if (js.length) console.log(`\nErreurs JavaScript : ${js.map(e => `${e.msg} (${e.src}:${e.line})`).join(' | ')}`);
}

async function replayAll(s) {
  const D = loadDetector();
  const ev = s.events;
  const shapes = ev.filter(e => e.type === 'shape_ok' || e.type === 'shape_fail');
  const saved = ev.filter(e => e.type === 'clip_saved' && e.pathname);
  if (!saved.length) { console.log('\n(Aucun extrait sonore à rejouer.)'); return; }
  console.log(`\nRejeu des ${saved.length} extraits dans le détecteur actuel :`);
  let fixed = 0;
  let fails = 0;
  for (const c of saved) {
    const shape = shapes.find(e => Math.abs(e.onset - c.onset) < 0.01);
    if (!shape) continue;
    const r = await fetch(`${BASE}/api/sessions?clip=${encodeURIComponent(c.pathname)}`, { headers });
    if (!r.ok) { console.log(`  ${c.label} : extrait introuvable (${r.status})`); continue; }
    const wav = parseWav(new Uint8Array(await r.arrayBuffer()));
    const res = replayClip(D, wav, shape.notes, shape.a4);
    if (shape.type === 'shape_fail') { fails++; if (res.ok) fixed++; }
    const was = shape.type === 'shape_ok' ? 'réussi en direct' : 'raté en direct';
    const now = res.ok ? `reconnu en ${res.ms} ms` : `toujours raté (manque ${res.last.missing.map(pc).join(', ') || '–'}, en trop ${res.last.extra.map(nm).join(', ') || '–'})`;
    console.log(`  ${shape.sym} ${shape.notes.map(nm).join(' ')} · ${was} → ${now} · entendu : ${res.heard.join(' ')}`);
  }
  if (fails) console.log(`  Bilan : ${fixed}/${fails} ratés seraient reconnus par le détecteur actuel.`);
}

const list = await getJson('/api/sessions');
const ids = only ? [only] : list.sessions.map(s => s.session);
if (!ids.length) console.log('Aucune session enregistrée pour l’instant.');
for (const id of ids) {
  const s = await getJson(`/api/sessions?id=${encodeURIComponent(id)}`);
  report(s);
  if (replay) await replayAll(s);
}
