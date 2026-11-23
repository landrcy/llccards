/* Reusable card holo. Every rarity above Common has its own holo that follows the pointer / idle tilt:
   R = silver stripes, SR = rainbow + sparkles (full-art colour card), SCR = prismatic "secret" shimmer.
   Commons only shine when they are a foil pull. */
(function (global) {
  const reduced = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function setVars(el, x, y, tilt) {
    const px = clamp(x, 0, 100), py = clamp(y, 0, 100);
    const hyp = clamp(Math.hypot(px - 50, py - 50) / 50, 0, 1);
    el.style.setProperty("--pointer-x", px + "%");
    el.style.setProperty("--pointer-y", py + "%");
    el.style.setProperty("--background-x", px + "%");
    el.style.setProperty("--background-y", py + "%");
    el.style.setProperty("--pointer-from-center", hyp.toFixed(3));
    if (tilt && !reduced()) {
      const rx = ((py - 50) / 50) * -12;
      const ry = ((px - 50) / 50) * 14;
      el.style.setProperty("--rotate-x", rx.toFixed(2) + "deg");
      el.style.setProperty("--rotate-y", ry.toFixed(2) + "deg");
    } else {
      el.style.setProperty("--rotate-x", "0deg");
      el.style.setProperty("--rotate-y", "0deg");
    }
  }

  /* Pointer-follow tilt for EVERY card (smooth, time-based, eases back to flat on leave).
     The shine layers only exist on holo / foil cards; foils also drift on an idle loop. */
  const live = new Set();
  const TILT_X = 12, TILT_Y = 14;

  function bind(el) {
    if (!el || el._foilBound) return el;
    el._foilBound = true;
    const foil = el.classList.contains("is-foil");
    const st = { x: 50, y: 50, cx: 50, cy: 50, tx: 50, ty: 50, hover: false, foil, tilt: 0, ttilt: 0 };
    el._tilt = st;
    setVars(el, foil ? 34 : 50, foil ? 40 : 50, false);
    if (reduced()) return el;
    function onMove(e) {
      if (e.pointerType === "touch" && !foil) return;      // touch: commons stay flat so scrolling feels normal
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      st.hover = true;
      st.tx = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
      st.ty = clamp(((e.clientY - r.top) / r.height) * 100, 0, 100);
      st.ttilt = 1;
      wake();
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerenter", onMove);
    el.addEventListener("pointerleave", () => { st.hover = false; st.tx = 50; st.ty = 50; st.ttilt = foil ? 1 : 0; wake(); });
    el._foilIdle = () => !st.hover;
    live.add(el);
    wake();
    return el;
  }

  function unbind(el) { live.delete(el); }

  function apply(el, st) {
    const px = st.cx, py = st.cy;
    const hyp = clamp(Math.hypot(px - 50, py - 50) / 50, 0, 1);
    el.style.setProperty("--pointer-x", px.toFixed(2) + "%");
    el.style.setProperty("--pointer-y", py.toFixed(2) + "%");
    el.style.setProperty("--background-x", px.toFixed(2) + "%");
    el.style.setProperty("--background-y", py.toFixed(2) + "%");
    el.style.setProperty("--pointer-from-center", hyp.toFixed(3));
    const k = st.tilt;
    el.style.setProperty("--rotate-x", (((py - 50) / 50) * -TILT_X * k).toFixed(2) + "deg");
    el.style.setProperty("--rotate-y", (((px - 50) / 50) * TILT_Y * k).toFixed(2) + "deg");
  }

  let raf = 0, last = 0;
  function tick(t) {
    raf = 0;
    if (reduced()) return;
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    const f = 1 - Math.exp(-dt * 10);              // frame-rate independent easing
    let busy = false;
    live.forEach((el) => {
      if (!el.isConnected) { live.delete(el); return; }
      const st = el._tilt;
      if (!st) return;
      if (st.foil && !st.hover) {                  // holo idle drift
        const a = t / 2800;
        st.tx = 50 + Math.cos(a) * 32; st.ty = 50 + Math.sin(a * 0.85) * 26; st.ttilt = 1;
      }
      const dx = st.tx - st.cx, dy = st.ty - st.cy, dk = st.ttilt - st.tilt;
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 && Math.abs(dk) < 0.002 && !st.foil) return;
      st.cx += dx * f; st.cy += dy * f; st.tilt += dk * f;
      apply(el, st);
      busy = true;
    });
    if (busy) raf = requestAnimationFrame(tick); else last = 0;
  }
  function wake() { if (!raf && !reduced()) raf = requestAnimationFrame(tick); }
  function startIdle() { wake(); }

  function createCard(card, opts) {
    opts = opts || {};
    const rar = card.rarity || "C";
    const foil = !!opts.foil || rar !== "C";
    const face = opts.face || "front";
    const el = document.createElement("div");
    el.className = "llc-card rar-" + rar + (foil ? " is-foil" : "") + (opts.foil ? " foil-pull" : "") + (face === "back" ? " is-back" : "");
    el.dataset.id = card.id;
    const alt = card.name || card.id;
    const v = (window.LLC_ASSET_V || "13");
    const mask = 'url("assets/masks/' + card.id + '.png?v=' + v + '")';
    el.style.setProperty("--card-mask", mask);
    el.innerHTML =
      '<div class="llc-card-3d">' +
        '<div class="face front">' +
          '<img class="print" src="assets/cards/' + card.id + '.png?v=' + v + '" alt="' + alt + '" draggable="false">' +
          ((rar === "SCR" && card.set === "edition_two") ? "<div class=\"scr-anim\" style=\"background-image:url(assets/anim/" + card.id + ".png?v=" + v + ")\" aria-hidden=\"true\"></div>" : "") +
          '<div class="foil" aria-hidden="true"></div>' +
          '<div class="glare" aria-hidden="true"></div>' +
          '<div class="foil-sweep" aria-hidden="true"></div>' +
          (rar === "SR" || rar === "SCR" ? '<div class="sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : "") +
        "</div>" +
        '<div class="face back">' +
          '<img src="assets/card_back.png?v=' + v + '" alt="" draggable="false">' +
        "</div>" +
      "</div>";
    if (foil) {
      el.querySelectorAll(".foil, .glare, .foil-sweep").forEach((n) => {
        n.style.webkitMaskImage = mask;
        n.style.maskImage = mask;
        n.style.webkitMaskSize = "100% 100%";
        n.style.maskSize = "100% 100%";
        n.style.webkitMaskRepeat = "no-repeat";
        n.style.maskRepeat = "no-repeat";
      });
    }
    bind(el);
    return el;
  }

  function flip(el, showFront) {
    if (showFront) el.classList.remove("is-back");
    else el.classList.add("is-back");
  }

  global.LLCFoil = { bind, unbind, createCard, flip, setVars, startIdle, reduced, clamp };
})(window);
