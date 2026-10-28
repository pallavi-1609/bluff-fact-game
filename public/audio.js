// High quality Web Audio API sound synthesis - zero external file dependencies!
class SoundEffects {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playTone(freq, type, duration, delay = 0, gainLevel = 0.15) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    setTimeout(() => {
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(gainLevel, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        // audio context handling
      }
    }, delay * 1000);
  }

  // Sound: Player joins room
  playJoin() {
    this.playTone(440, 'sine', 0.12, 0, 0.2);
    this.playTone(880, 'sine', 0.18, 0.08, 0.2);
  }

  // Sound: Round start fanfare
  playRoundStart() {
    const notes = [261.63, 329.63, 392.00, 523.25]; // C E G C
    notes.forEach((freq, idx) => {
      this.playTone(freq, 'triangle', 0.25, idx * 0.12, 0.25);
    });
  }

  // Sound: Countdown tick (last 5 seconds)
  playTick() {
    this.playTone(600, 'square', 0.04, 0, 0.08);
  }

  // Sound: User submits answer
  playSubmit() {
    this.playTone(523.25, 'sine', 0.1, 0, 0.2);
    this.playTone(659.25, 'sine', 0.15, 0.06, 0.2);
    this.playTone(783.99, 'sine', 0.25, 0.12, 0.2);
  }

  // Sound: Guess / Vote clicked
  playVote() {
    this.playTone(350, 'triangle', 0.08, 0, 0.2);
    this.playTone(550, 'triangle', 0.15, 0.05, 0.2);
  }

  // Sound: Dramatic Truth Revealed
  playTruthReveal() {
    // Game show triumphant chord
    this.playTone(523.25, 'sawtooth', 0.6, 0, 0.15);
    this.playTone(659.25, 'sawtooth', 0.6, 0, 0.15);
    this.playTone(783.99, 'sawtooth', 0.6, 0, 0.15);
    this.playTone(1046.50, 'sawtooth', 0.8, 0.1, 0.2);
  }

  // Sound: Player tricked by bluff (funny slide)
  playFooled() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.35);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.35);
    } catch (e) {}
  }

  // Sound: Grand Winner Podium Fanfare
  playPodium() {
    const fanfare = [
      { f: 523.25, d: 0.15, t: 0 },
      { f: 523.25, d: 0.15, t: 0.15 },
      { f: 523.25, d: 0.15, t: 0.3 },
      { f: 659.25, d: 0.45, t: 0.45 },
      { f: 587.33, d: 0.15, t: 0.9 },
      { f: 659.25, d: 0.15, t: 1.05 },
      { f: 783.99, d: 0.8,  t: 1.2 }
    ];
    fanfare.forEach(n => {
      this.playTone(n.f, 'triangle', n.d, n.t, 0.25);
    });
  }
}

window.sounds = new SoundEffects();
