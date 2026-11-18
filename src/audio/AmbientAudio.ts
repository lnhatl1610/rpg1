import { FlightMode } from '../types';

const PENTATONIC_HZ = [
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
  880.0,  // A5
  1046.5, // C6
  1174.66,// D6
  1318.51,// E6
];

export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  public enabled = false;

  private chimeTimer = 1.5;

  public toggle(): boolean {
    if (!this.enabled) {
      this.start();
    } else {
      this.stop();
    }
    return this.enabled;
  }

  public start(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.55;
      this.masterGain.connect(this.ctx.destination);

      // Gentle procedural breeze noise buffer
      const bufSize = this.ctx.sampleRate * 3;
      const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < bufSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + 0.03 * white) / 1.03;
        lastOut = data[i];
        data[i] *= 2.4;
      }

      const src = this.ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 420;
      this.windFilter.Q.value = 1.4;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.06;

      src.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      src.start();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.25);
    }
    this.enabled = true;
  }

  public stop(): void {
    this.enabled = false;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.2);
    }
  }

  public playBoostWhoosh(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.28);

    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.48);
  }

  private playHarpNote(freq: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const harmonic = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    harmonic.type = 'triangle';
    harmonic.frequency.setValueAtTime(freq * 2, now);

    const harmGain = this.ctx.createGain();
    harmGain.gain.value = 0.12;

    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.075, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 3.4);

    osc.connect(g);
    harmonic.connect(harmGain);
    harmGain.connect(g);
    g.connect(this.masterGain);

    osc.start(now);
    harmonic.start(now);
    osc.stop(now + 3.5);
    harmonic.stop(now + 3.5);
  }

  public update(dt: number, elapsed: number, speed: number, mode: FlightMode): void {
    if (!this.enabled || !this.ctx || !this.windFilter || !this.windGain) return;

    const now = this.ctx.currentTime;
    const gust = 0.5 + 0.5 * Math.sin(elapsed * 0.7);
    const airFactor = mode === 'flying' || mode === 'gliding' ? 1.5 : 1.0;

    const targetFreq = (340 + gust * 180 + speed * 26) * airFactor;
    const targetVol = Math.min(0.28, (0.045 + gust * 0.03 + speed * 0.0065) * airFactor);

    this.windFilter.frequency.setTargetAtTime(Math.min(2200, targetFreq), now, 0.12);
    this.windGain.gain.setTargetAtTime(targetVol, now, 0.12);

    // Delicate Celestia harp arpeggio notes drifting on the wind
    this.chimeTimer -= dt;
    if (this.chimeTimer <= 0) {
      const note = PENTATONIC_HZ[Math.floor(Math.random() * PENTATONIC_HZ.length)];
      this.playHarpNote(note);
      this.chimeTimer = 1.4 + Math.random() * 2.8;
    }
  }
}
