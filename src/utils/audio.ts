// Web Audio API Synthesizer for high-fidelity Poker Sound Effects
// Since we are in a sandboxed environment, we can dynamically build rich sounds using oscillators!

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    // Lazy-initialize to satisfy browser security which requires user interaction
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playDealCard() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  // Slide frequency to simulate paper rub
  osc.frequency.setValueAtTime(350, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.15);

  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.16);
}

export function playChipClink() {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Let's chain multiple high-frequency metallic notes for the chip clink
  const playClinkNode = (timeOffset: number, pitch: number, volume: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, ctx.currentTime + timeOffset);
    
    gain.gain.setValueAtTime(0, ctx.currentTime + timeOffset);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + timeOffset + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + timeOffset + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + timeOffset);
    osc.stop(ctx.currentTime + timeOffset + 0.21);
  };

  // Stack 3 clinks slightly offset to sound like a small pile of chips
  playClinkNode(0, 1600, 0.15);
  playClinkNode(0.02, 1450, 0.1);
  playClinkNode(0.045, 1720, 0.08);
}

export function playCheckKnock() {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Simulate double-tap table knock
  const playKnockNode = (timeOffset: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, ctx.currentTime + timeOffset);
    osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + timeOffset + 0.08);

    gain.gain.setValueAtTime(0, ctx.currentTime + timeOffset);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + timeOffset + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + timeOffset + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + timeOffset);
    osc.stop(ctx.currentTime + timeOffset + 0.1);
  };

  playKnockNode(0);
  playKnockNode(0.12);
}

export function playFoldSigh() {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Paper rustle swoosh
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.2);

  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(500, ctx.currentTime);

  osc.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.23);
}

export function playWinnerFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Ascending synth chords
  const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
  notes.forEach((note, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(note, ctx.currentTime + index * 0.06);

    gain.gain.setValueAtTime(0, ctx.currentTime + index * 0.06);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + index * 0.06 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.06 + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + index * 0.06);
    osc.stop(ctx.currentTime + index * 0.06 + 0.45);
  });
}
