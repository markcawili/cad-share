// Short UI sounds made with Web Audio, so there are no audio files to load.
// Browsers keep audio muted until the user clicks something on the page; the
// expert's start button and the customer's "I understand" button do that.
let ctx = null;

function audio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Call from a click handler to allow sound from then on.
export function unlockSound() {
  audio();
}

function tone(freq, start, length, volume, type = 'sine') {
  const a = audio();
  const osc = a.createOscillator();
  const gain = a.createGain();
  const t = a.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** Crisp tick for selecting or highlighting a piece. */
export function playSelect() {
  tone(1320, 0, 0.07, 0.18, 'triangle');
  tone(2640, 0, 0.03, 0.05);
}

/** Two-note rising chime for a confirmed placement. */
export function playConfirm() {
  tone(660, 0, 0.16, 0.2, 'triangle');
  tone(990, 0.11, 0.28, 0.2, 'triangle');
}
