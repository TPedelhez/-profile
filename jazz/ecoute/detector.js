/* Truc Jazz · détecteur de notes au micro (traitement du signal, sans modèle d'IA)
   - Attaques : flux spectral sur une fenêtre courte (1024 échantillons).
   - Hauteurs : spectre 4096 points, pics interpolés, saillance harmonique
     avec inharmonicité du piano, estimation itérative des notes (façon Klapuri)
     et soustraction « lissée » pour garder les octaves doublées.
   - Vérification d'une forme attendue : présence des classes de hauteur visées.
   Fonctionne dans le navigateur et dans Node (tests). Expose globalThis.TJDetector. */
(function (root) {
  'use strict';

  // ---------- FFT radix 2 ----------
  function makeFFT(n) {
    const levels = Math.log2(n);
    if (levels !== Math.floor(levels)) throw new Error('FFT : taille non puissance de 2');
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    // Calcule |X(k)| pour k = 0..n/2 à partir d'un signal réel déjà fenêtré.
    return function magnitudes(input, out) {
      for (let i = 0; i < n; i++) { re[rev[i]] = input[i]; im[rev[i]] = 0; }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = start + j;
            const b = a + half;
            const tr = re[b] * cos[k] - im[b] * sin[k];
            const ti = re[b] * sin[k] + im[b] * cos[k];
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
      for (let k = 0; k <= n / 2; k++) out[k] = Math.hypot(re[k], im[k]);
      return out;
    };
  }

  function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return w;
  }

  const midiFreq = (m, a4) => a4 * Math.pow(2, (m - 69) / 12);
  const mod12 = m => ((m % 12) + 12) % 12;

  class Detector {
    constructor(sampleRate, opts) {
      opts = opts || {};
      this.sr = sampleRate;
      this.hop = opts.hop || 256;
      this.a4 = opts.a4 || 440;
      this.minMidi = opts.minMidi || 33;   // La1
      this.maxMidi = opts.maxMidi || 96;   // Do7
      this.N = 4096;                        // fenêtre des hauteurs
      this.P = 8192;                        // avec zéro-padding pour l'interpolation
      this.NO = 1024;                       // fenêtre des attaques
      this.buf = new Float32Array(this.P);  // tampon circulaire « à plat » (on décale)
      this.fill = 0;
      this.winN = hann(this.N);
      this.winO = hann(this.NO);
      this.fftP = makeFFT(this.P);
      this.fftO = makeFFT(this.NO);
      this.frameP = new Float64Array(this.P);
      this.frameO = new Float64Array(this.NO);
      this.magP = new Float64Array(this.P / 2 + 1);
      this.magO = new Float64Array(this.NO / 2 + 1);
      this.prevO = new Float64Array(this.NO / 2 + 1);
      this.fluxHist = [];
      this.lastOnset = -1;
      this.time = 0;            // temps (s) de la fin du dernier bloc reçu
      this.pending = 0;
      this.onTimes = new Map(); // midi -> nombre de trames consécutives
      this.active = new Set();
      this.level = 0;
      this.B = 0.0002;          // inharmonicité moyenne
      this.tol = 0.022;         // tolérance en fréquence relative (~38 cents)
    }

    // Ajoute des échantillons. tEnd = temps (s) de la fin de ce bloc (horloge audio).
    // Renvoie la liste des trames analysées : [{t, onset, notes, level}]
    push(samples, tEnd) {
      const out = [];
      let i = 0;
      const n = samples.length;
      while (i < n) {
        const take = Math.min(this.hop - this.pending, n - i);
        // décale le tampon et ajoute
        this.buf.copyWithin(0, take);
        this.buf.set(samples.subarray(i, i + take), this.P - take);
        this.fill = Math.min(this.P, this.fill + take);
        this.pending += take;
        i += take;
        if (this.pending >= this.hop) {
          this.pending = 0;
          const t = tEnd - (n - i) / this.sr;
          out.push(this.analyze(t));
        }
      }
      this.time = tEnd;
      return out;
    }

    analyze(t) {
      const P = this.P;
      const N = this.N;
      const NO = this.NO;
      const buf = this.buf;
      // Niveau (RMS des 1024 derniers échantillons)
      let rms = 0;
      for (let i = P - NO; i < P; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / NO);
      this.level = rms;

      // ---- Attaque : flux spectral sur 1024 points ----
      for (let i = 0; i < NO; i++) this.frameO[i] = buf[P - NO + i] * this.winO[i];
      this.fftO(this.frameO, this.magO);
      let flux = 0;
      const kMax = Math.min(this.magO.length, Math.floor(5000 / (this.sr / NO)));
      for (let k = 2; k < kMax; k++) {
        const c = Math.log(1 + 1000 * this.magO[k]);
        const d = c - this.prevO[k];
        if (d > 0) flux += d;
        this.prevO[k] = c;
      }
      const hist = this.fluxHist;
      let mean = 0;
      for (const f of hist) mean += f;
      mean = hist.length ? mean / hist.length : 0;
      hist.push(flux);
      if (hist.length > 40) hist.shift();
      const onset = rms > 0.002 && flux > mean * 1.8 + 4 && (this.lastOnset < 0 || t - this.lastOnset > 0.07);
      if (onset) this.lastOnset = t;

      // ---- Hauteurs : 4096 points + zéro-padding ----
      for (let i = 0; i < N; i++) this.frameP[i] = buf[P - N + i] * this.winN[i];
      for (let i = N; i < P; i++) this.frameP[i] = 0;
      this.fftP(this.frameP, this.magP);
      const peaks = rms > 0.0015 ? this.peaks() : [];
      const notes = peaks.length ? this.estimate(peaks) : [];

      // Lissage temporel : une note s'allume après 2 trames, s'éteint après 4 trames d'absence.
      const seen = new Set(notes.map(x => x.midi));
      for (const m of seen) this.onTimes.set(m, (this.onTimes.get(m) > 0 ? this.onTimes.get(m) : 0) + 1);
      for (const [m, c] of this.onTimes) {
        if (!seen.has(m)) this.onTimes.set(m, c > 0 ? -1 : c - 1);
        const v = this.onTimes.get(m);
        if (v >= 2) this.active.add(m);
        if (v <= -4) { this.active.delete(m); this.onTimes.delete(m); }
      }
      return { t, onset, flux, level: rms, notes, active: Array.from(this.active).sort((a, b) => a - b), peaks };
    }

    // Pics du spectre. Amplitude = rapport au plancher de bruit local (en « bits » : 1 = 6 dB).
    peaks() {
      const mag = this.magP;
      const binHz = this.sr / this.P;
      const kLo = Math.max(2, Math.floor(midiFreq(this.minMidi, this.a4) * 0.9 / binHz));
      const kHi = Math.min(mag.length - 2, Math.floor(6000 / binHz));
      // Plancher : 20e centile par bande de 32 bins, interpolé.
      const band = 32;
      const nb = Math.ceil((kHi - kLo + 1) / band);
      const fl = new Float64Array(nb);
      const tmp = new Float64Array(band);
      for (let b = 0; b < nb; b++) {
        let c = 0;
        for (let k = kLo + b * band; k < Math.min(kHi + 1, kLo + (b + 1) * band); k++) tmp[c++] = mag[k];
        const arr = Array.prototype.slice.call(tmp, 0, c).sort((x, y) => x - y);
        fl[b] = Math.max(1e-9, arr[Math.floor(c * 0.2)]);
      }
      const floorAt = k => {
        const x = (k - kLo) / band - 0.5;
        const i = Math.max(0, Math.min(nb - 1, Math.floor(x)));
        const j = Math.min(nb - 1, i + 1);
        const w = Math.max(0, Math.min(1, x - i));
        return fl[i] * (1 - w) + fl[j] * w;
      };
      let maxMag = 0;
      for (let k = kLo; k <= kHi; k++) if (mag[k] > maxMag) maxMag = mag[k];
      const out = [];
      for (let k = kLo + 1; k < kHi; k++) {
        const m = mag[k];
        if (m <= mag[k - 1] || m < mag[k + 1]) continue;
        const floor = floorAt(k);
        if (m < floor * 2.5 || m < maxMag * 0.001) continue;
        const a = Math.log(mag[k - 1] + 1e-12);
        const b = Math.log(m + 1e-12);
        const g = Math.log(mag[k + 1] + 1e-12);
        const den = a - 2 * b + g;
        const p = den !== 0 ? 0.5 * (a - g) / den : 0;
        out.push({ f: (k + p) * binHz, a: Math.log2(m / floor) });
      }
      return out;
    }

    // Amplitude du pic le plus fort autour de la fréquence f (tolérance relative tol)
    pickAt(peaks, f, tol) {
      let best = -1;
      let bestA = 0;
      const lo = f * (1 - tol);
      const hi = f * (1 + tol);
      // recherche dichotomique du premier pic >= lo
      let a = 0;
      let b = peaks.length;
      while (a < b) { const mid = (a + b) >> 1; if (peaks[mid].f < lo) a = mid + 1; else b = mid; }
      for (let i = a; i < peaks.length && peaks[i].f <= hi; i++) {
        if (peaks[i].rest > bestA) { bestA = peaks[i].rest; best = i; }
      }
      return best;
    }

    harmonics(m) {
      const f0 = midiFreq(m, this.a4);
      const H = Math.max(3, Math.min(12, Math.floor(5500 / f0)));
      const list = [];
      for (let h = 1; h <= H; h++) list.push(h * f0 * Math.sqrt(1 + this.B * h * h));
      return list;
    }

    // Saillance d'une note candidate sur les pics restants
    salience(peaks, m) {
      const hs = this.harmonics(m);
      let s = 0;
      let found = 0;
      let odd = 0;
      const idx = [];
      for (let h = 1; h <= hs.length; h++) {
        const tol = this.tol * (h === 1 ? 1 : 0.8);
        const i = this.pickAt(peaks, hs[h - 1], tol);
        idx.push(i);
        if (i < 0) continue;
        const amp = peaks[i].rest;
        if (amp <= 0.5) continue;
        found++;
        if (h % 2 === 1) odd++;
        s += amp / Math.pow(h, 0.55);
      }
      const ratio = found / hs.length;
      // Les sous-octaves fantômes n'ont pas d'harmoniques impaires : on les écarte.
      if (odd === 0 || found < 2) return { s: 0, idx, found };
      // Au-dessus des graves, une note de piano a toujours une fondamentale nette :
      // sans elle, c'est un fantôme fait des harmoniques d'autres notes.
      const f0 = hs[0];
      const amp = h => (idx[h - 1] >= 0 ? peaks[idx[h - 1]].rest : 0);
      let maxA = 0;
      for (let h = 1; h <= idx.length; h++) maxA = Math.max(maxA, amp(h));
      if (f0 >= 200 && amp(1) < 0.35 * maxA) return { s: 0, idx, found };
      if (f0 >= 100 && f0 < 200 && amp(1) <= 0.5 && amp(2) <= 0.5) return { s: 0, idx, found };
      if (f0 < 100 && amp(2) <= 0.5 && amp(3) <= 0.5) return { s: 0, idx, found };
      return { s: s * (0.4 + 0.6 * ratio), idx, found };
    }

    // Estimation itérative : on prend la note la plus saillante, on retire ses harmoniques, on recommence.
    estimate(peaks) {
      for (const p of peaks) p.rest = p.a;
      const notes = [];
      let first = 0;
      for (let iter = 0; iter < 7; iter++) {
        let best = null;
        for (let m = this.minMidi; m <= this.maxMidi; m++) {
          if (notes.some(n => n.midi === m)) continue;
          const r = this.salience(peaks, m);
          if (!best || r.s > best.s) best = Object.assign({ midi: m }, r);
        }
        if (!best || best.s <= 0) break;
        if (iter === 0) first = best.s;
        if (best.s < Math.max(3, first * 0.2)) break;
        notes.push({ midi: best.midi, s: best.s, found: best.found, a1: best.idx[0] >= 0 ? peaks[best.idx[0]].a : 0 });
        // Soustraction lissée : on garde l'excès d'un partiel par rapport à ses voisins
        // (pour ne pas effacer une octave réellement jouée).
        const amps = best.idx.map(i => (i >= 0 ? peaks[i].rest : 0));
        best.idx.forEach((i, h) => {
          if (i < 0) return;
          const nb = [amps[h - 1], amps[h + 1]].filter(x => x != null && x > 0);
          const smooth = nb.length ? nb.reduce((x, y) => x + y, 0) / nb.length : amps[h];
          const remove = Math.min(peaks[i].rest, Math.max(smooth, amps[h] * 0.75));
          peaks[i].rest = Math.max(0, peaks[i].rest - remove);
        });
      }
      // Fantômes harmoniques : une note pile sur la 3e, 4e, 5e… harmonique d'une note plus grave,
      // avec une fondamentale nettement plus faible que celle-ci, n'est qu'un écho.
      const HARM = [19, 24, 28, 31, 34, 36];
      return notes.filter(n => !notes.some(l => l !== n && HARM.indexOf(n.midi - l.midi) >= 0 && n.a1 < l.a1 - 0.8));
    }

    // Saillance directe d'une note (sans soustraction des autres)
    direct(peaks, m) {
      for (const p of peaks) p.rest = p.a;
      return this.salience(peaks, m).s;
    }

    // Photo juste avant une attaque : sert à repérer les notes réellement (re)frappées
    // (avec la pédale, les notes d'avant résonnent encore).
    snapshot(frame) {
      const sal = new Map();
      for (let m = this.minMidi; m <= this.maxMidi; m++) sal.set(m, this.direct(frame.peaks, m));
      return { sal, peaks: frame.peaks.map(p => ({ f: p.f, a: p.a })) };
    }

    // Amplitude du plus fort pic autour de f (amplitudes d'origine)
    ampAt(peaks, f, tol) {
      let a = 0;
      let b = peaks.length;
      const lo = f * (1 - tol);
      const hi = f * (1 + tol);
      while (a < b) { const mid = (a + b) >> 1; if (peaks[mid].f < lo) a = mid + 1; else b = mid; }
      let best = 0;
      for (let i = a; i < peaks.length && peaks[i].f <= hi; i++) if (peaks[i].a > best) best = peaks[i].a;
      return best;
    }

    // Force d'attaque d'une note : combien ses harmoniques ont monté depuis la photo d'avant.
    attack(m, peaks, prePeaks) {
      const hs = this.harmonics(m);
      let sum = 0;
      let up = 0;
      for (let h = 1; h <= Math.min(6, hs.length); h++) {
        const now = this.ampAt(peaks, hs[h - 1], this.tol);
        const before = prePeaks ? this.ampAt(prePeaks, hs[h - 1], this.tol) : 0;
        const inc = now - before;
        if (inc > 0) sum += inc / Math.pow(h, 0.55);
        if (inc >= 0.5) up++;
      }
      return up >= 2 ? sum : 0;
    }

    // Crée un vérificateur pour une forme attendue, au moment d'une attaque.
    matcher(target, pre, t0) { return new Matcher(this, target, pre, t0); }
  }

  // Vérifie qu'une forme (liste de MIDI) vient d'être plaquée :
  // - chaque note visée doit être ATTAQUÉE (sa saillance monte depuis l'attaque), à une octave près ;
  //   une note qui résonne encore (pédale) ne compte pas ;
  // - aucune autre note nouvellement attaquée, hors échos harmoniques des notes visées.
  class Matcher {
    constructor(det, target, pre, t0) {
      this.det = det;
      this.t0 = t0 == null ? null : t0;
      this.target = target.slice();
      this.pre = pre || null;
      this.pcs = new Set(target.map(mod12));
      this.attacked = new Map(); // classe de hauteur -> vrai une fois attaquée
    }
    update(frame) {
      const det = this.det;
      const peaks = frame.peaks;
      const cache = new Map();
      const sal = m => {
        if (m < det.minMidi || m > det.maxMidi) return 0;
        if (!cache.has(m)) cache.set(m, det.direct(peaks, m));
        return cache.get(m);
      };
      const preOf = m => (this.pre ? this.pre.sal.get(m) || 0 : 0);
      const prePeaks = this.pre ? this.pre.peaks : null;
      const fresh = m => !this.pre || det.attack(m, peaks, prePeaks) >= 1.5;
      const est = frame.notes;
      const maxS = est.reduce((x, n) => Math.max(x, n.s), 0);
      const present = [];
      const missing = [];
      for (const t of this.target) {
        const pc = mod12(t);
        if (present.indexOf(pc) >= 0 || missing.indexOf(pc) >= 0) continue;
        // la note (ou son octave) sonne nettement dans CETTE trame…
        let strongNow = false;
        for (const m of [t, t - 12, t + 12]) {
          const n = est.find(x => x.midi === m);
          const v = n ? n.s : sal(m);
          const strong = n ? n.s >= maxS * 0.2 : (v >= Math.max(6, maxS * 0.25) && v >= 1.1 * Math.max(sal(m - 1), sal(m + 1)));
          if (!strong) continue;
          strongNow = true;
          // … et elle a été frappée depuis l'attaque (pas seulement entendue en résonance)
          if (!this.attacked.get(pc) && fresh(m)) this.attacked.set(pc, true);
        }
        (strongNow && this.attacked.get(pc) ? present : missing).push(pc);
      }
      const HARM = [12, 19, 24, 28, 31, 34, 36];
      const explained = m => this.target.some(t => HARM.indexOf(m - t) >= 0 || HARM.indexOf(m - (t - 12)) >= 0);
      const cand = new Map();
      est.forEach(n => cand.set(n.midi, n.s));
      if (this.pre) {
        for (let m = det.minMidi; m <= det.maxMidi; m++) {
          if (cand.has(m)) continue;
          const v = sal(m);
          if (v >= maxS * 0.45 && v > preOf(m) && v > sal(m - 1) && v >= sal(m + 1)) cand.set(m, v);
        }
      }
      const extra = [];
      cand.forEach((v, m) => {
        if (this.pcs.has(mod12(m)) || explained(m)) return;
        if (v > maxS * 0.3 && fresh(m)) extra.push(m);
      });
      // Les 25 premières ms après l'attaque, le bruit du marteau brouille tout : on attend.
      const settled = this.t0 == null || frame.t - this.t0 >= 0.025;
      return { ok: settled && missing.length === 0 && extra.length === 0, present, missing, extra };
    }
  }

  root.TJDetector = { Detector, Matcher, makeFFT, midiFreq };
})(typeof window !== 'undefined' ? window : globalThis);
