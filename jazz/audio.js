/* Truc Jazz · le son
   Piano électrique en synthèse FM (façon Rhodes), contrebasse simple, charley.
   Tout est généré par Web Audio : aucun fichier son. Expose window.TJAudio. */
(function (root) {
  'use strict';

  let ctx = null;
  let bus = null;
  let noiseBuf = null;
  const voices = new Set();

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      bus = ctx.createGain();
      const rev = ctx.createConvolver();
      rev.buffer = impulse(2.4, 3);
      const wet = ctx.createGain();
      wet.gain.value = 0.18;
      bus.connect(master);
      bus.connect(rev);
      rev.connect(wet);
      wet.connect(master);
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  const now = () => (ctx ? ctx.currentTime : 0);
  const freq = m => 440 * Math.pow(2, (m - 69) / 12);

  function track(amp, oscs, stopAt) {
    const v = { amp, oscs };
    voices.add(v);
    oscs[0].onended = () => voices.delete(v);
    oscs.forEach(o => o.stop(stopAt));
  }

  function out(node, midi) {
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 62) / 36));
      node.connect(pan);
      pan.connect(bus);
    } else {
      node.connect(bus);
    }
  }

  // Piano électrique : porteuse sinus modulée en fréquence, l'indice décroît (attaque brillante, queue ronde).
  function ep(midi, t, dur, vel) {
    if (!ensure()) return;
    vel = Math.max(0.05, Math.min(1, vel == null ? 0.8 : vel));
    const f = freq(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const modG = ctx.createGain();
    const idx = f * (0.7 + 1.5 * vel) * (midi > 84 ? 0.5 : 1);
    modG.gain.setValueAtTime(idx, t);
    modG.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.08), t + 1.4);
    mod.connect(modG);
    modG.connect(car.frequency);

    const amp = ctx.createGain();
    const peak = 0.17 * vel;
    const tau1 = 0.28;
    const tau2 = Math.max(0.6, 2.6 - (midi - 40) * 0.035);
    const end = t + Math.max(0.05, dur);
    const tA = Math.min(end, t + 0.25);
    const vA = peak * Math.exp(-(tA - t) / tau1);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(Math.max(vA, 0.0002), tA);
    if (end > tA) amp.gain.exponentialRampToValueAtTime(Math.max(vA * Math.exp(-(end - tA) / tau2), 0.0002), end);
    amp.gain.setTargetAtTime(0.0001, end, 0.07);
    car.connect(amp);
    out(amp, midi);
    car.start(t);
    mod.start(t);
    track(amp, [car, mod], end + 0.6);
  }

  // Contrebasse : triangle filtré, attaque pincée.
  function bass(midi, t, dur, vel) {
    if (!ensure()) return;
    vel = vel == null ? 0.9 : vel;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq(midi);
    const sub = ctx.createOscillator();
    sub.frequency.value = freq(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.25);
    const amp = ctx.createGain();
    const end = t + Math.max(0.05, dur);
    const peak = 0.36 * vel;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(Math.max(peak * Math.exp(-(end - t) / 0.9), 0.0002), end);
    amp.gain.setTargetAtTime(0.0001, end, 0.05);
    const subG = ctx.createGain();
    subG.gain.value = 0.5;
    o.connect(lp);
    sub.connect(subG);
    subG.connect(lp);
    lp.connect(amp);
    out(amp, midi);
    o.start(t);
    sub.start(t);
    track(amp, [o, sub], end + 0.4);
  }

  // Charley au pied : bruit filtré très court.
  function hat(t, vel) {
    if (!ensure()) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    const peak = 0.11 * (vel == null ? 1 : vel);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(hp);
    hp.connect(g);
    g.connect(bus);
    src.start(t);
    track(g, [src], t + 0.12);
  }

  function stopAll() {
    if (!ctx) return;
    const t = now();
    voices.forEach(v => {
      try {
        v.amp.gain.cancelScheduledValues(t);
        v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), t);
        v.amp.gain.setTargetAtTime(0.0001, t, 0.03);
        v.oscs.forEach(o => o.stop(t + 0.15));
      } catch (e) { /* source déjà arrêtée */ }
    });
    voices.clear();
  }

  root.TJAudio = { ensure, now, ep, bass, hat, stopAll };
})(window);
