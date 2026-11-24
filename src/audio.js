// All sound is synthesised with the Web Audio API: crowd, whistle, ball and
// cheers. No audio files. Browsers only allow sound after a click, so start()
// is called from the menu's Start button.

export function createAudio() {
  let ctx = null;
  let master = null;
  let crowd = null;
  let noise = null;
  let muted = false;

  function start() {
    if (ctx) {
      ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Constant crowd murmur: looped noise through a band-pass filter.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 700;
    band.Q.value = 0.4;
    crowd = ctx.createGain();
    crowd.gain.value = 0.05;
    src.connect(band).connect(crowd).connect(master);
    src.start();
  }

  function burst(freq, q, gain, dur, type = 'bandpass') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  function whistle(blasts = 1) {
    if (!ctx) return;
    for (let i = 0; i < blasts; i++) {
      const t = ctx.currentTime + i * 0.32;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.setValueAtTime(0.16, t + 0.2);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.26);
      g.connect(master);
      for (const hz of [2150, 2290]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = hz;
        o.connect(g);
        o.start(t);
        o.stop(t + 0.27);
      }
    }
  }

  /** Crowd swells for a moment: big for a goal, small for a save or near miss. */
  function swell(amount, seconds) {
    if (!ctx) return;
    const t = ctx.currentTime;
    crowd.gain.cancelScheduledValues(t);
    crowd.gain.setValueAtTime(crowd.gain.value, t);
    crowd.gain.linearRampToValueAtTime(amount, t + 0.15);
    crowd.gain.linearRampToValueAtTime(0.05, t + seconds);
  }

  return {
    start,
    whistle,
    throwBall: () => burst(900, 1.2, 0.25, 0.09),
    powerShot() {
      burst(140, 1, 0.9, 0.3, 'lowpass');
      burst(1400, 0.8, 0.35, 0.18);
      swell(0.2, 1.4);
    },
    catchBall: () => burst(380, 1.5, 0.3, 0.07, 'lowpass'),
    bounce: () => burst(220, 2, 0.35, 0.1, 'lowpass'),
    post: () => burst(2600, 9, 0.5, 0.25),
    goal: () => swell(0.38, 3),
    gasp: () => swell(0.16, 1.2),
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.7;
      return muted;
    },
  };
}
