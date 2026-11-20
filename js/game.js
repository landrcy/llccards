/* LLC Cards game shell: title, map, shop, pack opening, binder. */
(function () {
  const $ = (id) => document.getElementById(id);
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
  let opening = null; // { pulls, index, phase, wait }

  function show(name) {
    Object.keys(screens).forEach((k) => {
      screens[k].classList.toggle("active", k === name);
    });
    if (name !== "opening") lastScreen = name === "binder" ? lastScreen : name;
    if (name === "binder") renderBinder();
  }

  function wait(ms) {
    if (reduced()) ms = Math.min(ms, 80);
    return new Promise((res) => setTimeout(res, ms));
  }

  /* ---------- map hotspots ---------- */
  function placeHotspots() {
    fetch("assets/map_hotspots.json")
      .then((r) => r.json())
      .then((hs) => {
        const shop = $("hot-shop");
        const battle = $("hot-battle");
        const apply = (el, b) => {
          el.style.left = (b.x * 100) + "%";
          el.style.top = (b.y * 100) + "%";
          el.style.width = (b.w * 100) + "%";
          el.style.height = (b.h * 100) + "%";
        };
        apply(shop, hs.shop);
        apply(battle, hs.battle);
      })
      .catch(() => {
        /* fallback percentages matching the last known layout */
        const shop = $("hot-shop");
        const battle = $("hot-battle");
        shop.style.cssText += "left:20%;top:35%;width:36%;height:36%;";
        battle.style.cssText += "left:63%;top:35%;width:31%;height:42%;";
      });
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
  function clearOpening() {
    const stack = $("card-stack");
    const reveal = $("reveal-wrap");
    stack.innerHTML = "";
    reveal.innerHTML = "";
    stack.hidden = true;
    reveal.hidden = true;
    $("new-pop").hidden = true;
    $("new-pop").classList.remove("show", "hold");
    $("foil-tag").hidden = true;
    $("foil-tag").classList.remove("show", "hold");
    $("pack-live").hidden = true;
    $("pack-rip").hidden = true;
    $("pack-rip").classList.remove("ripping");
    $("pack-live").classList.remove("shaking");
    $("pack-live-img").hidden = false;
    $("fly-target").classList.remove("visible");
    $("opening-caption").textContent = "";
    opening = null;
  }

  function layoutStack(stack, cards, peek) {
    const n = cards.length;
    cards.forEach((el, i) => {
      const fromTop = n - 1 - i;
      const rot = (i - (n - 1) / 2) * 3.2;
      el.style.transform = "translate(" + (fromTop * -4) + "px, " + (fromTop * 7) + "px) rotate(" + rot + "deg)";
      el.style.zIndex = String(10 + i);
      if (peek) el.style.opacity = "1";
    });
  }

  async function startOpening() {
    clearOpening();
    const raw = LLCData.pullPack();
    const pulls = LLCStorage.addPulls(raw);
    opening = { pulls, index: 0, phase: "pack", busy: false };
    show("opening");

    const pack = $("pack-live");
    pack.hidden = false;
    $("opening-caption").textContent = "tap the pack";
    if (reduced()) {
      await wait(60);
      await ripAndDeal();
      return;
    }
    /* Auto-start the shake/rip after a short beat if the user already clicked
       from the shop — the pack on this screen is the same click target. */
    pack.classList.add("shaking");
    $("opening-caption").textContent = "";
    await wait(560);
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
      /* force reflow then rip */
      void rip.offsetWidth;
      rip.classList.add("ripping");
      await wait(720);
      pack.hidden = true;
      rip.hidden = true;
    }

    const stack = $("card-stack");
    stack.hidden = false;
    stack.innerHTML = "";
    opening.stackEls = [];
    opening.pulls.forEach((p, i) => {
      const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "back" });
      el.classList.add("lg", "is-back");
      stack.appendChild(el);
      opening.stackEls.push(el);
    });
    layoutStack(stack, opening.stackEls, true);
    opening.phase = "stack";
    $("opening-caption").textContent = "tap to flip  ·  1 / " + opening.pulls.length;
  }

  async function revealNext() {
    if (!opening || opening.busy) return;
    if (opening.phase === "done") return;
    if (opening.phase === "pack") return;
    if (opening.phase === "hold") {
      await advanceFromHold();
      return;
    }
    if (opening.phase !== "stack" && opening.phase !== "ready") return;
    opening.busy = true;

    const i = opening.index;
    const p = opening.pulls[i];
    const stack = $("card-stack");
    const reveal = $("reveal-wrap");
    const el = opening.stackEls[i];

    /* Move the top of the remaining stack into the reveal layer and flip. */
    stack.hidden = true;
    reveal.hidden = false;
    reveal.innerHTML = "";
    reveal.appendChild(el);
    el.style.transform = "";
    el.style.zIndex = "15";

    await wait(reduced() ? 30 : 80);
    LLCFoil.flip(el, true);

    $("opening-caption").textContent =
      (i + 1) + " / " + opening.pulls.length + "  ·  " + p.card.name;

    if (p.foil) {
      $("foil-tag").hidden = false;
      $("foil-tag").classList.add("show");
      await wait(p.wasNew ? 400 : 900);
    }
    if (p.wasNew) {
      $("new-pop").hidden = false;
      $("new-pop").classList.add("show");
      await wait(900);
    }

    opening.phase = "hold";
    opening.busy = false;
    $("opening-caption").textContent =
      (i + 1 === opening.pulls.length ? "tap to file into the binder" : "tap for the next card")
      + "  ·  " + (i + 1) + " / " + opening.pulls.length;
  }

  async function advanceFromHold() {
    if (!opening || opening.busy) return;
    opening.busy = true;
    $("new-pop").hidden = true;
    $("new-pop").classList.remove("show", "hold");
    $("foil-tag").hidden = true;
    $("foil-tag").classList.remove("show", "hold");

    const reveal = $("reveal-wrap");
    const stack = $("card-stack");
    /* Park the revealed card off to the side? Just hide it; remaining stack comes back. */
    const doneEl = reveal.firstElementChild;
    if (doneEl) {
      doneEl.remove();
      opening.revealed = (opening.revealed || []).concat([doneEl]);
    }
    reveal.innerHTML = "";
    reveal.hidden = true;

    opening.index += 1;
    if (opening.index >= opening.pulls.length) {
      await flyToBinder();
      opening.busy = false;
      return;
    }

    /* Remaining face-down cards */
    const left = opening.stackEls.slice(opening.index);
    stack.innerHTML = "";
    left.forEach((el) => stack.appendChild(el));
    layoutStack(stack, left, true);
    stack.hidden = false;
    opening.phase = "stack";
    opening.busy = false;
    $("opening-caption").textContent = "tap to flip  ·  " + (opening.index + 1) + " / " + opening.pulls.length;
  }

  async function flyToBinder() {
    opening.phase = "fly";
    $("opening-caption").textContent = "";
    const target = $("fly-target");
    target.classList.add("visible");
    const reveal = $("reveal-wrap");
    reveal.hidden = false;
    reveal.innerHTML = "";

    const els = (opening.revealed || []).slice();
    /* Recreate compact face-up cards for the flight, since we detached them. */
    const flyers = opening.pulls.map((p) => {
      const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "front" });
      el.classList.add("md");
      el.style.position = "absolute";
      el.style.transition = reduced() ? "opacity 0.25s ease" : "transform 0.7s ease, opacity 0.7s ease";
      reveal.appendChild(el);
      return el;
    });

    /* Fan them briefly, then fly toward the binder tab. */
    flyers.forEach((el, i) => {
      const off = (i - (flyers.length - 1) / 2) * 28;
      el.style.transform = "translate(" + off + "px, 0) scale(0.42) rotate(" + (off * 0.08) + "deg)";
    });
    await wait(reduced() ? 80 : 500);

    const tr = target.getBoundingClientRect();
    const rr = reveal.getBoundingClientRect();
    const tx = tr.left + tr.width / 2 - (rr.left + rr.width / 2);
    const ty = tr.top + tr.height / 2 - (rr.top + rr.height / 2);
    flyers.forEach((el, i) => {
      el.style.transform = "translate(" + tx + "px, " + ty + "px) scale(0.08)";
      el.style.opacity = "0";
      el.style.transitionDelay = (reduced() ? 0 : i * 70) + "ms";
    });
    await wait(reduced() ? 200 : 900);
    target.classList.remove("visible");
    opening.phase = "done";
    show("binder");
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
  $("btn-map-binder").addEventListener("click", () => { lastScreen = "map"; show("binder"); });
  $("btn-shop-binder").addEventListener("click", () => { lastScreen = "shop"; show("binder"); });
  $("btn-binder-back").addEventListener("click", () => show(lastScreen || "shop"));

  $("btn-reset").addEventListener("click", confirmReset);
  $("btn-reset-binder").addEventListener("click", confirmReset);

  $("pack-e1").addEventListener("click", () => startOpening());
  $("pack-locked-a").addEventListener("click", () => alert("Coming soon."));
  $("pack-locked-b").addEventListener("click", () => alert("Coming soon."));

  $("opening-stage").addEventListener("click", () => {
    if (!opening || opening.busy) return;
    if (opening.phase === "stack") revealNext();
    else if (opening.phase === "hold") revealNext();
  });

  /* ---------- debug / screenshot staging ---------- */
  function seedCollectionForShot() {
    /* A mixed binder: some owned, some foil, some missing. */
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
    if (name === "title") { show("title"); return; }
    if (name === "map") { show("map"); return; }
    if (name === "shop") { show("shop"); return; }
    if (name === "battle") { show("map"); $("modal-battle").classList.add("open"); return; }
    if (name === "binder") { seedCollectionForShot(); show("binder"); return; }

    /* opening / new / foil — run a deterministic pull after wiping collection so the first cards are NEW. */
    LLCStorage.reset();
    if (name === "opening" || name === "mid" || name === "new" || name === "foil") {
      /* Force a known pack via a seeded RNG already in the URL, or a fallback seed. */
      if (!LLCData.params().get("seed")) {
        /* install a local override by rewriting pull temporarily */
      }
      show("opening");
      /* Build a known 5-card pull for clean screenshots. */
      const picks = [
        { id: "dot_dummy", foil: name === "foil" || LLCData.forceFoil() },
        { id: "lord_of_lines", foil: true },
        { id: "erase", foil: false },
        { id: "smudge", foil: false },
        { id: "squiggle_worm", foil: LLCData.forceFoil() },
      ].map((p) => ({ id: p.id, card: LLCData.BY_ID[p.id], foil: p.foil }));
      const pulls = LLCStorage.addPulls(picks);
      opening = { pulls, index: 0, phase: "pack", busy: false, stackEls: [] };

      if (name === "opening") {
        /* Mid-rip: show tearing pack + peek of the stack. */
        const pack = $("pack-live");
        pack.hidden = false;
        $("pack-live-img").hidden = true;
        const rip = $("pack-rip");
        rip.hidden = false;
        rip.classList.add("ripping");
        /* freeze mid-animation */
        rip.querySelector(".rip-top").style.animation = "none";
        rip.querySelector(".rip-bottom").style.animation = "none";
        rip.querySelector(".rip-top").style.transform = "translateY(-28%) rotate(-6deg)";
        rip.querySelector(".rip-bottom").style.transform = "translateY(18%) rotate(4deg)";
        const stack = $("card-stack");
        stack.hidden = false;
        pulls.forEach((p) => {
          const el = LLCFoil.createCard(p.card, { foil: p.foil, face: "back" });
          el.classList.add("md", "is-back");
          stack.appendChild(el);
          opening.stackEls.push(el);
        });
        layoutStack(stack, opening.stackEls, true);
        $("opening-caption").textContent = "";
        opening.phase = "shot";
        return;
      }

      /* Build the stack then reveal the first card (dot dummy, NEW, maybe foil). */
      const stack = $("card-stack");
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
        /* Reveal lord of lines as a foil? First pick was set foil for foil shot (dot dummy foil + NEW).
           Better: show lord of lines, the guaranteed foil, with FOIL! and NEW! */
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
    show(screen);
  } else {
    show("title");
  }

  /* Public hook for capture scripts. */
  window.LLC = {
    show, startOpening, renderBinder, confirmReset, stageShot,
    get opening() { return opening; },
  };
})();
