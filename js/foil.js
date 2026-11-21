/* Reusable whole-card foil. Tone down ~20% from the mockup. Only color in the game. */
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

  const live = new Set();

  function bind(el) {
    if (!el || el._foilBound) return el;
    el._foilBound = true;
    if (!el.classList.contains("is-foil")) return el;
    setVars(el, 34, 40, false);
    if (reduced()) return el;

    let idle = true;
    function onMove(e) {
      idle = false;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      setVars(el, x, y, true);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", () => { idle = true; });
    el.addEventListener("pointerdown", (e) => {
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el._foilIdle = () => idle;
    live.add(el);
    return el;
  }

  function unbind(el) {
    live.delete(el);
  }

  let raf = 0;
  function tick(t) {
    if (reduced()) return;
    live.forEach((el) => {
      if (!el.isConnected) { live.delete(el); return; }
      if (el._foilIdle && el._foilIdle() === false) return;
      const a = t / 2800;
      const x = 50 + Math.cos(a) * 32;
      const y = 50 + Math.sin(a * 0.85) * 26;
      setVars(el, x, y, true);
    });
    raf = requestAnimationFrame(tick);
  }

  function startIdle() {
    if (reduced()) return;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function createCard(card, opts) {
    opts = opts || {};
    const foil = !!opts.foil;
    const face = opts.face || "front";
    const el = document.createElement("div");
    el.className = "llc-card" + (foil ? " is-foil" : "") + (face === "back" ? " is-back" : "");
    el.dataset.id = card.id;
    const alt = card.name || card.id;
    const v = (window.LLC_ASSET_V || "8");
    const mask = 'url("assets/masks/' + card.id + '.png?v=' + v + '")';
    el.style.setProperty("--card-mask", mask);
    el.innerHTML =
      '<div class="llc-card-3d">' +
        '<div class="face front">' +
          '<img class="print" src="assets/cards/' + card.id + '.png?v=' + v + '" alt="' + alt + '" draggable="false">' +
          '<div class="foil" aria-hidden="true"></div>' +
          '<div class="glare" aria-hidden="true"></div>' +
          '<div class="foil-sweep" aria-hidden="true"></div>' +
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
      bind(el);
    }
    startIdle();
    return el;
  }

  function flip(el, showFront) {
    if (showFront) el.classList.remove("is-back");
    else el.classList.add("is-back");
  }

  global.LLCFoil = { bind, unbind, createCard, flip, setVars, startIdle, reduced, clamp };
})(window);
