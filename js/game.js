/* LLC Cards game shell: title, map, shop, pack opening, binder. */
(function () {
  const $ = (id) => document.getElementById(id);
  const ASSET_V = "4";
  const reduced = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const screens = {
    title: $("screen-title"),
    map: $("screen-map"),
    shop: $("screen-shop"),
    opening: $("screen-opening"),
    binder: $("screen-binder"),
  };

  let lastScreen = "map";
  let currentScreen = null;
  let transitioning = false;
  let opening = null; // { pulls, index, phase, busy, queued }

  /* ---------- no blue-highlight / no text-select ---------- */
  document.addEventListener("selectstart", (e) => e.preventDefault());
  document.addEventListener("dragstart", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault());

  /* ---------- pixel wipe ---------- */
  const wipe = $("wipe");
  (function buildWipe() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 20 * 12; i++) {
      const c = document.createElement("div");
      c.className = "cell";
      const col = i % 20;
      const row = Math.floor(i / 20);
      const delay = (col * 10 + row * 6) + "ms";
      c.style.animationDelay = delay;
      frag.appendChild(c);
    }
    wipe.appendChild(frag);
  })();

  function playWipe(dir) {
    if (reduced() || document.body.classList.contains("shot")) {
      return Promise.resolve();
    }
    return new Promise((res) => {
      wipe.classList.remove("out", "in");
      wipe.classList.add("on", dir);
      const ms = 260 + 20 * 10 + 12 * 6 + 30;
      setTimeout(() => {
        if (dir === "in") wipe.classList.remove("on", "in", "out");
        res();
      }, ms);
    });
  }

  function fadeScreens(name) {
    Object.keys(screens).forEach((k) => {
      screens[k].classList.toggle("active", k === name);
    });
  }

  async function show(name, opts) {
    opts = opts || {};
    const instant = opts.instant || document.body.classList.contains("shot") || reduced();
    if (name === currentScreen && !opts.force) {
      if (name === "binder") renderBinder();
      return;
    }
    if (transitioning && !instant) return;
    transitioning = !instant;

    if (!instant && currentScreen) {
      await playWipe("out");
    } else if (instant && reduced() && currentScreen && !document.body.classList.contains("shot")) {
      /* short fade under reduced motion */
      document.body.style.opacity = "0.35";
      await wait(80);
      document.body.style.opacity = "";
    }

    fadeScreens(name);
    const prev = currentScreen;
    currentScreen = name;
    if (name !== "opening") lastScreen = name === "binder" ? (prev === "opening" ? lastScreen : (prev || lastScreen)) : name;

    const book = $("binder-book");
    book.classList.remove("open", "opened");
    if (name === "binder") {
      renderBinder();
      if (instant) {
        book.classList.add("opened");
      } else {
        void book.offsetWidth;
        book.classList.add("open");
        setTimeout(() => {
          book.classList.add("opened");
          book.classList.remove("open");
        }, reduced() ? 0 : 820);
      }
    }

    if (!instant && prev) {
      await playWipe("in");
    }
    transitioning = false;
  }

  function wait(ms) {
    if (reduced()) ms = Math.min(ms, 80);
    return new Promise((res) => setTimeout(res, ms));
  }

  /* ---------- map hotspots ---------- */
  function placeHotspots() {
    const fallback = {
      shop: { x: 0.121, y: 0.267, w: 0.398, h: 0.386 },
      battle: { x: 0.574, y: 0.188, w: 0.336, h: 0.568 },
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
    };
    fetch("assets/map_hotspots.json?v=" + ASSET_V)
      .then((r) => r.json())
      .then(go)
      .catch(() => go(fallback));
  }

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

  /* ---------- pack opening ---------- */
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
    const revealCard = $("reveal-card");
    stack.innerHTML = "";
    if (revealCard) revealCard.innerHTML = "";
    stack.hidden = true;
    $("reveal-wrap").hidden = true;
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
    opening = null;
  }

  function layoutStack(stack, cards) {
    const n = cards.length;
    cards.forEach((el, i) => {
      const fromTop = n - 1 - i;
      const rot = (i - (n - 1) / 2) * 3.2;
      el.style.transform = "translate(" + (fromTop * -4) + "px, " + (fromTop * 7) + "px) rotate(" + rot + "deg)";
      el.style.zIndex = String(10 + i);
    });
  }

  function spawnScraps() {
    const box = $("scraps");
    box.innerHTML = "";
    if (reduced()) return;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const img = document.createElement("img");
      img.className = "scrap";
      img.src = "assets/ui/scrap_" + (i % 4) + ".png?v=" + ASSET_V;
      img.alt = "";
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = 70 + Math.random() * 70;
      img.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      img.style.setProperty("--dy", Math.sin(angle) * dist - 20 + "px");
      img.style.setProperty("--r0", (Math.random() * 40 - 20) + "deg");
      img.style.setProperty("--r1", (80 + Math.random() * 200) + "deg");
      img.style.animationDelay = (i * 18) + "ms";
      box.appendChild(img);
    }
  }

  async function startOpening() {
    clearOpening();
    const raw = LLCData.pullPack();
    const pulls = LLCStorage.addPulls(raw);
    opening = { pulls, index: 0, phase: "pack", busy: true, queued: false };
    await show("opening");

    const pack = $("pack-live");
    pack.hidden = false;
    $("opening-caption").textContent = "tap the pack";
    if (reduced()) {
      await wait(60);
      await ripAndDeal();
      return;
    }
    pack.classList.add("shaking");
    $("opening-caption").textContent = "";
    await wait(920);
    pack.classList.remove("shaking");
    await ripAndDeal();
  }

  async function ripAndDeal() {
    if (!opening) return;
    const pack = $("pack-live");
    const rip = $("pack-rip");
    if (reduced()) {
      pack.hidden = true;
    } else {
      $("pack-live-img").hidden = true;
      rip.hidden = false;
      void rip.offsetWidth;
      rip.classList.add("ripping");
      spawnScraps();
      await wait(900);
      pack.hidden = true;
      rip.hidden = true;
      $("scraps").innerHTML = "";
    }

    const stack = $("card-stack");
    stack.hidden = false;
    stack.innerHTML = "";
    opening.stackEls = [];
    opening.pulls.forEach((p) => {
      const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "back" });
      el.classList.add("lg", "is-back");
      el.style.opacity = "0";
      el.style.transform = "translateY(28px) scale(0.92)";
      stack.appendChild(el);
      opening.stackEls.push(el);
    });
    /* Cards slide into a peek stack with a little bounce. */
    await wait(30);
    layoutStack(stack, opening.stackEls);
    opening.stackEls.forEach((el, i) => {
      el.style.transition = reduced()
        ? "opacity 0.15s linear"
        : "transform 0.45s cubic-bezier(0.22, 1.25, 0.32, 1) " + (i * 50) + "ms, opacity 0.3s ease " + (i * 50) + "ms";
      el.style.opacity = "1";
    });
    await wait(reduced() ? 80 : 450 + opening.stackEls.length * 50);
    opening.phase = "stack";
    opening.busy = false;
    $("opening-caption").textContent = "tap to flip  ·  1 / " + opening.pulls.length;
    if (opening.queued) {
      opening.queued = false;
      revealNext();
    }
  }

  async function revealNext() {
    if (!opening) return;
    if (opening.phase === "done" || opening.phase === "fly" || opening.phase === "pack") return;
    if (opening.busy) {
      opening.queued = true;
      return;
    }
    if (opening.phase === "hold") {
      await advanceFromHold();
      return;
    }
    if (opening.phase !== "stack" && opening.phase !== "ready") return;
    opening.busy = true;
    opening.queued = false;

    const i = opening.index;
    const p = opening.pulls[i];
    const stack = $("card-stack");
    const wrap = $("reveal-wrap");
    const holder = $("reveal-card");
    const el = opening.stackEls[i];

    stack.hidden = true;
    wrap.hidden = false;
    holder.innerHTML = "";
    hideBadges();
    el.style.transition = "";
    el.style.transform = "translateY(18px) scale(0.96)";
    el.style.opacity = "1";
    el.style.zIndex = "15";
    holder.appendChild(el);
    await wait(20);
    el.style.transition = reduced()
      ? "transform 0.12s linear"
      : "transform 0.35s cubic-bezier(0.22, 1.2, 0.32, 1)";
    el.style.transform = "translateY(0) scale(1)";
    await wait(reduced() ? 40 : 280);

    LLCFoil.flip(el, true);
    el.classList.add("just-flipped");
    setTimeout(() => el.classList.remove("just-flipped"), 520);

    $("opening-caption").textContent =
      (i + 1) + " / " + opening.pulls.length + "  ·  " + p.card.name;

    await wait(reduced() ? 40 : 380);

    if (p.foil) {
      $("foil-tag").hidden = false;
      $("foil-tag").classList.add("show");
      el.classList.add("sweeping");
      await wait(p.wasNew ? 280 : 700);
    }
    if (p.wasNew) {
      $("new-pop").hidden = false;
      void $("new-pop").offsetWidth;
      $("new-pop").classList.add("show");
      await wait(700);
    }

    opening.phase = "hold";
    opening.busy = false;
    /* Clicks during the flip do not skip the hold — the player should see the card. */
    opening.queued = false;
    $("opening-caption").textContent =
      (i + 1 === opening.pulls.length ? "tap to file into the binder" : "tap for the next card")
      + "  ·  " + (i + 1) + " / " + opening.pulls.length;
  }

  async function advanceFromHold() {
    if (!opening || opening.busy) return;
    opening.busy = true;
    hideBadges();

    const holder = $("reveal-card");
    const stack = $("card-stack");
    const doneEl = holder.firstElementChild;
    if (doneEl) {
      doneEl.classList.remove("sweeping", "just-flipped");
      doneEl.remove();
      opening.revealed = (opening.revealed || []).concat([doneEl]);
    }
    holder.innerHTML = "";
    $("reveal-wrap").hidden = true;

    opening.index += 1;
    if (opening.index >= opening.pulls.length) {
      await flyToBinder();
      return;
    }

    const left = opening.stackEls.slice(opening.index);
    stack.innerHTML = "";
    left.forEach((el) => {
      el.style.transition = "";
      stack.appendChild(el);
    });
    layoutStack(stack, left);
    stack.hidden = false;
    opening.phase = "stack";
    opening.busy = false;
    $("opening-caption").textContent = "tap to flip  ·  " + (opening.index + 1) + " / " + opening.pulls.length;
    if (opening.queued) {
      opening.queued = false;
      revealNext();
    }
  }

  function flyArc(el, from, to, duration) {
    el.style.position = "fixed";
    el.style.left = from.left + "px";
    el.style.top = from.top + "px";
    el.style.width = from.width + "px";
    el.style.height = from.height + "px";
    el.style.margin = "0";
    el.style.zIndex = "50";
    el.style.pointerEvents = "none";
    const x1 = to.left + to.width / 2 - from.width / 2 - from.left;
    const y1 = to.top + to.height / 2 - from.height / 2 - from.top;
    const cx = x1 * 0.45 + (x1 > 0 ? -90 : 90);
    const cy = Math.min(y1 * 0.35, 0) - 150;
    const start = performance.now();
    return new Promise((res) => {
      function frame(t) {
        const p = Math.min(1, (t - start) / duration);
        const e = 1 - Math.pow(1 - p, 3);
        const x = 2 * (1 - e) * e * cx + e * e * x1;
        const y = 2 * (1 - e) * e * cy + e * e * y1;
        const s = 1 - e * 0.92;
        const rot = e * 20;
        el.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ") rotate(" + rot + "deg)";
        el.style.opacity = String(1 - e);
        if (p < 1) requestAnimationFrame(frame);
        else res();
      }
      requestAnimationFrame(frame);
    });
  }

  async function flyToBinder() {
    opening.phase = "fly";
    opening.busy = true;
    $("opening-caption").textContent = "";
    const target = $("fly-target");
    target.classList.add("visible");
    const wrap = $("reveal-wrap");
    const holder = $("reveal-card");
    wrap.hidden = false;
    holder.innerHTML = "";
    hideBadges();

    const flyers = opening.pulls.map((p) => {
      const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "front" });
      el.classList.add("md");
      holder.appendChild(el);
      return el;
    });

    /* Brief fan, then each card arcs into the binder one by one. */
    flyers.forEach((el, i) => {
      const off = (i - (flyers.length - 1) / 2) * 36;
      el.style.position = "relative";
      el.style.transform = "translate(" + off + "px, 0) scale(0.7) rotate(" + (off * 0.08) + "deg)";
      el.style.transition = reduced() ? "opacity 0.2s linear" : "transform 0.4s cubic-bezier(0.22, 1.15, 0.32, 1)";
    });
    await wait(reduced() ? 80 : 420);

    if (reduced()) {
      flyers.forEach((el) => { el.style.opacity = "0"; });
      await wait(200);
    } else {
      const tr = target.getBoundingClientRect();
      const jobs = [];
      for (let i = 0; i < flyers.length; i++) {
        const el = flyers[i];
        const from = el.getBoundingClientRect();
        jobs.push(wait(i * 160).then(() => flyArc(el, from, tr, 620)));
      }
      await Promise.all(jobs);
      await wait(80);
    }
    target.classList.remove("visible");
    opening.phase = "done";
    await show("binder");
    clearOpening();
  }

  /* ---------- interactions ---------- */
  $("screen-title").addEventListener("click", () => show("map"));
  $("screen-title").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show("map"); }
  });

  $("hot-shop").addEventListener("click", () => show("shop"));
  $("hot-battle").addEventListener("click", () => $("modal-battle").classList.add("open"));
  $("btn-battle-ok").addEventListener("click", () => $("modal-battle").classList.remove("open"));
  $("modal-battle").addEventListener("click", (e) => {
    if (e.target === $("modal-battle")) $("modal-battle").classList.remove("open");
  });

  $("btn-shop-back").addEventListener("click", () => show("map"));
  $("btn-map-binder").addEventListener("click", () => show("binder"));
  $("btn-shop-binder").addEventListener("click", () => show("binder"));
  $("btn-binder-back").addEventListener("click", () => show(lastScreen || "shop"));

  $("btn-reset").addEventListener("click", confirmReset);
  $("btn-reset-binder").addEventListener("click", confirmReset);

  $("pack-e1").addEventListener("click", () => startOpening());
  $("pack-locked-a").addEventListener("click", () => alert("Coming soon."));
  $("pack-locked-b").addEventListener("click", () => alert("Coming soon."));

  function onOpeningAdvance() {
    if (!opening) return;
    if (opening.phase === "done" || opening.phase === "fly" || opening.phase === "pack" || opening.phase === "shot") return;
    if (opening.busy) {
      /* Queue at most one advance, and never skip a just-revealed card. */
      if (opening.phase === "hold") opening.queued = true;
      return;
    }
    revealNext();
  }
  $("opening-stage").addEventListener("click", onOpeningAdvance);
  $("opening-stage").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpeningAdvance(); }
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
    if (name === "battle") { await show("map", { instant: true }); $("modal-battle").classList.add("open"); return; }
    if (name === "binder") {
      seedCollectionForShot();
      await show("binder", { instant: true });
      $("binder-book").classList.add("opened");
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
      opening = { pulls, index: 0, phase: "pack", busy: false, queued: false, stackEls: [] };

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
          s.style.width = "18px";
          const angle = (i / 7) * Math.PI * 2;
          s.style.transform = "translate(" + (Math.cos(angle) * 28) + "px," + (Math.sin(angle) * 22 - 8) + "px) rotate(" + (i * 28) + "deg)";
        });
        /* Keep the mid-rip still centered: do not also show the card stack. */
        $("card-stack").hidden = true;
        $("opening-caption").textContent = "";
        opening.phase = "shot";
        return;
      }

      pulls.forEach((p) => {
        const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "back" });
        el.classList.add("lg", "is-back");
        opening.stackEls.push(el);
      });
      opening.phase = "stack";
      $("pack-live").hidden = true;
      if (name === "new") {
        await revealNext();
        $("new-pop").classList.add("hold");
        $("new-pop").classList.remove("show");
        $("new-pop").hidden = false;
        freezeTilt();
        opening.phase = "shot";
      } else if (name === "foil") {
        opening.index = 1;
        await revealNext();
        $("foil-tag").classList.add("hold");
        $("foil-tag").classList.remove("show");
        $("foil-tag").hidden = false;
        $("new-pop").classList.add("hold");
        $("new-pop").classList.remove("show");
        $("new-pop").hidden = false;
        freezeTilt();
        opening.phase = "shot";
      }
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
    show, startOpening, renderBinder, confirmReset, stageShot,
    get opening() { return opening; },
  };
})();
