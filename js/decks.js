/* Deck builder: 3 named deck slots built from cards you OWN (copies owned + copy caps).
   The active deck is used in VS BOT and online battles; an invalid or missing deck falls back to the auto deck. */
(function () {
  const $ = (id) => document.getElementById(id);
  const D = window.LLCData, E = window.LLCEngine, S = window.LLCStorage;
  const SIZE = E.DECK_SIZE;
  let cur = 0, filter = "all";
  const KIND_ORDER = { monster: 0, spell: 1, trap: 2 };

  const col = () => S.load();
  const deck = () => S.decks().list[cur];
  const countIn = (ids, id) => ids.reduce((a, x) => a + (x === id ? 1 : 0), 0);
  function limit(c, data) { const r = data.edition_one[c.id]; const have = r && r.owned ? r.n || 1 : 0; return Math.min(have, E.copyCap(c)); }
  function save(ids, name) { const d = deck(); S.saveDeck(cur, { name: name != null ? name : d.name, cards: ids }); }

  function add(id, from) {
    const data = col(), d = deck(), c = D.BY_ID[id];
    if (!c) return false;
    if (d.cards.length >= SIZE) return nudge("Deck is full (" + SIZE + ").");
    if (countIn(d.cards, id) >= limit(c, data)) return nudge(limit(c, data) < E.copyCap(c) ? "You only own " + limit(c, data) + "." : "Max " + E.copyCap(c) + " of " + c.name + ".");
    save(d.cards.concat([id]));
    if (window.LLCAudio) LLCAudio.play("place");
    render(id);
    return true;
  }
  function remove(id) {
    const d = deck(); const i = d.cards.lastIndexOf(id);
    if (i < 0) return;
    const ids = d.cards.slice(); ids.splice(i, 1); save(ids);
    if (window.LLCAudio) LLCAudio.play("slide");
    render();
  }
  function nudge(msg) {
    const w = $("deck-warn"); w.textContent = msg; w.classList.remove("shake"); void w.offsetWidth; w.classList.add("shake");
    clearTimeout(nudge.t); nudge.t = setTimeout(render, 1400);
    return false;
  }
  /* Auto-fill: keep what is in the deck, then add your best owned cards (about 11 monsters / 6 spells / 3 traps). */
  function autofill() {
    const data = col(); const ids = deck().cards.slice();
    const owned = D.CARDS.filter((c) => limit(c, data) > 0).sort((a, b) => E.cardValue(b) - E.cardValue(a));
    const want = { monster: 11, spell: 6, trap: 3 };
    const kinds = (k) => ids.filter((id) => D.BY_ID[id].kind === k).length;
    for (let pass = 0; pass < 2 && ids.length < SIZE; pass++) {
      for (let round = 0; round < 3; round++) owned.forEach((c) => {
        if (ids.length >= SIZE || countIn(ids, c.id) > round || countIn(ids, c.id) >= limit(c, data)) return;
        if (pass === 0 && kinds(c.kind) >= want[c.kind]) return;
        ids.push(c.id);
      });
    }
    save(ids); render();
    if (ids.length < SIZE) nudge("You own " + ids.length + " usable cards. Open more packs to fill " + SIZE + ".");
  }

  function renderTabs() {
    const { list, active } = S.decks();
    $("deck-tabs").innerHTML = "";
    list.forEach((d, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "tab");
      b.className = (i === cur ? "on" : "") + (i === active ? " active" : "");
      b.textContent = (i === active ? "★ " : "") + d.name + "  " + d.cards.length + "/" + SIZE;
      b.addEventListener("click", () => { cur = i; render(); });
      $("deck-tabs").appendChild(b);
    });
    const a = document.createElement("button");
    a.type = "button"; a.className = "auto-tab" + (active < 0 ? " active" : "");
    a.textContent = (active < 0 ? "★ " : "") + "AUTO DECK";
    a.title = "Battle with the automatic best-cards deck";
    a.addEventListener("click", () => { S.setActiveDeck(-1); render(); });
    $("deck-tabs").appendChild(a);
  }

  function render(flashId) {
    if (!$("screen-decks")) return;
    const data = col(), d = deck(), { active } = S.decks();
    renderTabs();
    if (document.activeElement !== $("deck-name")) $("deck-name").value = d.name;
    const probs = E.deckProblems(d.cards, data);
    const valid = !probs.length;
    const use = $("deck-use");
    use.textContent = active === cur ? (valid ? "IN USE ✓" : "IN USE (INVALID: AUTO DECK USED)") : "USE IN BATTLES";
    use.classList.toggle("on", active === cur);

    // pool
    const grid = $("deck-grid"); grid.innerHTML = "";
    const owned = D.CARDS.filter((c) => limit(c, data) > 0 && (filter === "all" || c.kind === filter));
    $("deck-pool-empty").hidden = owned.length > 0;
    owned.forEach((c) => {
      const lim = limit(c, data), n = countIn(d.cards, c.id);
      const cell = document.createElement("div");
      cell.className = "deck-cell" + (n >= lim || d.cards.length >= SIZE ? " maxed" : "") + (n ? " in" : "");
      cell.dataset.id = c.id; cell.tabIndex = 0; cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", "Add " + c.name + " (" + n + " of " + lim + ")");
      const el = LLCFoil.createCard(c, { foil: !!(data.edition_one[c.id] && data.edition_one[c.id].foil), face: "front" });
      el.classList.add("sm");
      cell.appendChild(el);
      const badge = document.createElement("span"); badge.className = "deck-badge"; badge.textContent = n + "/" + lim;
      cell.appendChild(badge);
      grid.appendChild(cell);
    });

    // deck list
    const list = $("deck-list"); list.innerHTML = "";
    const ids = Array.from(new Set(d.cards)).sort((a, b) => {
      const A = D.BY_ID[a], B = D.BY_ID[b];
      return KIND_ORDER[A.kind] - KIND_ORDER[B.kind] || (B.stars || 0) - (A.stars || 0) || A.name.localeCompare(B.name);
    });
    ids.forEach((id) => {
      const c = D.BY_ID[id];
      const li = document.createElement("li");
      li.className = "deck-row k-" + c.kind + " r-" + c.rarity + (id === flashId ? " added" : "");
      li.dataset.id = id; li.tabIndex = 0; li.setAttribute("role", "button");
      li.setAttribute("aria-label", "Remove one " + c.name);
      li.innerHTML = '<span class="dr-n">x' + countIn(d.cards, id) + '</span><img src="assets/cards/' + id + '.png?v=' + (window.LLC_ASSET_V || "10") + '" alt="" draggable="false"><span class="dr-name">' + c.name + '</span><span class="dr-meta">' +
        (c.kind === "monster" ? c.stars + "★ " + c.atk : c.kind === "spell" ? "SPELL" : "TRAP") + '</span><span class="dr-x" aria-hidden="true">−</span>';
      list.appendChild(li);
    });
    if (!ids.length) list.innerHTML = '<li class="deck-row empty-row">Empty deck. Click cards on the left, or AUTO-FILL.</li>';

    // stats
    const by = (f) => d.cards.filter((id) => f(D.BY_ID[id])).length;
    const mons = by((c) => c.kind === "monster"), sp = by((c) => c.kind === "spell"), tr = by((c) => c.kind === "trap");
    const low = by((c) => c.kind === "monster" && c.stars <= 4), mid = by((c) => c.kind === "monster" && c.stars >= 5 && c.stars <= 6), hi = by((c) => c.kind === "monster" && c.stars >= 7);
    $("deck-stats").innerHTML =
      '<div class="ds-count' + (d.cards.length === SIZE ? " ok" : "") + '"><b>' + d.cards.length + "</b> / " + SIZE + " CARDS</div>" +
      '<div class="ds-row"><span>MONSTERS ' + mons + "</span><span>SPELLS " + sp + "</span><span>TRAPS " + tr + "</span></div>" +
      '<div class="ds-row stars"><span>1-4★ ' + low + "</span><span>5-6★ " + mid + " <i>(1 tribute)</i></span><span>7-8★ " + hi + " <i>(2)</i></span></div>";
    const w = $("deck-warn");
    if (nudge.t && w.classList.contains("shake") && flashId == null) { /* keep the nudge text until its timer */ }
    const soft = [];
    if (valid && hi + mid > low) soft.push("lots of tribute monsters, few to tribute");
    if (valid && mons < 8) soft.push("few monsters");
    w.textContent = valid ? (soft.length ? "OK, but: " + soft.join(", ") + "." : "READY TO BATTLE.") : "NOT VALID: " + probs.join(" · ") + (active === cur ? "  (the auto deck is used until it's fixed)" : "");
    w.className = "deck-warn " + (valid ? "ok" : "bad");
  }

  /* ---- input: click / keyboard / pointer drag (desktop) ---- */
  let drag = null;
  $("deck-grid").addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".deck-cell"); if (!cell || e.button !== 0) return;
    drag = { id: cell.dataset.id, x: e.clientX, y: e.clientY, moved: false, ghost: null, touch: e.pointerType !== "mouse" };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || drag.touch) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
      drag.moved = true;
      const g = document.createElement("img");
      g.className = "deck-ghost"; g.src = "assets/cards/" + drag.id + ".png?v=" + (window.LLC_ASSET_V || "10"); g.alt = "";
      document.body.appendChild(g); drag.ghost = g;
      $("deck-side").classList.add("drop-ready");
    }
    if (drag.moved) {
      drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px";
      const r = $("deck-side").getBoundingClientRect();
      $("deck-side").classList.toggle("drop-over", e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    }
  });
  window.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const dd = drag; drag = null;
    $("deck-side").classList.remove("drop-ready", "drop-over");
    if (dd.ghost) dd.ghost.remove();
    if (!dd.moved) return;                   // a plain click is handled by the click listener
    const r = $("deck-side").getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) add(dd.id, "drag");
    dragJustEnded = true; setTimeout(() => { dragJustEnded = false; }, 0);
  });
  let dragJustEnded = false;
  $("deck-grid").addEventListener("click", (e) => {
    if (dragJustEnded) return;
    const cell = e.target.closest(".deck-cell"); if (cell) add(cell.dataset.id, "click");
  });
  $("deck-grid").addEventListener("keydown", (e) => {
    const cell = e.target.closest && e.target.closest(".deck-cell");
    if (cell && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); add(cell.dataset.id); const n = $("deck-grid").querySelector('[data-id="' + cell.dataset.id + '"]'); if (n) n.focus(); }
  });
  $("deck-list").addEventListener("click", (e) => { const li = e.target.closest(".deck-row[data-id]"); if (li) remove(li.dataset.id); });
  $("deck-list").addEventListener("keydown", (e) => { const li = e.target.closest && e.target.closest(".deck-row[data-id]"); if (li && (e.key === "Enter" || e.key === " " || e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); remove(li.dataset.id); } });
  $("deck-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filter = b.dataset.f; $("deck-filter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); render();
  });
  $("deck-name").addEventListener("input", () => { save(deck().cards, $("deck-name").value.toUpperCase() || "DECK " + (cur + 1)); renderTabs(); });
  $("deck-name").addEventListener("change", () => render());
  $("deck-auto").addEventListener("click", autofill);
  $("deck-clear").addEventListener("click", () => { if (!deck().cards.length || confirm("Empty " + deck().name + "?")) { save([]); render(); } });
  $("deck-use").addEventListener("click", () => { const { active } = S.decks(); S.setActiveDeck(active === cur ? -1 : cur); render(); });

  document.addEventListener("llc:screen", (e) => { if (e.detail.name === "decks") { const a = S.decks().active; if (a >= 0) cur = a; render(); } });
  window.LLCDecks = { render, add, remove, autofill, get slot() { return cur; }, set slot(i) { cur = i; render(); } };
})();
