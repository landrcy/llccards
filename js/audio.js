/* LLC Cards audio: real recorded/composed files only (see assets/audio/CREDITS.txt).
   Starts after the first user gesture. Mute persists in localStorage. */
(function (global) {
  const KEY = "llc-muted";
  const V = "2";
  const SFX = {
    click: 0.35, shake: 0.5, rip: 0.7, flip: 0.55, slide: 0.45, thump: 0.5, place: 0.6,
    hit: 0.55, drain: 0.35, cast: 0.45, new: 0.4, foil: 0.35, win: 0.5, lose: 0.5, match: 0.5, nope: 0.3,
  };
  const MUSIC = { map: "lofi_map", battle: "lofi_battle" };
  const OGG = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; } })();
  const MUSIC_VOL = 0.18;
  let muted = localStorage.getItem(KEY) === "1";
  let unlocked = false;
  const pools = {};
  const tracks = {};
  let want = null, current = null, fadeRaf = 0;

  function src(name) { return "assets/audio/" + name + ".mp3?v=" + V; }

  function pool(name) {
    if (!pools[name]) {
      pools[name] = [0, 1, 2].map(() => { const a = new Audio(src(name)); a.preload = "auto"; return a; });
      pools[name].i = 0;
    }
    return pools[name];
  }

  function play(name, vol) {
    if (muted || !unlocked || !(name in SFX)) return;
    const p = pool(name);
    const a = p[p.i++ % p.length];
    try {
      a.currentTime = 0;
      a.volume = Math.max(0, Math.min(1, (vol == null ? 1 : vol) * SFX[name]));
      const pr = a.play();
      if (pr && pr.catch) pr.catch(() => {});
    } catch (e) {}
  }

  function track(key) {
    if (!tracks[key]) {
      const a = new Audio("assets/audio/" + MUSIC[key] + (OGG ? ".ogg" : ".mp3") + "?v=" + V);
      a.loop = true; a.preload = "auto"; a.volume = 0;
      tracks[key] = a;
    }
    return tracks[key];
  }

  /* time-based crossfade */
  function fadeTo(key) {
    cancelAnimationFrame(fadeRaf);
    const next = key && !muted && unlocked ? track(key) : null;
    const others = Object.keys(tracks).map((k) => tracks[k]).filter((a) => a !== next);
    if (next && next.paused) { const pr = next.play(); if (pr && pr.catch) pr.catch(() => {}); }
    const start = performance.now(), dur = 700;
    const from = new Map();
    others.concat(next ? [next] : []).forEach((a) => from.set(a, a.volume));
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      others.forEach((a) => { a.volume = from.get(a) * (1 - k); if (k >= 1 && !a.paused) a.pause(); });
      if (next) next.volume = from.get(next) + (MUSIC_VOL - from.get(next)) * k;
      if (k < 1) fadeRaf = requestAnimationFrame(step);
    };
    fadeRaf = requestAnimationFrame(step);
    current = next ? key : null;
  }

  function music(key) {
    want = key;
    if (key === current && !muted) return;
    fadeTo(key);
  }

  function setMuted(m) {
    muted = !!m;
    localStorage.setItem(KEY, muted ? "1" : "0");
    if (muted) { fadeTo(null); } else { current = null; fadeTo(want); }
    document.dispatchEvent(new CustomEvent("llc:mute", { detail: { muted } }));
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    Object.keys(SFX).forEach(pool);
    if (want) { current = null; fadeTo(want); }
  }
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, unlock, { capture: true, passive: true }));

  global.LLCAudio = {
    play, music, setMuted,
    get muted() { return muted; },
    get unlocked() { return unlocked; },
    get current() { return current; },
    get playing() { return Object.keys(tracks).filter((k) => !tracks[k].paused && tracks[k].currentTime > 0); },
  };
})(window);
