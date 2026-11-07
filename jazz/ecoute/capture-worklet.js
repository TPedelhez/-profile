/* Truc Jazz · capture micro : envoie le son brut par paquets de 256 échantillons,
   avec l'heure audio de la fin du paquet. Tourne dans le fil audio du navigateur. */
class TJCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.buf.set(ch, this.n);
      this.n += ch.length;
      if (this.n >= 256) {
        this.port.postMessage({ s: this.buf.slice(0, this.n), t: currentTime + ch.length / sampleRate });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('tj-capture', TJCapture);
