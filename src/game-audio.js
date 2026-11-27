import musicUrl from "./audio/cathedral.ogg";
import laserUrl from "./audio/laser.ogg";
import prismUrl from "./audio/prism.ogg";
import launchUrl from "./audio/launch.ogg";
import impactUrl from "./audio/impact.ogg";
import shieldUrl from "./audio/shield.ogg";
import hullUrl from "./audio/hull.ogg";
import explosionUrl from "./audio/explosion.ogg";

const STORAGE_KEY = "mmo-audio-muted";
const RANGES = { laser: 1000, prism: 1000, launch: 1250, impact: 700, explosion: 1650, shield: 800, hull: 800 };
const SAMPLES = {
  laser: { url: laserUrl, level: 0.32 },
  prism: { url: prismUrl, level: 0.37 },
  launch: { url: launchUrl, level: 0.38, limit: 0.95 },
  impact: { url: impactUrl, level: 0.31, limit: 0.7 },
  shield: { url: shieldUrl, level: 0.27, limit: 0.55 },
  hull: { url: hullUrl, level: 0.31, limit: 0.55 },
  explosion: { url: explosionUrl, level: 0.53 },
};

export function createGameAudio(button) {
  let context, master, noiseBuffer, atmosphere, engine, enginePitch, music;
  let inGame = false;
  let thrusting = false;
  let muted = localStorage.getItem(STORAGE_KEY) === "true";
  const recent = new Map();
  const decoded = new Map();

  function updateButton() {
    button.textContent = muted ? "Звук выкл." : "Звук вкл.";
    button.setAttribute("aria-pressed", String(!muted));
  }

  function updateMix() {
    if (!context) return;
    const now = context.currentTime;
    master.gain.setTargetAtTime(muted || document.hidden ? 0 : 0.62, now, 0.06);
    atmosphere.gain.setTargetAtTime(inGame ? 0.09 : 0, now, 0.32);
    engine.gain.setTargetAtTime(inGame && thrusting ? 0.36 : 0, now, 0.16);
    enginePitch.frequency.setTargetAtTime(thrusting ? 73 : 43, now, 0.14);
  }

  function updateMusic() {
    if (!music) return;
    if (inGame && !muted && !document.hidden) {
      if (music.paused) void music.play().catch(() => {});
    } else {
      music.pause();
    }
  }

  function unlock() {
    if (muted) return;
    if (!context) {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) return;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -16;
      limiter.ratio.value = 6;
      master.connect(limiter).connect(context.destination);
      music = new Audio(musicUrl);
      music.loop = true;
      const musicGain = context.createGain();
      musicGain.gain.value = 0.28;
      context.createMediaElementSource(music).connect(musicGain).connect(master);
      for (const [name, sample] of Object.entries(SAMPLES)) {
        fetch(sample.url).then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.arrayBuffer();
        }).then((buffer) => context.decodeAudioData(buffer))
          .then((buffer) => decoded.set(name, buffer)).catch(() => {});
      }
      noiseBuffer = context.createBuffer(1, 2 * context.sampleRate, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = 2 * Math.random() - 1;

      atmosphere = loopBus();
      const lowDrone = oscillator("sine", 48, 0.36, atmosphere);
      oscillator("sine", 72.5, 0.17, atmosphere);
      oscillator("sine", 96.4, 0.09, atmosphere);
      const pulse = context.createOscillator();
      pulse.frequency.value = 0.17;
      const depth = context.createGain();
      depth.gain.value = 0.7;
      pulse.connect(depth).connect(lowDrone.frequency);
      pulse.start();
      loopNoise(250, 0.19, atmosphere);
      engine = loopBus();
      enginePitch = oscillator("triangle", 43, 0.31, engine);
      loopNoise(420, 0.48, engine);
      updateMix();
    }
    if (context.state !== "running") void context.resume().catch(() => {});
    updateMusic();
  }

  function loopBus() {
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    return gain;
  }

  function oscillator(type, hz, level, bus) {
    const wave = context.createOscillator();
    wave.type = type;
    wave.frequency.value = hz;
    const gain = context.createGain();
    gain.gain.value = level;
    wave.connect(gain).connect(bus);
    wave.start();
    return wave;
  }

  function loopNoise(hz, level, bus) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = hz;
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(filter).connect(gain).connect(bus);
    source.start();
  }

  function voice(bus, time, { wave, from, to, level, duration, attack = 0.012, delay = 0 }) {
    const start = time + delay;
    const end = start + duration;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(level, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(bus);
    let source, filter;
    if (wave === "noise") {
      source = context.createBufferSource();
      source.buffer = noiseBuffer;
      filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(from, start);
      filter.frequency.exponentialRampToValueAtTime(to, end);
      source.connect(filter).connect(envelope);
    } else {
      source = context.createOscillator();
      source.type = wave;
      source.frequency.setValueAtTime(from, start);
      source.frequency.exponentialRampToValueAtTime(to, end);
      source.connect(envelope);
    }
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      envelope.disconnect();
    };
    source.start(start);
    source.stop(end);
  }

  const sounds = {
    select: [
      { wave: "sine", from: 420, to: 650, level: 0.19, duration: 0.095, attack: 0.008 },
    ],
    attack: [
      { wave: "triangle", from: 310, to: 480, level: 0.16, duration: 0.12 },
      { wave: "sine", from: 640, to: 820, level: 0.13, duration: 0.11, delay: 0.072 },
    ],
    launch: [
      { wave: "noise", from: 2900, to: 230, level: 0.39, duration: 0.48, attack: 0.043 },
      { wave: "triangle", from: 130, to: 54, level: 0.24, duration: 0.38 },
      { wave: "noise", from: 3600, to: 490, level: 0.13, duration: 0.25, delay: 0.10, attack: 0.009 },
    ],
    explosion: [
      { wave: "noise", from: 3600, to: 95, level: 0.69, duration: 1.14, attack: 0.015 },
      { wave: "sine", from: 115, to: 27, level: 0.55, duration: 0.78, attack: 0.015 },
      { wave: "noise", from: 6400, to: 360, level: 0.29, duration: 0.62, attack: 0.025, delay: 0.09 },
    ],
    heat: [
      { wave: "triangle", from: 490, to: 370, level: 0.17, duration: 0.14, attack: 0.009 },
      { wave: "triangle", from: 490, to: 284, level: 0.15, duration: 0.13, attack: 0.009, delay: 0.14 },
    ],
  };

  function playSample(name, bus, now) {
    const buffer = decoded.get(name);
    if (!buffer) return 0;
    const sample = SAMPLES[name];
    const duration = Math.min(buffer.duration, sample.limit ?? Infinity);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(sample.level, now + Math.max(0, duration - 0.075));
    envelope.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(envelope).connect(bus);
    source.onended = () => { source.disconnect(); envelope.disconnect(); };
    source.start(now, 0, duration);
    return duration;
  }

  function play(name, origin, listener) {
    if (context?.state !== "running" || muted || document.hidden || !inGame) return;
    const dx = origin && listener ? origin.x - listener.x : 0;
    const dy = origin && listener ? origin.y - listener.y : 0;
    const range = RANGES[name] ?? 1000;
    const proximity = 1 - Math.hypot(dx, dy) / range;
    const parts = sounds[name] ?? [];
    if (proximity <= 0 || (!parts.length && !decoded.has(name))) return;
    const now = context.currentTime;
    const key = `${name}:${Math.round(dx / 90)}:${Math.round(dy / 90)}`;
    if (now - (recent.get(key) ?? -Infinity) < 0.075) return;
    recent.set(key, now);
    if (recent.size > 128) {
      for (const [id, playedAt] of recent) if (now - playedAt > 2) recent.delete(id);
      if (recent.size > 128) recent.delete(recent.keys().next().value);
    }
    const gain = context.createGain();
    gain.gain.value = proximity ** 1.5;
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-0.8, Math.min(0.8, dx / 620));
    gain.connect(pan).connect(master);
    for (const part of parts) voice(gain, now, part);
    const duration = Math.max(playSample(name, gain, now), ...parts.map((part) => part.duration + (part.delay ?? 0)));
    setTimeout(() => { gain.disconnect(); pan.disconnect(); }, (duration + 0.12) * 1000);
  }

  updateButton();
  button.addEventListener("click", () => {
    muted = !muted;
    localStorage.setItem(STORAGE_KEY, String(muted));
    if (!muted) unlock();
    updateButton();
    updateMix();
    updateMusic();
  });
  document.addEventListener("visibilitychange", () => { updateMix(); updateMusic(); });
  return {
    unlock,
    play,
    setInGame(value) {
      if (inGame === value) return;
      inGame = value;
      if (!inGame) thrusting = false;
      updateMix();
      updateMusic();
    },
    setThrust(value) {
      if (thrusting === value) return;
      thrusting = value;
      updateMix();
    },
  };
}
