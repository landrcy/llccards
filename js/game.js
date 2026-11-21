/* LLC Cards game shell: title, map, shop, pack opening, binder. */
(function () {
  const $ = (id) => document.getElementById(id);
  const ASSET_V = "9"; window.LLC_ASSET_V = ASSET_V;
  const reduced = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const screens = {
    title: $("screen-title"),
    map: $("screen-map"),
    shop: $("screen-shop"),
    opening: $("screen-opening"),
    binder: $("screen-binder"),
    arena: $("screen-arena"),
    duel: $("screen-duel"),
  };

  let lastScreen = "map";
  let currentScreen = null;
  let opening = null; // { pulls, index, phase, busy, queued }

  /* ---------- no blue-highlight / no text-select ---------- */
  document.addEventListener("selectstart", (e) => e.preventDefault());
  document.addEventListener("dragstart", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault());

  /* ---------- screens: one quick fade, no wipes ---------- */
  function fadeScreens(name) {
    Object.keys(screens).forEach((k) => {
      screens[k].classList.toggle("active", k === name);
    });
  }

  async function show(name, opts) {
    opts = opts || {};
    if (name === currentScreen && !opts.force) {
      if (name === "binder") renderBinder();
      return;
    }
    const prev = currentScreen;
    if (name === "binder") renderBinder();
    fadeScreens(name);
    currentScreen = name;
    if (name !== "opening" && name !== "binder" && name !== "duel") lastScreen = name;
    if (name === "binder" && prev === "opening") lastScreen = "shop";
    window.scrollTo(0, 0);
    document.body.classList.toggle("in-duel", name === "duel");
    if (window.LLCAudio) LLCAudio.music(name === "duel" ? "battle" : "map");
    document.dispatchEvent(new CustomEvent("llc:screen", { detail: { name, prev } }));
  }

  function wait(ms) {
    if (reduced()) ms = Math.min(ms, 80);
    return new Promise((res) => setTimeout(res, ms));
  }

  /* ---------- map hotspots ---------- */
  function placeHotspots() {
    const fallback = {
      shop: { x: 0.184, y: 0.280, w: 0.322, h: 0.397 },
      battle: { x: 0.546, y: 0.227, w: 0.292, h: 0.450 },
      play: { x: 0.583, y: 0.695, w: 0.217, h: 0.105 },
    };
    const apply = (el, b) => {
      el.style.left = (b.x * 100) + "%";
      el.style.top = (b.y * 100) + "%";
      el.style.width = (b.w * 100) + "%";
      el.style.height = (b.h * 100) + "%";
    };
    const go = (hs) => {
      apply($("hot-shop"), hs.shop);
      apply($("hot-battle"), hs.battle);
      if (hs.play) apply($("hot-play"), hs.play);
    };
    fetch("assets/map_hotspots.json?v=" + ASSET_V)
      .then((r) => r.json())
      .then(go)
      .catch(() => go(fallback));
  }

  /* ---------- fullscreen map: nearest-neighbour scale, edges extended ----------
     The drawing scales by whole art pixels (MAP_UNIT source px) to the largest
     size that fits, on white paper that runs to every window edge. */
  const MAP_UNIT = 4;
  const MAP_CONTENT = { x0: 0.085, x1: 0.93, y0: 0.02, y1: 0.95 }; // inked bounds of Finley's drawing
  function drawMap() {
    const img = $("map-src"), cv = $("map-canvas"), stage = $("map-stage"), wrap = $("map-wrap");
    if (!img || !img.complete || !img.naturalWidth || !wrap.clientWidth) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    // fit the inked part of the drawing (its white margins are just paper and may run off-screen)
    const C = MAP_CONTENT, cw = (C.x1 - C.x0) * iw, ch = (C.y1 - C.y0) * ih;
    const tb = document.querySelector("#screen-map .topbar");
    const top = tb ? Math.round(tb.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top) : 0;
    const AH = H - Math.max(0, top) - 8;
    const fit = Math.min(W / cw, AH / ch);
    const step = 1 / MAP_UNIT;
    const s = fit >= step * 2 ? Math.floor(fit / step) * step : fit;
    const dw = Math.round(iw * s), dh = Math.round(ih * s);
    const ox = Math.round(W / 2 - (C.x0 + C.x1) / 2 * dw), oy = Math.round(Math.max(0, top) + 4 + AH / 2 - (C.y0 + C.y1) / 2 * dh);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    // the drawing sits on white paper, so the margins are simply more paper
    g.drawImage(img, 0, 0, iw, ih, ox, oy, dw, dh);
    Object.assign(stage.style, { left: ox + "px", top: oy + "px", width: dw + "px", height: dh + "px" });
  }
  window.addEventListener("resize", () => { if (currentScreen === "map") drawMap(); });
  document.addEventListener("llc:screen", (e) => { if (e.detail.name === "map") requestAnimationFrame(drawMap); });
  $("map-src").addEventListener("load", drawMap);

  /* ---------- binder ---------- */
  function renderBinder() {
    const page = $("binder-page");
    page.innerHTML = "";
    const data = LLCStorage.load().edition_one;
    let owned = 0;
    LLCData.CARDS.forEach((card) => {
      const rec = data[card.id];
      const slot = document.createElement("div");
      slot.className = "binder-slot" + (rec && rec.owned ? "" : " empty");
      if (rec && rec.owned) {
        owned++;
        const el = LLCFoil.createCard(card, { foil: !!rec.foil, face: "front" });
        el.classList.add("sm");
        slot.appendChild(el);
      } else {
        const q = document.createElement("div");
        q.className = "q";
        q.textContent = "?";
        slot.appendChild(q);
      }
      page.appendChild(slot);
    });
    $("binder-count").textContent = owned + " / " + LLCData.CARDS.length;
  }

  function confirmReset() {
    if (!confirm("Reset your Edition One collection?")) return;
    LLCStorage.reset();
    if (screens.binder.classList.contains("active")) renderBinder();
  }

  /* ---------- pack opening: one pile, seen cards slide to the side ---------- */
  function hideBadges() {
    const neu = $("new-pop");
    const foil = $("foil-tag");
    neu.hidden = true;
    neu.classList.remove("show", "hold");
    foil.hidden = true;
    foil.classList.remove("show", "hold");
  }

  function clearOpening() {
    const stack = $("card-stack");
    stack.innerHTML = "";
    stack.hidden = true;
    $("badge-row").hidden = true;
    hideBadges();
    $("pack-live").hidden = true;
    $("pack-rip").hidden = true;
    $("pack-rip").classList.remove("ripping");
    $("pack-live").classList.remove("shaking");
    $("pack-live-img").hidden = false;
    $("scraps").innerHTML = "";
    $("fly-target").classList.remove("visible");
    $("opening-caption").textContent = "";
    const ripTop = $("pack-rip").querySelector(".rip-top");
    const ripBot = $("pack-rip").querySelector(".rip-bottom");
    if (ripTop) { ripTop.style.animation = ""; ripTop.style.transform = ""; }
    if (ripBot) { ripBot.style.animation = ""; ripBot.style.transform = ""; }
    document.querySelectorAll(".llc-card.flying").forEach((el) => el.remove());
    opening = null;
  }

  /* remaining[0] is the top of the pile */
  function layoutPile(remaining) {
    const n = remaining.length;
    remaining.forEach((el, k) => {
      const rot = [0, -2.5, 2, -1.5, 3][k % 5];
      el.style.transform = "translate(" + (k * -3) + "px, " + (k * 5) + "px) rotate(" + rot + "deg)";
      el.style.zIndex = String(100 + n - k);
    });
  }

  function sideTransform(el, j) {
    const cardW = el.offsetWidth || 300;
    const vw = window.innerWidth;
    const k = vw < 600 ? 0.42 : 0.55;
    const ideal = cardW / 2 + (k * cardW) / 2 + 28;
    const maxDx = vw / 2 - 10 - (k * cardW) / 2;
    const dx = Math.max(40, Math.min(ideal, maxDx));
    return "translate(" + (-dx + j * 4) + "px, " + (j * 6 - 10) + "px) rotate(" + (-7 + j * 2.5) + "deg) scale(" + k + ")";
  }

  function spawnScraps() {
    const box = $("scraps");
    box.innerHTML = "";
    if (reduced()) return;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const img = document.createElement("img");
      img.className = "scrap";
      img.src = "assets/ui/scrap_" + (i % 4) + ".png?v=" + ASSET_V;
      img.alt = "";
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = 110 + Math.random() * 90;
      img.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      img.style.setProperty("--dy", Math.sin(angle) * dist * 0.8 - 30 + "px");
      img.style.setProperty("--r0", (Math.random() * 40 - 20) + "deg");
      img.style.setProperty("--r1", (80 + Math.random() * 200) + "deg");
      img.style.animationDelay = (i * 14) + "ms";
      box.appendChild(img);
    }
  }

  async function startOpening() {
    clearOpening();
    const raw = LLCData.pullPack();
    const pulls = LLCStorage.addPulls(raw);
    opening = { pulls, index: 0, phase: "pack", busy: true, queued: false, flipped: false, stackEls: [], seen: [] };
    await show("opening");
    const pack = $("pack-live");
    pack.hidden = false;
    $("opening-caption").textContent = "";
    if (!reduced()) {
      pack.classList.add("shaking");
      LLCAudio.play("shake");
      await wait(720);
      pack.classList.remove("shaking");
    }
    await ripAndDeal();
  }

  async function ripAndDeal() {
    if (!opening) return;
    const pack = $("pack-live");
    const rip = $("pack-rip");
    if (!reduced()) {
      $("pack-live-img").hidden = true;
      rip.hidden = false;
      void rip.offsetWidth;
      rip.classList.add("ripping");
      LLCAudio.play("rip");
      spawnScraps();
      await wait(820);
      rip.hidden = true;
      $("scraps").innerHTML = "";
    }
    pack.hidden = true;

    const stack = $("card-stack");
    stack.hidden = false;
    $("badge-row").hidden = false;
    stack.innerHTML = "";
    opening.stackEls = opening.pulls.map((p) => {
      const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "back" });
      el.classList.add("lg", "is-back");
      el.style.opacity = "0";
      el.style.transform = "translateY(24px)";
      stack.appendChild(el);
      return el;
    });
    await wait(20);
    layoutPile(opening.stackEls);
    opening.stackEls.forEach((el) => {
      el.style.transition = "transform 0.32s cubic-bezier(0.22, 1.2, 0.32, 1), opacity 0.2s linear";
      el.style.opacity = "1";
    });
    await wait(reduced() ? 60 : 340);
    opening.phase = "stack";
    opening.busy = false;
    $("opening-caption").textContent = "tap to flip  ·  1 / " + opening.pulls.length;
    if (opening.queued) { opening.queued = false; tapOpening(); }
  }

  async function flipTop() {
    const i = opening.index;
    const p = opening.pulls[i];
    const el = opening.stackEls[i];
    hideBadges();
    LLCFoil.flip(el, true);
    if (opening.phase !== "pack") LLCAudio.play("flip");
    el.classList.add("just-flipped");
    setTimeout(() => el.classList.remove("just-flipped"), 520);
    $("opening-caption").textContent = (i + 1) + " / " + opening.pulls.length + "  ·  " + p.card.name;
    await wait(reduced() ? 40 : 300);
    if (p.foil) {
      $("foil-tag").hidden = false;
      $("foil-tag").classList.add("show");
      el.classList.add("sweeping");
      LLCAudio.play("foil");
    }
    if (p.wasNew) {
      $("new-pop").hidden = false;
      void $("new-pop").offsetWidth;
      $("new-pop").classList.add("show");
      LLCAudio.play("new");
    }
    await wait(reduced() ? 40 : 160);
    opening.phase = "hold";
    const last = i + 1 === opening.pulls.length;
    $("opening-caption").textContent = (last ? "tap to file into the binder" : "tap for the next card") +
      "  ·  " + (i + 1) + " / " + opening.pulls.length;
  }

  function slideAside() {
    const el = opening.stackEls[opening.index];
    el.classList.remove("sweeping", "just-flipped");
    const j = opening.seen.length;
    if (opening.phase !== "pack") LLCAudio.play("slide");
    opening.seen.push(el);
    el.style.transition = reduced() ? "none" : "transform 0.36s cubic-bezier(0.3, 0.9, 0.3, 1)";
    el.style.zIndex = String(10 + j);
    el.style.transform = sideTransform(el, j);
    opening.index += 1;
    layoutPile(opening.stackEls.slice(opening.index));
  }

  async function tapOpening() {
    if (!opening) return;
    if (opening.phase === "done" || opening.phase === "fly" || opening.phase === "shot") return;
    if (opening.busy || opening.phase === "pack") { opening.queued = true; return; }
    opening.busy = true;
    if (opening.phase === "stack") {
      await flipTop();
    } else if (opening.phase === "hold") {
      hideBadges();
      slideAside();
      if (opening.index >= opening.pulls.length) {
        await wait(reduced() ? 40 : 260);
        await flyToBinder();
        return;
      }
      await flipTop();
    }
    opening.busy = false;
    if (opening.queued) { opening.queued = false; tapOpening(); }
  }

  function flyArc(el, from, to, duration) {
    el.classList.add("flying");
    el.style.transition = "none";
    el.style.position = "fixed";
    el.style.left = from.left + "px";
    el.style.top = from.top + "px";
    el.style.setProperty("--card-w", from.width + "px");
    el.style.setProperty("--card-h", from.height + "px");
    el.style.margin = "0";
    el.style.zIndex = "50";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
    const x1 = to.left + to.width / 2 - from.width / 2 - from.left;
    const y1 = to.top + to.height / 2 - from.height / 2 - from.top;
    const cx = x1 * 0.5;
    const cy = Math.min(y1 * 0.35, 0) - 120;
    const start = performance.now();
    return new Promise((res) => {
      function frame(t) {
        const p = Math.min(1, (t - start) / duration);
        const e = 1 - Math.pow(1 - p, 3);
        const x = 2 * (1 - e) * e * cx + e * e * x1;
        const y = 2 * (1 - e) * e * cy + e * e * y1;
        const s = 1 - e * 0.8;
        el.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ") rotate(" + (e * 16 - 6) + "deg)";
        el.style.opacity = String(p < 0.75 ? 1 : 1 - (p - 0.75) * 4);
        if (p < 1) requestAnimationFrame(frame);
        else { el.remove(); LLCAudio.play("thump", 0.8); res(); }
      }
      requestAnimationFrame(frame);
    });
  }

  async function flyToBinder() {
    opening.phase = "fly";
    $("opening-caption").textContent = "";
    hideBadges();
    const target = $("fly-target");
    target.classList.add("visible");
    if (reduced()) {
      await wait(120);
    } else {
      const tr = target.getBoundingClientRect();
      const els = opening.seen.slice().reverse();
      const rects = els.map((el) => el.getBoundingClientRect());
      const jobs = els.map((el, i) => wait(i * 110).then(() => flyArc(el, rects[i], tr, 520)));
      await Promise.all(jobs);
    }
    target.classList.remove("visible");
    opening.phase = "done";
    await show("binder");
    clearOpening();
  }

  /* ---------- sound ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button");
    if (b && !b.disabled && b.id !== "btn-mute") LLCAudio.play("click");
  }, true);
  function paintMute() {
    const m = LLCAudio.muted;
    $("btn-mute").querySelector("img").src = "assets/ui/" + (m ? "sound_off" : "sound_on") + ".png";
    $("btn-mute").setAttribute("aria-label", m ? "Sound off. Turn on" : "Sound on. Turn off");
  }
  $("btn-mute").addEventListener("click", (e) => { e.stopPropagation(); LLCAudio.setMuted(!LLCAudio.muted); });
  document.addEventListener("llc:mute", paintMute);
  paintMute();
  $("btn-credits").addEventListener("click", () => $("modal-credits").classList.add("open"));
  $("btn-credits-ok").addEventListener("click", () => $("modal-credits").classList.remove("open"));
  $("modal-credits").addEventListener("click", (e) => { if (e.target === $("modal-credits")) $("modal-credits").classList.remove("open"); });

  /* ---------- interactions ---------- */
  $("screen-title").addEventListener("click", () => show("map"));
  $("screen-title").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show("map"); }
  });

  $("hot-shop").addEventListener("click", () => show("shop"));
  $("hot-battle").addEventListener("click", () => show("arena"));
  $("hot-play").addEventListener("click", () => show("arena"));

  $("btn-shop-back").addEventListener("click", () => show("map"));
  $("btn-map-binder").addEventListener("click", () => show("binder"));
  $("btn-shop-binder").addEventListener("click", () => show("binder"));
  $("btn-binder-back").addEventListener("click", () => show(lastScreen || "shop"));

  $("btn-reset").addEventListener("click", confirmReset);
  $("btn-reset-binder").addEventListener("click", confirmReset);

  $("pack-e1").addEventListener("click", () => startOpening());
  $("pack-locked-a").addEventListener("click", () => alert("Coming soon."));
  $("pack-locked-b").addEventListener("click", () => alert("Coming soon."));

  $("opening-stage").addEventListener("click", () => tapOpening());
  $("opening-stage").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapOpening(); }
  });

  /* ---------- debug / screenshot staging ---------- */
  function seedCollectionForShot() {
    const data = LLCStorage.empty();
    const foilIds = new Set(["stick_runner", "lord_of_lines", "erase"]);
    const owned = ["dot_dummy", "stick_runner", "erase", "quick_sketch", "box_knight", "lord_of_lines"];
    owned.forEach((id) => {
      data.edition_one[id] = { owned: true, foil: foilIds.has(id) };
    });
    LLCStorage.save(data);
  }

  async function stageShot(name) {
    document.body.classList.add("shot");
    if (name === "title") { await show("title", { instant: true }); return; }
    if (name === "map") { await show("map", { instant: true }); return; }
    if (name === "shop") { await show("shop", { instant: true }); return; }
    if (name === "arena") { await show("arena", { instant: true }); return; }
    if (name === "binder") {
      seedCollectionForShot();
      await show("binder", { instant: true });
      return;
    }

    LLCStorage.reset();
    if (name === "opening" || name === "mid" || name === "new" || name === "foil") {
      await show("opening", { instant: true });
      const picks = [
        { id: "dot_dummy", foil: name === "foil" || LLCData.forceFoil() },
        { id: "lord_of_lines", foil: true },
        { id: "erase", foil: false },
        { id: "smudge", foil: false },
        { id: "squiggle_worm", foil: LLCData.forceFoil() },
      ].map((p) => ({ id: p.id, card: LLCData.BY_ID[p.id], foil: p.foil }));
      const pulls = LLCStorage.addPulls(picks);
      opening = { pulls, index: 0, phase: "pack", busy: false, queued: false, stackEls: [], seen: [] };

      if (name === "opening") {
        const pack = $("pack-live");
        pack.hidden = false;
        $("pack-live-img").hidden = true;
        const rip = $("pack-rip");
        rip.hidden = false;
        rip.classList.add("ripping");
        rip.querySelector(".rip-top").style.animation = "none";
        rip.querySelector(".rip-bottom").style.animation = "none";
        rip.querySelector(".rip-top").style.transform = "translateY(-22%) rotate(-6deg)";
        rip.querySelector(".rip-bottom").style.transform = "translateY(14%) rotate(4deg)";
        spawnScraps();
        $("scraps").querySelectorAll(".scrap").forEach((s, i) => {
          s.style.animation = "none";
          s.style.opacity = "1";
          const angle = (i / 12) * Math.PI * 2;
          s.style.transform = "translate(-50%,-50%) translate(" + (Math.cos(angle) * 120) + "px," + (Math.sin(angle) * 100 - 20) + "px) rotate(" + (i * 28) + "deg)";
        });
        /* Keep the mid-rip still centered: do not also show the card stack. */
        $("card-stack").hidden = true;
        $("opening-caption").textContent = "";
        opening.phase = "shot";
        return;
      }

      /* pile staged: "mid" = two seen cards at the side, third flipped on top */
      opening.phase = "pack";
      opening.busy = true;
      opening.seen = [];
      $("pack-live").hidden = true;
      const stack = $("card-stack");
      stack.hidden = false;
      $("badge-row").hidden = false;
      stack.innerHTML = "";
      opening.stackEls = pulls.map((p) => {
        const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "back" });
        el.classList.add("lg", "is-back");
        stack.appendChild(el);
        return el;
      });
      layoutPile(opening.stackEls);
      const ahead = name === "mid" ? 2 : name === "foil" ? 1 : 0;
      for (let k = 0; k < ahead; k++) { LLCFoil.flip(opening.stackEls[k], true); slideAside(); }
      await flipTop();
      if (opening.pulls[opening.index].wasNew) { $("new-pop").classList.add("hold"); $("new-pop").classList.remove("show"); }
      if (opening.pulls[opening.index].foil) { $("foil-tag").classList.add("hold"); $("foil-tag").classList.remove("show"); }
      freezeTilt();
      opening.phase = "shot";
    }
  }

  function freezeTilt() {
    document.querySelectorAll(".llc-card").forEach((el) => {
      el._foilIdle = () => false;
      LLCFoil.setVars(el, 34, 42, false);
    });
  }

  /* ---------- boot ---------- */
  placeHotspots();
  LLCFoil.startIdle();

  const q = LLCData.params();
  const shot = q.get("shot");
  const screen = q.get("screen");
  if (shot) {
    stageShot(shot);
  } else if (screen && screens[screen]) {
    show(screen, { instant: true });
  } else {
    show("title", { instant: true });
  }

  window.LLC = {
    show, startOpening, renderBinder, confirmReset, stageShot, tapOpening,
    get screen() { return currentScreen; },
    get opening() { return opening; },
  };
})();
