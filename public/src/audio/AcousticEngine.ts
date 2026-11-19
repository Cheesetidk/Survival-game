import * as THREE from 'three';

export class AcousticEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private rearBayFilter: BiquadFilterNode | null = null;
  private rearBayGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.42;
      this.masterGain.connect(this.ctx.destination);

      // Portal-occluded bus for sounds originating in the rear transit bay (z < -12)
      this.rearBayFilter = this.ctx.createBiquadFilter();
      this.rearBayFilter.type = 'lowpass';
      this.rearBayFilter.frequency.value = 450;
      this.rearBayFilter.Q.value = 1.2;

      this.rearBayGain = this.ctx.createGain();
      this.rearBayGain.gain.value = 0.65;

      this.rearBayFilter.connect(this.rearBayGain);
      this.rearBayGain.connect(this.masterGain);

      this.noiseBuffer = this.createWhiteNoiseBuffer(this.ctx);
      this.startMegastructureAmbience();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private createWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private startMegastructureAmbience(): void {
    if (!this.ctx || !this.masterGain || !this.rearBayFilter) return;

    // Deep concrete shaft resonance (54 Hz + 81 Hz)
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 54;

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 81;

    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.08;

    osc1.connect(droneGain);
    osc2.connect(droneGain);
    droneGain.connect(this.masterGain);
    osc1.start();
    osc2.start();

    // Rear-bay turbine hum routed through the blast-door low-pass filter
    const rearHum = this.ctx.createOscillator();
    rearHum.type = 'sawtooth';
    rearHum.frequency.value = 110;
    const humGain = this.ctx.createGain();
    humGain.gain.value = 0.035;
    rearHum.connect(humGain);
    humGain.connect(this.rearBayFilter);
    rearHum.start();
  }

  public updatePortalAcoustics(dt: number, playerZ: number, doorOpen: boolean): void {
    if (!this.ctx || !this.rearBayFilter || !this.rearBayGain) return;

    // If player is in front bay (z > -12) and blast door is closed, muffle rear-bay audio
    const occluded = playerZ > -12 && !doorOpen;
    const targetCutoff = occluded ? 420 : 15500;
    const targetGain = occluded ? 0.35 : 0.95;

    const rate = Math.min(1, dt * 7.5);
    this.rearBayFilter.frequency.value +=
      (targetCutoff - this.rearBayFilter.frequency.value) * rate;
    this.rearBayGain.gain.value += (targetGain - this.rearBayGain.gain.value) * rate;
  }

  public playFootstep(sprinting: boolean, onBiomass: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const startFreq = onBiomass ? 72 : sprinting ? 118 : 96;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.09);

    const vol = (sprinting ? 0.16 : 0.08) * (onBiomass ? 0.65 : 1.0);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playBlastDoorCycle(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Pneumatic hiss
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(480, now + 0.55);
    filter.Q.value = 2.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.62);
  }

  public playArcDischarge(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.18);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playStalkerClick(sourcePos: THREE.Vector3, listenerPos: THREE.Vector3, alerted: boolean): void {
    if (!this.ctx || !this.masterGain || !this.rearBayFilter) return;

    const dist = sourcePos.distanceTo(listenerPos);
    if (dist > 28) return;
    const atten = Math.max(0.05, 1 - dist / 28);

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = alerted ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(alerted ? 310 : 190, now);
    osc.frequency.exponentialRampToValueAtTime(alerted ? 120 : 65, now + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime((alerted ? 0.22 : 0.11) * atten, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    // Route through rearBayFilter if the Stalker is behind the partition wall
    const targetBus = sourcePos.z < -12 ? this.rearBayFilter : this.masterGain;
    gain.connect(targetBus);

    osc.start(now);
    osc.stop(now + 0.1);
  }
}