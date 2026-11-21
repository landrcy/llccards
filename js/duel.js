/* LLC Cards arena + duel board. Controllers: vs bot (local engine), online host, online guest. */
(function () {
  const $ = (id) => document.getElementById(id);
  const E = window.LLCEngine;
  const BY = window.LLCData.BY_ID;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NAMES = ["INKY", "DOODLE", "SMUDGY", "SCRIBBLE", "PENCIL", "CRAYON", "SKETCHY", "LINEY"];

  const ui = {
    V: null,
    ctl: null,
    select: null,      // {purpose, uid?, slot?, targets:[{p,slot}], need?, picked?}
    shownSeq: -1,
    lp: [4000, 4000],
    shownLp: [4000, 4000],
    autoplay: false,
    speed: 1,
  };
  let myName = sessionStorage.getItem("llc-name");
  if (!myName) {
    myName = NAMES[Math.floor(Math.random() * NAMES.length)] + " " + (10 + Math.floor(Math.random() * 90));
    sessionStorage.setItem("llc-name", myName);
  }

  function myDeck() { return E.deckFromCollection(LLCStorage.load()); }

  /* ================= arena / lobby ================= */
  function renderArena() {
    const d = myDeck();
    const total = window.LLCData.CARDS.length;
    $("deck-line").textContent = "YOUR DECK: 20 CARDS  ·  " + d.owned + " / " + total + " CARDS OWNED" +
      (d.owned < 20 ? "  ·  COMMON STARTERS FILL THE GAPS" : "  ·  YOUR BEST CARDS ARE IN");
    setWaiting(false);
  }
  function setWaiting(on, title, sub) {
    $("arena-modes").hidden = !!on;
    $("arena-wait").hidden = !on;
    if (on) {
      $("wait-title").textContent = title || "LOOKING…";
      $("wait-sub").textContent = sub || "";
      $("room-code").hidden = true;
      $("btn-wait-bot").hidden = false;
      $("arena-wait").classList.remove("error");
    }
  }
  function waitError(msg) {
    $("wait-title").textContent = "HMM.";
    $("wait-sub").textContent = msg;
    $("arena-wait").classList.add("error");
  }

  const PROTO = 4;   // bump when rules or sync change, so mismatched builds never play each other
  const hello = () => ({ v: PROTO, name: myName, deck: myDeck().cards });
  const netHandlers = {
    onStatus: (t) => { $("wait-sub").textContent = t; },
    onRoom: (code) => {
      $("wait-title").textContent = "YOUR ROOM";
      $("room-code").hidden = false;
      $("room-code").textContent = code;
      $("wait-sub").textContent = "Send this code to a friend. Waiting for them to join…";
    },
    onError: (msg) => waitError(msg),
    onMatch: (m) => startOnline(m),
  };

  $("btn-vs-bot").addEventListener("click", () => startBot());
  $("btn-quick").addEventListener("click", () => {
    setWaiting(true, "QUICK MATCH", "Connecting…");
    LLCNet.quick(hello(), netHandlers);
  });
  $("btn-host").addEventListener("click", () => {
    setWaiting(true, "MAKING A ROOM", "Connecting…");
    LLCNet.host(hello(), netHandlers);
  });
  const doJoin = () => {
    const code = $("join-code").value.trim().toUpperCase();
    setWaiting(true, "JOINING", "Connecting…");
    $("btn-wait-bot").hidden = true;
    LLCNet.join(code, hello(), netHandlers);
  };
  $("btn-join").addEventListener("click", doJoin);
  $("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
  $("join-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });
  $("btn-wait-cancel").addEventListener("click", () => { LLCNet.stop(); setWaiting(false); });
  $("btn-wait-bot").addEventListener("click", () => { LLCNet.stop(); startBot(); });
  $("btn-arena-back").addEventListener("click", () => { LLCNet.stop(); LLC.show("map"); });
  $("btn-arena-binder").addEventListener("click", () => { LLCNet.stop(); LLC.show("binder"); });
  document.addEventListener("llc:screen", (e) => {
    if (e.detail.name === "arena") renderArena();
    if (e.detail.prev === "duel" && e.detail.name !== "duel") leaveDuel();
  });

  /* ================= controllers ================= */
  function botController() {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const bot = E.botDeck(seed ^ 0x5bd1e995);
    const { state: s, events } = E.create({ seed, decks: [myDeck().cards, bot.cards], names: ["YOU", "BOT"] });
    let timer = null, alive = true;
    const push = (ev) => onView(E.view(s, 0), ev);
    const tick = () => {
      clearTimeout(timer);
      if (!alive || s.winner != null) return;
      const who = s.pending ? s.pending.player : s.active;
      if (who !== 1) { if (ui.autoplay) autoTick(); return; }
      timer = setTimeout(() => {
        if (!alive || s.winner != null) return;
        if ((s.pending ? s.pending.player : s.active) !== 1) return;
        const a = LLCAI.decide(E.view(s, 1));
        let ev;
        try { ev = E.apply(s, 1, a || { a: "phase" }); }
        catch (err) {
          try { ev = E.apply(s, 1, s.pending ? (s.pending.type === "trap" ? { a: "respond", slot: null } : { a: "discard", uid: s.players[1].hand[0] }) : { a: "endturn" }); }
          catch (err2) { ev = []; }
        }
        push(ev);
        tick();
      }, (a0() ? 120 : 650) / ui.speed);
    };
    const a0 = () => ui.autoplay;
    return {
      mode: "bot",
      start() { push(events); tick(); },
      act(a) {
        if (!alive) return;
        try { const ev = E.apply(s, 0, a); push(ev); }
        catch (err) { toast(err.message); }
        tick();
      },
      leave() { alive = false; clearTimeout(timer); },
      rematch() { this.leave(); startBot(); },
      refresh() { push([]); },
      admin(op) {            // local practice only: the admin panel never reaches online games
        if (!alive) return;
        try { push(E.admin(s, op)); } catch (err) { toast(err.message); }
        tick();
      },
      _state: s,
    };
  }

  function wire(conn, onMsg, onGone) {
    let last = Date.now(), alive = true;
    conn.on("data", (d) => { last = Date.now(); if (d && d.t !== "ping") onMsg(d); });
    conn.on("close", () => { if (alive) { alive = false; onGone(); } });
    const iv = setInterval(() => {
      if (!alive) { clearInterval(iv); return; }
      try { conn.send({ t: "ping" }); } catch (e) {}
      if (Date.now() - last > 16000) { alive = false; clearInterval(iv); onGone(); }
    }, 3000);
    return () => { alive = false; clearInterval(iv); try { conn.close(); } catch (e) {} };
  }

  function hostController(conn, guestHello) {
    const guestDeck = E.validDeck(guestHello.deck) ? guestHello.deck : E.deckFromCollection({}).cards;
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const { state: s, events } = E.create({
      seed, decks: [myDeck().cards, guestDeck],
      names: [myName, String(guestHello.name || "RIVAL").slice(0, 14)],
    });
    const push = (ev) => {
      try { conn.send({ t: "state", view: E.view(s, 1), events: ev }); } catch (e) {}
      onView(E.view(s, 0), ev);
      if (ui.autoplay) autoTick();
    };
    const close = wire(conn, (d) => {
      if (d.t === "act") {
        try { push(E.apply(s, 1, d.action)); }
        catch (err) { try { conn.send({ t: "err", msg: err.message }); } catch (e) {} }
      }
    }, () => opponentLeft());
    return {
      mode: "online",
      start() { push(events); },
      act(a) {
        try { push(E.apply(s, 0, a)); } catch (err) { toast(err.message); }
      },
      leave() { close(); LLCNet.stop(); },
      _state: s,
    };
  }

  function guestController(conn) {
    const close = wire(conn, (d) => {
      if (d.t === "state") { ui.awaiting = false; onView(d.view, d.events || []); if (ui.autoplay) autoTick(); }
      else if (d.t === "err") { ui.awaiting = false; toast(d.msg); render(); }
    }, () => opponentLeft());
    return {
      mode: "online",
      start() { $("duel-log").textContent = "Shuffling…"; },
      act(a) {
        if (ui.awaiting) return;
        ui.awaiting = true;
        clearTimeout(ui.awaitT);
        ui.awaitT = setTimeout(() => { ui.awaiting = false; }, 5000);
        try { conn.send({ t: "act", action: a }); } catch (e) { ui.awaiting = false; toast("Connection lost."); }
      },
      leave() { close(); LLCNet.stop(); },
    };
  }

  function opponentLeft() {
    if (!ui.V || ui.V.winner != null) return;
    showOver(true, "Your rival left the match.");
  }

  /* ================= start / leave ================= */
  function resetBoardUi() {
    ui.awarded = false;
    ui.V = null; ui.select = null; ui.shownSeq = -1; ui.awaiting = false; ui.pendingViews = 0; ui.discardPick = null;
    ui.shownLp = [4000, 4000];
    $("duel-over").hidden = true;
    $("duel-sheet").hidden = true;
    $("duel-banner").hidden = true;
    $("float-layer").innerHTML = "";
    $("grave-view").hidden = true;
    $("clash").hidden = true;
    $("trap-flash").hidden = true;
    $("arrow-layer").innerHTML = "";
    $("log-list").innerHTML = ""; $("log-list").dataset.key = "";
    ui.pinned = null; ui.lastSeen = null; ui.atkFrom = null; ui.anchorKey = null; hidePop();
    fillDetail(null, null, "", null);
  }
  function startBot() {
    if (ui.ctl) ui.ctl.leave();
    resetBoardUi();
    $("opp-name").textContent = "BOT";
    $("btn-rematch").hidden = false;
    ui.ctl = botController();
    LLC.show("duel");
    ui.ctl.start();
  }
  function startOnline(m) {
    if (!m.hello || m.hello.v !== PROTO) {
      try { m.conn.close(); } catch (e) {}
      LLCNet.stop();
      setWaiting(true, "UPDATE NEEDED", "");
      waitError("You and your rival are on different versions of LLC Cards. Both of you: refresh the page, then try again.");
      return;
    }
    if (ui.ctl) ui.ctl.leave();
    resetBoardUi();
    $("opp-name").textContent = String((m.hello && m.hello.name) || "RIVAL").slice(0, 14);
    $("btn-rematch").hidden = true;
    LLCAudio.play("match");
    ui.ctl = m.role === "host" ? hostController(m.conn, m.hello) : guestController(m.conn);
    LLC.show("duel");
    ui.ctl.start();
  }
  function leaveDuel() {
    if (ui.ctl) { ui.ctl.leave(); ui.ctl = null; }
    resetBoardUi();
  }

  $("btn-menu").addEventListener("click", () => {
    ui.anchorKey = null;
    openSheet(null, "MENU\nLeaving a duel counts as a loss.", [
      { label: LLCAudio.muted ? "SOUND: OFF" : "SOUND: ON", fn: () => { LLCAudio.setMuted(!LLCAudio.muted); closeSheet(); } },
      { label: "LEAVE", fn: () => { if (ui.ctl && ui.V && ui.V.winner == null) ui.ctl.act({ a: "concede" }); closeSheet(); LLC.show("arena"); } },
      { label: "KEEP PLAYING", fn: closeSheet },
    ]);
  });
  $("btn-rematch").addEventListener("click", () => { if (ui.ctl && ui.ctl.rematch) ui.ctl.rematch(); });
  $("btn-over-back").addEventListener("click", () => LLC.show("arena"));
  $("btn-next").addEventListener("click", () => {
    if (!ui.V || ui.select) return;
    ui.ctl.act({ a: "phase" });
  });

  /* ================= layout helpers ================= */
  const wideMQ = window.matchMedia("(min-width: 980px) and (min-aspect-ratio: 5/4)");
  const isWide = () => wideMQ.matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms / ui.speed));

  /* ================= card detail panel ================= */
  function kindLabel(c) {
    if (c.kind === "monster") return c.stars + "-STAR MONSTER";
    return c.kind === "spell" ? "SPELL" : "TRAP";
  }
  function fillDetail(c, item, info, btns) {
    const cardBox = $("dp-card");
    cardBox.innerHTML = "";
    if (!c) {
      $("dp-name").textContent = "HOVER A CARD";
      $("dp-stars").innerHTML = "";
      $("dp-type").textContent = "Point at any card to read it here.";
      $("dp-stats").textContent = "";
      $("dp-now").textContent = info || "";
      $("dp-effect").textContent = "";
    } else if (c.hidden || !c.id) {
      cardBox.appendChild(cardEl(null));
      $("dp-name").textContent = "FACE-DOWN";
      $("dp-stars").innerHTML = "";
      $("dp-type").textContent = "A face-down spell or trap.";
      $("dp-stats").textContent = "";
      $("dp-now").textContent = info || "";
      $("dp-effect").textContent = "";
    } else {
      const d = BY[c.id];
      cardBox.appendChild(cardEl(item && item.id ? item : c));
      $("dp-name").textContent = d.name;
      $("dp-stars").innerHTML = d.kind === "monster" ? '<img src="assets/star.png" alt="">'.repeat(d.stars) : "";
      $("dp-type").textContent = kindLabel(d);
      $("dp-stats").textContent = d.kind === "monster" ? "ATK " + d.atk + "  /  DEF " + d.def : "";
      let now = "";
      if (item && item.pos && d.kind === "monster") {
        now = "ON FIELD: " + (item.pos === "atk" ? "ATTACK MODE" : "DEFENSE MODE") +
          (item.atk !== d.atk || item.def !== d.def ? "  ·  NOW " + item.atk + " / " + item.def : "");
      }
      $("dp-now").textContent = [now, info || ""].filter(Boolean).join("\n");
      $("dp-effect").textContent = d.effect;
    }
    const box = $("dp-btns");
    // keep the same buttons alive when re-showing the pinned card (mouse travelling to them)
    if (btns && box._btns === btns) return;
    box._btns = btns || null;
    box.innerHTML = "";
    (btns || []).forEach((b) => {
      if (b.label === "CLOSE") return;
      const x = document.createElement("button");
      x.type = "button"; x.textContent = b.label;
      x.addEventListener("click", b.fn);
      box.appendChild(x);
    });
  }
  // pinned = what the panel falls back to when the pointer leaves a card
  function showDetail(c, item) { if (isWide() && !ui.pinned) fillDetail(c, item, "", null); }
  function restoreDetail() {
    if (!isWide()) return;
    const p = ui.pinned;
    if (p) fillDetail(p.c, p.item, p.info, p.btns);
    else fillDetail(ui.lastSeen ? ui.lastSeen.c : null, ui.lastSeen ? ui.lastSeen.item : null, "", null);
    placePop();
  }
  /* ---- desktop action menu: pops up right next to the clicked card ---- */
  function anchorEl(key) {
    if (!key) return null;
    if (key.startsWith("h")) return document.querySelector('#my-hand .hcard[data-uid="' + key.slice(1) + '"]');
    const [p, kind, slot] = key.slice(1).split(":");
    return zoneNode(Number(p), kind, Number(slot));
  }
  function hidePop() { const pop = $("act-pop"); pop.hidden = true; pop._btns = null; document.querySelectorAll(".sel-lock").forEach((n) => n.classList.remove("sel-lock")); }
  function placePop(opts) {
    const pop = $("act-pop");
    const P = ui.pinned;
    const el = P && P.key && isWide() && P.btns && P.btns.length ? anchorEl(P.key) : null;
    if (!el || $("screen-duel").offsetParent === null && !$("screen-duel").classList.contains("active")) { hidePop(); return; }
    document.querySelectorAll(".sel-lock").forEach((n) => { if (n !== el) n.classList.remove("sel-lock"); });
    el.classList.add("sel-lock");
    if (pop._btns !== P.btns) {
      pop._btns = P.btns;
      const box = $("act-pop-btns");
      box.innerHTML = "";
      $("act-pop-name").textContent = P.c && P.c.id ? BY[P.c.id].name : "";
      P.btns.forEach((b) => {
        const x = document.createElement("button");
        x.type = "button"; x.textContent = b.label;
        x.addEventListener("click", (ev) => { ev.stopPropagation(); b.fn(); });
        box.appendChild(x);
      });
    }
    pop.hidden = false;
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    let x, y;
    if (P.key.startsWith("h")) { x = r.left + r.width / 2 - pw / 2; y = r.top - ph - 10; if (y < m) y = r.bottom + 10; }
    else { x = r.right + 10; y = r.top + r.height / 2 - ph / 2; if (x + pw > vw - m) x = r.left - pw - 10; }
    x = Math.max(m, Math.min(vw - pw - m, x)); y = Math.max(m, Math.min(vh - ph - m, y));
    pop.style.left = Math.round(x) + "px"; pop.style.top = Math.round(y) + "px";
    // the selected card lifts (CSS transition); settle the menu once it has moved
    clearTimeout(ui.popT);
    if (!opts || !opts.settle) ui.popT = setTimeout(() => placePop({ settle: true }), 230);
  }
  function unpin() { ui.pinned = null; restoreDetail(); }
  function hoverable(el, getC, getItem) {
    el.addEventListener("mouseenter", () => showDetail(getC(), getItem ? getItem() : null));
    el.addEventListener("mouseleave", restoreDetail);
  }

  /* ================= rendering ================= */
  function cardEl(c, opts) {
    opts = opts || {};
    if (!c || c.hidden || !c.id) {
      const el = document.createElement("div");
      el.className = "llc-card back-only";
      el.innerHTML = '<img src="assets/card_back.png?v=9" alt="Face-down card" draggable="false">';
      return el;
    }
    return LLCFoil.createCard(BY[c.id], { foil: !!c.foil, face: "front" });
  }

  function zoneEl(kind, p, slot, item) {
    const z = document.createElement("div");
    z.className = "zone " + kind + (item ? " full" : " empty");
    z.dataset.p = p; z.dataset.slot = slot; z.dataset.kind = kind;
    const area = document.createElement("div");
    area.className = "zone-card";
    z.appendChild(area);
    if (item) {
      const wrap = document.createElement("div");
      wrap.className = "fcard";
      if (kind === "mz" && item.pos === "def") wrap.classList.add("def");
      wrap.appendChild(cardEl(item.id ? item : null));
      if (kind === "mz" && item.attacked) wrap.classList.add("spent");
      if (kind === "sz" && item.id && item.faceUp) {
        wrap.classList.add("face-up-st");
        const d = BY[item.id];
        const t = document.createElement("span");
        t.className = "set-tag eq-tag" + (d.sub === "curse" ? " curse" : "");
        t.textContent = d.sub === "curse" ? "CURSE" : "EQUIP";
        wrap.appendChild(t);
      } else if (kind === "sz" && item.id) {
        wrap.classList.add("set-mine");
        const t = document.createElement("span");
        t.className = "set-tag";
        t.textContent = "SET";
        wrap.appendChild(t);
      }
      area.appendChild(wrap);
      if (kind === "mz" && item.id) {
        const st = document.createElement("div");
        const d = BY[item.id];
        const isDef = item.pos === "def";
        const val = isDef ? item.def : item.atk;
        const base = isDef ? d.def : d.atk;
        st.className = "stat " + (isDef ? "is-def" : "is-atk") + (val > base ? " up" : val < base ? " down" : "");
        st.innerHTML = '<span class="lbl">' + (isDef ? "DEF" : "ATK") + '</span><b>' + val + "</b>";
        z.appendChild(st);
        if (item.eq && item.eq.length) {
          const box = document.createElement("div");
          box.className = "eq-badges";
          item.eq.forEach((q) => {
            const b = document.createElement("span");
            const d2 = BY[q.id];
            b.className = "eq-badge" + (d2.sub === "curse" ? " curse" : "");
            b.textContent = d2.name;
            box.appendChild(b);
          });
          z.appendChild(box);
        }
        if (item.id === "dot_dummy" && ui.V) {
          const used = !!ui.V.players[p].dummyUsed;
          const t = document.createElement("span");
          t.className = "shield-tag" + (used ? " used" : "");
          t.textContent = used ? "SHIELD USED" : "SHIELD READY";
          z.appendChild(t);
        }
      }
      hoverable(z, () => item, () => item);
    }
    return z;
  }

  function pileEl(label, n, top, p) {
    const d = document.createElement("div");
    d.className = "pile pile-" + label.toLowerCase();
    d.dataset.p = p;
    const holder = document.createElement("div");
    holder.className = "pile-card";
    if (top) holder.appendChild(cardEl(top));
    else if (label === "DECK" && n) holder.appendChild(cardEl(null));
    d.appendChild(holder);
    const t = document.createElement("span");
    t.className = "pile-n";
    t.textContent = label + " " + n;
    d.appendChild(t);
    if (label === "GRAVE") {
      d.classList.add("clickable");
      d.setAttribute("role", "button");
      d.tabIndex = 0;
      d.setAttribute("aria-label", "Open graveyard, " + n + " cards");
      d.addEventListener("click", () => openGrave(p));
      d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGrave(p); } });
      if (top) hoverable(d, () => top);
    }
    return d;
  }

  function hintText(V) {
    const me = V.me;
    if (V.winner != null) return "";
    if (ui.select) return ui.select.prompt;
    if (V.pending) {
      if (V.pending.waiting) return V.pending.type === "trap" ? "They're deciding whether to spring a trap…" : "Waiting for them…";
      if (V.pending.type === "trap" && V.pending.on === "spell") return "They cast a spell. Counter it or let it resolve.";
      if (V.pending.type === "trap" && V.pending.on === "summon") return "They summoned a monster. Spring a trap or let it be.";
      return "You're being attacked. Spring a trap or let it through.";
    }
    if (V.active !== me) return "Their turn. Watch the log for what they do.";
    const L = V.legal;
    const handPlays = Object.values(L.hand || {}).some((o) => o.length);
    const fieldPlays = Object.values(L.mz || {}).some((o) => o && o.length) || Object.values(L.sz || {}).some((o) => o && o.length);
    if (V.phase === "main") {
      if (handPlays) return "Tap a glowing card in your hand to play it. Tap BATTLE when you're done.";
      if (fieldPlays) return "Tap a monster to switch its mode, or tap " + (V.turn > 1 ? "BATTLE." : "END TURN.");
      return V.turn > 1 ? "Nothing left to play. Tap BATTLE." : "Nothing left to play. Tap END TURN.";
    }
    if (V.phase === "battle") {
      if (Object.values(L.mz || {}).some((o) => o && o.includes("attack"))) return "Tap one of your outlined monsters to attack.";
      return "No one can attack. Tap END TURN.";
    }
    return "";
  }

  function render() {
    const V = ui.V;
    if (!V) return;
    const me = V.me, op = 1 - me;
    const P = V.players[me], O = V.players[op];
    const myTurn = V.active === me && V.winner == null;
    const L = V.legal;
    const sel = ui.select;
    const isTarget = (p, slot, kind) => sel && sel.targets.some((t) => t.p === p && t.slot === slot && (t.kind || "mz") === kind);

    $("opp-name").textContent = O.name;
    renderField(V);
    $("phases").querySelectorAll("span").forEach((s) => s.classList.toggle("on", s.dataset.ph === V.phase));
    $("duel-mid").classList.toggle("their-turn", !myTurn);
    $("duel-mid").classList.toggle("my-turn", myTurn);
    if (!ui.toastOn) $("duel-log").textContent = V.log.length ? V.log[V.log.length - 1] : "";
    renderLog(V);
    renderHint(V);

    // opponent hand (backs)
    const oh = $("opp-hand");
    oh.innerHTML = "";
    O.hand.forEach(() => { const b = document.createElement("div"); b.className = "hand-back"; b.appendChild(cardEl(null)); oh.appendChild(b); });
    fanHand(oh, true);

    const rows = [
      ["opp-sz", "sz", op, O.sz, pileEl("GRAVE", O.grave.length, O.grave[O.grave.length - 1], op)],
      ["opp-mz", "mz", op, O.mz, pileEl("DECK", O.deck, null, op)],
      ["my-mz", "mz", me, P.mz, pileEl("DECK", P.deck, null, me)],
      ["my-sz", "sz", me, P.sz, pileEl("GRAVE", P.grave.length, P.grave[P.grave.length - 1], me)],
    ];
    rows.forEach(([id, kind, p, arr, pile]) => {
      const row = $(id);
      row.innerHTML = "";
      arr.forEach((item, slot) => {
        const z = zoneEl(kind, p, slot, item);
        if (sel) {
          if (isTarget(p, slot, kind)) z.classList.add("target");
          else if (sel.purpose === "tribute" && sel.picked && sel.picked.indexOf(slot) !== -1 && p === me && kind === "mz") z.classList.add("picked");
        } else if (p === me && myTurn && !V.pending) {
          const o = (kind === "mz" ? L.mz : L.sz)[slot];
          if (o && o.length) z.classList.add("can-act");
        }
        if (ui.atkFrom && ui.atkFrom.p === p && ui.atkFrom.slot === slot && kind === "mz") z.classList.add("attacking");
        z.addEventListener("click", () => onZone(kind, p, slot));
        row.appendChild(z);
      });
      row.appendChild(pile);
    });

    // my hand
    const hand = $("my-hand");
    hand.innerHTML = "";
    const disc = discarding(V);
    if (!disc) ui.discardPick = null;
    hand.classList.toggle("discard-mode", disc);
    $("screen-duel").classList.toggle("is-discarding", disc);
    P.hand.forEach((c) => {
      const h = document.createElement("div");
      h.className = "hcard";
      h.dataset.uid = c.uid;
      h.appendChild(cardEl(c));
      if (disc) {
        h.classList.add("discard-mode");
        if (ui.discardPick === c.uid) h.classList.add("discard-pick");
        const x = document.createElement("div");
        x.className = "trash-x";
        x.setAttribute("aria-hidden", "true");
        h.appendChild(x);
      }
      else if (!sel && myTurn && !V.pending && (L.hand[c.uid] || []).length) h.classList.add("can-act");
      h.addEventListener("click", () => onHand(c));
      h.addEventListener("dblclick", () => defaultHand(c));
      hoverable(h, () => c);
      hand.appendChild(h);
    });
    fanHand(hand, false);

    const nb = $("btn-next");
    if (V.winner != null) { nb.disabled = true; nb.textContent = "GAME OVER"; }
    else if (!myTurn) { nb.disabled = true; nb.textContent = V.pending && !V.pending.waiting ? "YOUR CALL" : "THEIR TURN"; }
    else if (V.pending) { nb.disabled = true; nb.textContent = V.pending.waiting ? "WAITING…" : "YOUR CALL"; }
    else {
      nb.disabled = !L.phase || !!sel;
      nb.textContent = V.phase === "main" && V.turn > 1 ? "BATTLE >" : "END TURN >";
    }

    renderBanner();
    tweenLp();
    if (!$("grave-view").hidden) fillGrave(ui.graveP);
    restoreDetail();
    if (V.winner != null && $("duel-over").hidden) {
      setTimeout(() => { if (ui.V && ui.V.winner != null) showOver(ui.V.winner === ui.V.me, ui.V.endReason); }, 900);
    }
  }

  function renderField(V) {
    const chip = $("field-chip");
    const board = $("board");
    const id = V.field ? V.field.id : "";
    if (board.dataset.field !== id) {
      board.dataset.field = id;
      ["graph_paper", "ink_sea", "doodle_park"].forEach((f) => board.classList.toggle("field-" + f, f === id));
    }
    if (!chip) return;
    if (!V.field) { chip.hidden = true; chip.dataset.id = ""; return; }
    chip.hidden = false;
    if (chip.dataset.id === id + V.field.owner) return;
    chip.dataset.id = id + V.field.owner;
    const d = BY[id];
    chip.innerHTML = "";
    const l = document.createElement("span"); l.className = "fc-l"; l.textContent = "FIELD";
    const n = document.createElement("b"); n.textContent = d.name;
    chip.appendChild(l); chip.appendChild(n);
    chip.title = d.effect + " (played by " + (V.field.owner === V.me ? "you" : V.players[V.field.owner].name) + ")";
    chip.onmouseenter = () => showDetail({ id }, null);
    chip.onmouseleave = restoreDetail;
    chip.onclick = (ev) => { ev.stopPropagation(); ui.anchorKey = null; if (isWide()) { ui.pinned = { c: { id }, item: null, info: "FIELD: affects both players.", btns: null, key: null }; restoreDetail(); } else openSheet({ id }, "FIELD: affects both players.", [{ label: "BACK", fn: closeSheet }]); };
  }

  function renderHint(V) {
    const el = $("duel-hint");
    el.innerHTML = "";
    el.className = "hint";
    if (discarding(V)) {
      const n = V.pending.count || 1;
      el.classList.add("discard-label");
      const t = document.createElement("span");
      t.className = "discard-text";
      t.textContent = "DISCARD " + n + " CARD" + (n > 1 ? "S" : "") + (ui.discardPick != null ? " · TAP IT AGAIN" : " · TAP ONE");
      el.appendChild(t);
      if (ui.discardPick != null) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "small discard-go"; b.textContent = "DISCARD";
        b.addEventListener("click", confirmDiscard);
        el.appendChild(b);
      }
      return;
    }
    el.textContent = hintText(V);
  }

  function renderLog(V) {
    const list = $("log-list");
    const key = V.log.join("\u0001");
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.innerHTML = "";
    V.log.forEach((t, i) => {
      const li = document.createElement("li");
      li.textContent = t;
      const k = /SPRING|TRAP|NOPE|SCRATCH|SPIKE|MIRROR|WHOOPS|PITFALL|STICKY|SMUDGE/.test(t) ? "lg-trap"
        : /attacks|hits directly|destroy|DESTROY/.test(t) ? "lg-fight"
        : /gains? \d+ LP|REFILL|CRAYON/.test(t) ? "lg-heal"
        : /casts?|attach|field|FIELD/.test(t) ? "lg-cast"
        : /turn|draw/.test(t) ? "lg-turn" : "";
      li.className = k + (i === V.log.length - 1 ? " newest" : "");
      list.appendChild(li);
    });
    list.scrollTop = list.scrollHeight;
  }

  // fan + overlap so any hand size fits the row
  function fanHand(row, small) {
    const kids = Array.from(row.children);
    const n = kids.length;
    if (!n) return;
    const cw = kids[0].getBoundingClientRect().width || 80;
    const avail = Math.max(cw, (row.clientWidth || window.innerWidth - 24) - 8);
    const gap = small ? 3 : 8;
    const natural = n * cw + (n - 1) * gap;
    const step = natural > avail ? (avail - cw) / Math.max(1, n - 1) : cw + gap;
    const spread = Math.min(small ? 3 : 4.5, (small ? 18 : 26) / n);
    kids.forEach((c, i) => {
      const off = i - (n - 1) / 2;
      c.style.marginLeft = i === 0 ? "0" : (step - cw) + "px";
      c.style.setProperty("--rot", (small ? -1 : 1) * off * spread + "deg");
      c.style.setProperty("--ty", (small ? -1 : 1) * Math.abs(off) * Math.abs(off) * (small ? 0.8 : 1.6) + "px");
      c.style.zIndex = String(i + 1);
    });
  }

  function renderBanner() {
    const V = ui.V;
    const b = $("duel-banner"), bt = $("banner-btns");
    bt.innerHTML = "";
    const btn = (label, fn) => { const x = document.createElement("button"); x.type = "button"; x.textContent = label; x.addEventListener("click", fn); bt.appendChild(x); };
    const sel = ui.select;
    if (sel) {
      b.hidden = false;
      $("banner-text").textContent = sel.prompt;
      btn("CANCEL", () => { ui.select = null; render(); });
      return;
    }
    if (V && V.pending && !V.pending.waiting && V.pending.player === V.me && V.winner == null) {
      const pd = V.pending;
      if (pd.type === "trap") {
        const O = V.players[1 - V.me], P = V.players[V.me];
        if (pd.on === "spell") {
          const sp = pd.spell ? BY[pd.spell.id] : null;
          const t = pd.spell && pd.spell.target ? V.players[pd.spell.target.p].mz[pd.spell.target.slot] : null;
          $("banner-text").textContent = "They cast " + (sp ? sp.name : "a spell") + (t ? " on " + BY[t.id].name : "") + ". Counter it?";
          pd.options.forEach((slot) => btn("COUNTER: " + BY[P.sz[slot].id].name, () => ui.ctl.act({ a: "respond", slot })));
          btn("LET IT RESOLVE", () => ui.ctl.act({ a: "respond", slot: null }));
        } else if (pd.on === "summon") {
          const m = pd.summoned ? V.players[pd.summoned.p].mz[pd.summoned.slot] : null;
          $("banner-text").textContent = "They summoned " + (m ? BY[m.id].name + " (ATK " + m.atk + ")" : "a monster") + ". Spring a trap?";
          pd.options.forEach((slot) => btn("SPRING " + BY[P.sz[slot].id].name, () => ui.ctl.act({ a: "respond", slot })));
          btn("LET IT BE", () => ui.ctl.act({ a: "respond", slot: null }));
        } else {
          const att = O.mz[pd.attacker];
          const tgt = pd.target == null ? null : P.mz[pd.target];
          $("banner-text").textContent = (att ? BY[att.id].name + " (ATK " + att.atk + ")" : "A monster") + " attacks " +
            (tgt ? BY[tgt.id].name : pd.fly ? "you directly, flying (half damage)" : "you directly") + ". Spring a trap?";
          pd.options.forEach((slot) => btn("SPRING " + BY[P.sz[slot].id].name, () => ui.ctl.act({ a: "respond", slot })));
          btn("LET IT THROUGH", () => ui.ctl.act({ a: "respond", slot: null }));
        }
        b.hidden = false;
        return;
      }

    }
    b.hidden = true;
  }

  function tweenLp() {
    const V = ui.V;
    const me = V.me;
    animateLp([V.players[1 - me].lp, V.players[me].lp], 520);
  }
  function animateLp(targets, dur) {
    const els = [$("opp-lp"), $("my-lp")];
    const from = ui.shownLp.slice();
    const start = performance.now();
    dur = reduced() ? 1 : dur;
    cancelAnimationFrame(ui.lpRaf);
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      for (let i = 0; i < 2; i++) {
        const v = Math.round(from[i] + (targets[i] - from[i]) * k);
        ui.shownLp[i] = v;
        els[i].textContent = String(v);
        els[i].classList.toggle("low", v <= 1000);
      }
      if (k < 1) ui.lpRaf = requestAnimationFrame(step);
    };
    ui.lpRaf = requestAnimationFrame(step);
  }

  /* ================= graveyard viewer ================= */
  function openGrave(p) {
    if (!ui.V) return;
    ui.graveP = p;
    fillGrave(p);
    $("grave-view").hidden = false;
    $("grave-x").focus({ preventScroll: true });
  }
  function fillGrave(p) {
    const V = ui.V;
    if (!V) return;
    const pl = V.players[p];
    const mine = p === V.me;
    $("grave-title").textContent = mine ? "YOUR GRAVEYARD" : (pl.name + "'S GRAVEYARD").toUpperCase();
    const n = pl.grave.length;
    $("grave-sub").textContent = n ? n + (n === 1 ? " CARD" : " CARDS") + "  ·  NEWEST FIRST  ·  TAP ONE TO READ IT" : "Empty. Nothing has gone to the graveyard yet.";
    const grid = $("grave-grid");
    grid.innerHTML = "";
    pl.grave.slice().reverse().forEach((c, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "grave-cell";
      cell.setAttribute("aria-label", BY[c.id].name);
      cell.appendChild(cardEl(c));
      if (i === 0) { const t = document.createElement("span"); t.className = "grave-tag"; t.textContent = "NEWEST"; cell.appendChild(t); }
      cell.addEventListener("click", () => {
        grid.querySelectorAll(".grave-cell.on").forEach((x) => x.classList.remove("on"));
        cell.classList.add("on");
        if (isWide()) { ui.pinned = { c, item: null, info: "IN THE GRAVEYARD", btns: null, key: null }; restoreDetail(); }
        else openSheet(c, describe(BY[c.id]) + "\nIn the graveyard.", [{ label: "BACK", fn: closeSheet }]);
      });
      hoverable(cell, () => c);
      grid.appendChild(cell);
    });
  }
  function closeGrave() {
    $("grave-view").hidden = true;
    if (ui.pinned && ui.pinned.info === "IN THE GRAVEYARD") ui.pinned = null;
    restoreDetail();
  }
  $("grave-x").addEventListener("click", closeGrave);
  $("grave-view").addEventListener("click", (e) => { if (e.target === $("grave-view")) closeGrave(); });

  /* ================= fight animations ================= */
  function zoneNode(p, kind, slot) {
    return document.querySelector('.zone[data-p="' + p + '"][data-kind="' + kind + '"][data-slot="' + slot + '"]');
  }
  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function floatText(anchor, text, cls) {
    if (!anchor) return;
    const c = center(anchor);
    const f = document.createElement("div");
    f.className = "floater " + (cls || "");
    f.textContent = text;
    f.style.left = c.x + "px";
    f.style.top = c.y + "px";
    $("float-layer").appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }
  // hand-drawn arrow: a jittery polyline that draws itself in
  function drawArrow(fromEl, toEl) {
    const svg = $("arrow-layer");
    svg.innerHTML = "";
    if (!fromEl || !toEl) return Promise.resolve();
    const a = center(fromEl), b = center(toEl);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const start = { x: a.x + ux * 24, y: a.y + uy * 24 };
    const end = { x: b.x - ux * 18, y: b.y - uy * 18 };
    const seg = 9, pts = [];
    for (let i = 0; i <= seg; i++) {
      const k = i / seg;
      const bow = Math.sin(k * Math.PI) * Math.min(40, len * 0.12);
      const j = i === 0 || i === seg ? 0 : (Math.random() * 2 - 1) * 4;
      pts.push([start.x + (end.x - start.x) * k + nx * (bow + j), start.y + (end.y - start.y) * k + ny * (bow + j)]);
    }
    const ns = "http://www.w3.org/2000/svg";
    const mk = (d, cls) => { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); p.setAttribute("class", cls); svg.appendChild(p); return p; };
    const d = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
    mk(d, "arrow-halo");
    const line = mk(d, "arrow-line");
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const hx = last[0] - prev[0], hy = last[1] - prev[1], hl = Math.hypot(hx, hy) || 1;
    const bx = hx / hl, by = hy / hl, H = 22;
    const head = "M" + (last[0] - bx * H + -by * H * 0.7) + " " + (last[1] - by * H + bx * H * 0.7) +
      " L" + last[0] + " " + last[1] + " L" + (last[0] - bx * H - -by * H * 0.7) + " " + (last[1] - by * H - bx * H * 0.7);
    mk(head, "arrow-halo head");
    const hd = mk(head, "arrow-line head");
    if (reduced()) return Promise.resolve();
    const L = line.getTotalLength();
    line.style.strokeDasharray = L; line.style.strokeDashoffset = L;
    hd.style.opacity = "0";
    svg.querySelectorAll(".arrow-halo").forEach((h) => { h.style.strokeDasharray = L; h.style.strokeDashoffset = L; });
    void line.getBoundingClientRect();
    const t = Math.round(300 / ui.speed);
    svg.querySelectorAll(".arrow-halo:not(.head)").forEach((h) => { h.style.transition = "stroke-dashoffset " + t + "ms ease-out"; h.style.strokeDashoffset = "0"; });
    line.style.transition = "stroke-dashoffset " + t + "ms ease-out";
    line.style.strokeDashoffset = "0";
    return wait(300).then(() => {
      hd.style.opacity = "1";
      svg.querySelectorAll(".arrow-halo.head").forEach((h) => { h.style.strokeDasharray = "none"; h.style.strokeDashoffset = "0"; });
      return wait(220);
    });
  }
  function clearArrow() { $("arrow-layer").innerHTML = ""; ui.atkFrom = null; }

  function pulse(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 1000);
  }
  function shake(big) {
    if (reduced()) return;
    const b = $("screen-duel");
    b.classList.remove("shake", "shake-big");
    void b.offsetWidth;
    b.classList.add(big ? "shake-big" : "shake");
    setTimeout(() => b.classList.remove("shake", "shake-big"), 450);
  }

  async function trapFlash(e, prevV, target, label) {
    const d = BY[e.id];
    const isTrap = d.kind === "trap";
    const z = e.zone === "sz" ? zoneNode(e.p, "sz", e.slot) : null;
    if (z) z.classList.add("flashing");
    const tz = target ? zoneNode(target.p, "mz", target.slot) : null;
    if (tz) tz.classList.add("trap-target");
    const box = $("trap-flash");
    const kindWord = isTrap ? (d.sub === "counter" ? "COUNTER TRAP: " : "TRAP ACTIVATED: ")
      : d.sub === "field" ? "FIELD SPELL: " : d.sub === "equip" ? "EQUIP: " : d.sub === "curse" ? "CURSE: " : d.sub === "buff" ? "BUFF: " : "SPELL: ";
    $("trap-flash-text").textContent = label || kindWord + d.name;
    box.className = "trap-flash sub-" + (isTrap ? "trap" : d.sub);
    box.classList.toggle("is-trap", isTrap);
    box.hidden = false;
    box.classList.remove("go"); void box.offsetWidth; box.classList.add("go");
    if (tz && z && !reduced()) drawArrow(z, tz);
    if (isTrap) { shake(false); LLCAudio.play("cast"); }
    await wait(isTrap ? 950 : 650);
    box.hidden = true;
    if (tz) tz.classList.remove("trap-target");
    if (tz && z) $("arrow-layer").innerHTML = "";
  }
  // a dying card cracks and fades on the old board before the new one is drawn
  async function deathAnim(events) {
    const dying = events.filter((e) => e.e === "destroy" || e.e === "tribute" || e.e === "bounce" || e.e === "unequip");
    let any = false;
    dying.forEach((e) => {
      if (e.slot == null) return;
      const kind = e.e === "unequip" || e.zone === "sz" ? "sz" : "mz";
      const z = zoneNode(e.p, kind, e.slot);
      const f = z && z.querySelector(".fcard");
      if (f) { f.classList.add(e.e === "bounce" ? "bouncing" : "dying"); any = true; }
    });
    if (any) { LLCAudio.play("hit", 0.5); await wait(420); }
  }

  // the fight pop-up: both cards, the numbers, the result; tap to skip
  function showClash(e, V, negated) {
    return new Promise((resolve) => {
      const me = V.me;
      const box = $("clash");
      const A = $("clash-a"), D = $("clash-d");
      A.innerHTML = ""; D.innerHTML = "";
      const side = (holder, id, val, label, dead) => {
        const c = document.createElement("div");
        c.className = "clash-card";
        if (id) c.appendChild(cardEl({ id }));
        else {
          const t = document.createElement("div");
          t.className = "clash-direct";
          t.innerHTML = "<span>DIRECT</span><span>HIT</span>";
          c.appendChild(t);
        }
        holder.appendChild(c);
        const n = document.createElement("div");
        n.className = "clash-val";
        n.innerHTML = label ? '<span class="lbl">' + label + "</span><b>" + val + "</b>" : "<b>" + val + "</b>";
        holder.appendChild(n);
        if (dead) {
          const s = document.createElement("div");
          s.className = "stamp";
          s.textContent = "DESTROYED";
          c.appendChild(s);
        }
      };
      const who = (p) => (p === me ? "YOU" : V.players[p].name);
      let nums, result, loser = null;
      if (negated) {
        side(A, e.aId, e.A, "ATK", false);
        side(D, e.trapId, "", "", false);
        nums = "";
        result = "STOPPED BY " + BY[e.trapId].name + "!";
      } else {
        side(A, e.aId, e.A, "ATK", e.aDestroyed);
        if (e.target == null) side(D, null, who(1 - e.p) + "", "", false);
        else side(D, e.dId, e.D, e.dPos === "def" ? "DEF" : "ATK", e.dDestroyed);
        nums = e.target == null ? "ATK " + e.A + "  >  DIRECT" : "ATK " + e.A + "  vs  " + (e.dPos === "def" ? "DEF " : "ATK ") + e.D;
        const bits = [];
        if (e.saved) bits.push("DOT DUMMY SHRUGS IT OFF (SHIELD USED UP)");
        if (e.dmg) { bits.push(who(e.dmgTo) + "  -" + e.dmg + " LP"); loser = e.dmgTo; }
        else if (!e.aDestroyed && !e.dDestroyed && !e.saved) bits.push("NO DAMAGE");
        result = bits.join("  ·  ") || (e.aDestroyed && e.dDestroyed ? "BOTH DESTROYED" : "DESTROYED");
      }
      $("clash-nums").textContent = nums;
      $("clash-result").textContent = result;
      box.classList.toggle("from-me", e.p === me);
      box.hidden = false;
      box.classList.remove("go"); void box.offsetWidth; box.classList.add("go");
      LLCAudio.play("hit");
      if (loser != null) {
        setTimeout(() => {
          LLCAudio.play("drain");
          if (e.dmg >= 1000) shake(true); else shake(false);
          const tgt = ui.shownLp.slice();
          const idx = loser === me ? 1 : 0;
          tgt[idx] = Math.max(0, tgt[idx] - e.dmg);
          animateLp(tgt, 600);
        }, reduced() ? 0 : 380 / ui.speed);
      }
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        box.removeEventListener("click", finish);
        box.hidden = true;
        resolve();
      };
      box.addEventListener("click", finish);
      setTimeout(finish, reduced() ? 600 : 1700 / ui.speed);
    });
  }

  let queue = Promise.resolve();
  function onView(V, events) {
    ui.pendingViews = (ui.pendingViews || 0) + 1;
    queue = queue
      .then(() => playView(V, events || []))
      .catch((e) => { console.error("duel view", e); try { ui.V = V; render(); } catch (e2) {} })
      .then(() => { ui.pendingViews = Math.max(0, (ui.pendingViews || 0) - 1); if (ui.autoplay) autoTick(); });
  }
  async function playView(V, events) {
    const prev = ui.V;
    const me = V.me;
    const atk = events.find((e) => e.e === "attack");
    if (atk && prev) {
      ui.atkFrom = { p: atk.p, slot: atk.slot };
      const fromEl = zoneNode(atk.p, "mz", atk.slot);
      if (fromEl) fromEl.classList.add("attacking");
      const toEl = atk.target == null ? (atk.p === me ? $("opp-lp") : $("my-lp")) : zoneNode(1 - atk.p, "mz", atk.target);
      if (toEl && atk.target != null) toEl.classList.add("attacked-target");
      LLCAudio.play("slide", 0.7);
      await drawArrow(fromEl, toEl);
    }
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.e === "activate" && prev) {
        const fx = events.slice(i + 1).find((x) => x.e === "trapfx" && x.id === e.id);
        await trapFlash(e, prev, e.target || (fx && fx.target) || null);
      }
      if (e.e === "countered" && prev) await trapFlash({ id: e.by, p: 1 - e.p, zone: null }, prev, null, "COUNTERED: " + BY[e.id].name + " FIZZLES!");
      if (e.e === "clash") { await showClash(e, V, false); }
      if (e.e === "negated") {
        const at = prev && prev.players[e.p].mz[e.slot];
        await showClash({ p: e.p, aId: at ? at.id : null, A: at ? at.atk : 0, trapId: e.id }, V, true);
      }
    }
    if (prev) await deathAnim(events);
    if (!(V.pending && V.pending.type === "trap" && V.pending.on === "attack")) clearArrow();
    if (prev && V.seq !== prev.seq && ui.pinned && ui.pinned.key) ui.pinned = null;
    ui.V = V;
    if (ui.select && (!V.legal || V.active !== V.me)) ui.select = null;
    // remember the most recent card for the detail panel's idle state
    for (const e of events) {
      if (e.e === "summon") { const m = V.players[e.p].mz[e.slot]; if (m) ui.lastSeen = { c: m, item: m }; }
      if (e.e === "activate") ui.lastSeen = { c: { id: e.id }, item: null };
    }
    render();
    const has = (k) => events.some((e) => e.e === k);
    if (has("summon") || has("setst") || has("pos")) LLCAudio.play("place");
    if (has("activate")) LLCAudio.play("cast");
    if (has("damage") && !has("clash")) setTimeout(() => LLCAudio.play("drain"), 120);
    if (has("turn") && !has("over")) LLCAudio.play("slide", 0.6);
    events.forEach((e) => {
      if (e.e === "damage") floatText(e.p === me ? $("my-lp") : $("opp-lp"), "-" + e.amount, "dmg");
      if (e.e === "destroy") { const z = zoneNode(e.p, "mz", e.slot); if (z) floatText(z, "DESTROYED", "poof-t"); }
      if (e.e === "summon") {
        const z = zoneNode(e.p, "mz", e.slot);
        if (z) { z.classList.add("just-placed"); floatText(z, e.pos === "def" ? "DEFENSE" : "SUMMON", "sum-t"); }
      }
      if (e.e === "pos") { const z = zoneNode(e.p, "mz", e.slot); const m = V.players[e.p].mz[e.slot]; if (z && m) floatText(z, m.pos === "def" ? "TO DEFENSE" : "TO ATTACK", "sum-t"); }
      if (e.e === "effect") { const z = zoneNode(e.p, "mz", e.slot); if (z) { z.classList.add("glow"); floatText(z, "POWER UP!", "sum-t"); } }
      if (e.e === "turn") floatText($("duel-mid"), e.p === me ? "YOUR TURN" : "THEIR TURN", "turn");
      const lpEl = (p) => (p === me ? $("my-lp") : $("opp-lp"));
      if (e.e === "heal" && e.amount) { floatText(lpEl(e.p), "+" + e.amount, "heal"); pulse(lpEl(e.p), "lp-heal"); }
      if (e.e === "damage" && e.amount) pulse(lpEl(e.p), "lp-hit");
      if (e.e === "damage" && e.god) floatText(lpEl(e.p), "GOD MODE", "sum-t");
      if (e.e === "buff" || e.e === "debuff") {
        const z = zoneNode(e.p, "mz", e.slot);
        if (z) { floatText(z, (e.amount > 0 ? "+" : "") + e.amount + " ATK", e.amount > 0 ? "buff" : "debuff"); pulse(z, e.amount > 0 ? "buffed" : "debuffed"); }
      }
      if (e.e === "equip") {
        const z = e.target && zoneNode(e.target.p, "mz", e.target.slot);
        const sz = zoneNode(e.p, "sz", e.slot);
        if (z) { floatText(z, e.curse ? "CURSED!" : "EQUIPPED!", e.curse ? "debuff" : "buff"); pulse(z, e.curse ? "debuffed" : "buffed"); }
        if (sz) pulse(sz, "just-placed");
        if (z && sz && !reduced()) { drawArrow(sz, z); setTimeout(() => { if (!ui.select) $("arrow-layer").innerHTML = ""; }, 900 / ui.speed); }
      }
      if (e.e === "unequip") { const z = zoneNode(e.p, "sz", e.slot); if (z) floatText(z, "GONE", "poof-t"); }
      if (e.e === "bounce" && e.slot != null) { const z = zoneNode(e.p, "mz", e.slot); if (z) floatText(z, "BACK TO HAND", "sum-t"); }
      if (e.e === "bounce" && e.slot == null) floatText(e.p === me ? $("my-hand") : $("opp-hand"), BY[e.id].name + " RETURNS", "sum-t");
      if (e.e === "field") { floatText($("duel-mid"), "FIELD: " + BY[e.id].name, "turn"); pulse($("board"), "field-change"); }
      if (e.e === "discard" && e.p !== me) floatText($("opp-hand"), "DISCARDED " + BY[e.id].name, "poof-t");
      if (e.e === "draw" && events.filter((x) => x.e === "draw").length <= 3 && !events.some((x) => x.e === "turn") && e.p === me) {
        const h = $("my-hand").lastElementChild; if (h) pulse(h, "just-drawn");
      }
    });
    const delay = events.some((e) => e.e === "destroy" || e.e === "damage") ? 320 : 80;
    await wait(delay);
  }

  /* ================= input ================= */
  function needTributes(card, V) {
    if (card.id === "doodle_prince" && V && V.players[V.me].mz.some((m) => m && BY[m.id].type === "DOODLE")) return 0;
    return E.tributesNeeded(card);
  }
  const busy = () => ui.awaiting || (ui.pendingViews || 0) > 0;
  function discarding(V) { return !!(V && V.pending && !V.pending.waiting && V.pending.player === V.me && V.pending.type === "discard"); }
  function onHand(c) {
    const V = ui.V;
    if (!V || V.winner != null || busy()) return;
    if (discarding(V)) {
      // two taps: first marks the card with a red X, second (or the DISCARD button) throws it away
      if (ui.discardPick === c.uid) confirmDiscard();
      else { ui.discardPick = c.uid; render(); }
      return;
    }
    if (ui.select) return;
    const key = "h" + c.uid;
    if (isWide() && ui.pinned && ui.pinned.key === key) { unpin(); return; }
    ui.anchorKey = key;
    const opts = (V.legal.hand[c.uid]) || [];
    const card = BY[c.id];
    const btns = [];
    const trib = needTributes(card, V);
    if (opts.includes("summon")) btns.push({ label: (trib ? "TRIBUTE + " : "") + "SUMMON IN ATTACK", fn: () => doSummon(c, "summon") });
    if (opts.includes("set")) btns.push({ label: (trib ? "TRIBUTE + " : "") + "SUMMON IN DEFENSE", fn: () => doSummon(c, "set") });
    if (opts.includes("activate")) btns.push({ label: "CAST", fn: () => doCast({ uid: c.uid }, c.id) });
    if (opts.includes("setst")) btns.push({ label: "SET FACE-DOWN", fn: () => { closeSheet(); ui.ctl.act({ a: "setst", uid: c.uid }); } });
    let info = "";
    if (!btns.length && V.active === V.me && V.phase === "main" && !V.pending) {
      if (card.kind === "monster" && V.players[V.me].summoned) info = "You already played a monster this turn.";
      else if (card.kind === "monster" && trib) info = "Needs " + trib + " of your monsters to tribute.";
      else if (card.kind === "trap") info = "No room to set it.";
    } else if (!btns.length && V.active !== V.me) info = "Wait for your turn to play it.";
    else if (!btns.length && V.phase === "battle") info = "Cards are played in your MAIN phase.";
    btns.push({ label: "CLOSE", fn: closeSheet });
    openSheet(c, info, btns);
  }

  function defaultHand(c) {
    const V = ui.V;
    if (!V || V.winner != null || busy() || discarding(V) || ui.select) return;
    const opts = (V.legal.hand[c.uid]) || [];
    ui.pinned = null; ui.anchorKey = null; restoreDetail(); closeSheet();
    if (opts.includes("activate")) doCast({ uid: c.uid }, c.id);
    else if (opts.includes("summon")) doSummon(c, "summon");
    else if (opts.includes("setst")) ui.ctl.act({ a: "setst", uid: c.uid });
  }

  function doSummon(c, mode) {
    closeSheet();
    const V = ui.V;
    const need = needTributes(BY[c.id], V);
    if (!need) { ui.ctl.act({ a: mode, uid: c.uid }); return; }
    const targets = V.players[V.me].mz.map((m, slot) => (m ? { p: V.me, slot } : null)).filter(Boolean);
    ui.select = { purpose: "tribute", uid: c.uid, mode, need, picked: [], targets, prompt: "Pick " + need + " of your monsters to tribute." };
    render();
  }

  function doCast(src, id) {
    closeSheet();
    const V = ui.V;
    const key = src.uid != null ? "h" + src.uid : "s" + src.slot;
    const tg = V.spellTargets && V.spellTargets[key];
    if (tg) {
      const d = BY[id];
      const who = d.fx.tgt === "my_mon" ? "one of YOUR monsters" : d.fx.tgt === "any_mon" ? "a monster" : d.fx.tgt === "opp_def" ? "one of THEIR defense monsters" : "one of THEIR monsters";
      ui.select = { purpose: "cast", src, targets: tg.map((t) => ({ p: t.p, slot: t.slot })), prompt: d.name + ": pick " + who + "." };
      render();
      return;
    }
    ui.ctl.act(Object.assign({ a: "activate" }, src));
  }

  function confirmDiscard() {
    const V = ui.V;
    const uid = ui.discardPick;
    if (!discarding(V) || uid == null || busy()) return;
    const h = document.querySelector('#my-hand .hcard[data-uid="' + uid + '"]');
    const pile = document.querySelector('.pile-grave[data-p="' + V.me + '"]');
    ui.discardPick = null;
    LLCAudio.play("slide");
    flyTo(h, pile).then(() => ui.ctl.act({ a: "discard", uid }));
  }
  function flyTo(el, target) {
    if (!el || !target || reduced()) return Promise.resolve();
    const a = el.getBoundingClientRect(), b = target.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.className = "hcard ghost-fly discard-mode";
    Object.assign(ghost.style, { position: "fixed", left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px", margin: 0, zIndex: 60, transform: "none" });
    document.body.appendChild(ghost);
    el.style.visibility = "hidden";
    void ghost.offsetWidth;
    const sx = b.width / a.width * 0.8;
    ghost.style.transition = "transform 0.38s cubic-bezier(0.5, 0, 0.6, 1), opacity 0.38s";
    ghost.style.transform = "translate(" + (b.left + b.width / 2 - (a.left + a.width / 2)) + "px," + (b.top + b.height / 2 - (a.top + a.height / 2)) + "px) scale(" + sx + ") rotate(14deg)";
    return new Promise((r) => setTimeout(() => { ghost.remove(); r(); }, 400));
  }

  function onZone(kind, p, slot) {
    const V = ui.V;
    if (!V || V.winner != null || busy()) return;
    const sel = ui.select;
    if (sel) {
      if (!sel.targets.some((t) => t.p === p && t.slot === slot && (t.kind || "mz") === kind)) return;
      if (sel.purpose === "tribute") {
        sel.picked.push(slot);
        if (sel.picked.length >= sel.need) {
          ui.select = null;
          ui.ctl.act({ a: sel.mode, uid: sel.uid, tributes: sel.picked });
        } else render();
        return;
      }
      ui.select = null;
      if (sel.purpose === "cast" || sel.purpose === "erase") ui.ctl.act(Object.assign({ a: "activate", target: { p, slot } }, sel.src));
      else if (sel.purpose === "attack") ui.ctl.act({ a: "attack", slot: sel.slot, target: slot });
      return;
    }
    const pl = V.players[p];
    const item = (kind === "mz" ? pl.mz : pl.sz)[slot];
    if (!item) return;
    const key = "z" + p + ":" + kind + ":" + slot;
    if (isWide() && ui.pinned && ui.pinned.key === key) { unpin(); return; }
    ui.anchorKey = key;
    const mine = p === V.me;
    const btns = [];
    let info = "";
    if (mine) {
      const opts = (kind === "mz" ? V.legal.mz : V.legal.sz)[slot] || [];
      if (kind === "mz") {
        if (opts.includes("attack")) {
          const tgts = (V.legal.atkTargets && V.legal.atkTargets[slot]) || [];
          if (V.legal.attackDirect || tgts.length) btns.push({ label: V.legal.attackDirect ? "ATTACK DIRECTLY" : "ATTACK", fn: () => {
            closeSheet();
            if (V.legal.attackDirect) { ui.ctl.act({ a: "attack", slot, target: null }); return; }
            const O = V.players[1 - V.me];
            const taunt = tgts.length < O.mz.filter(Boolean).length;
            ui.select = { purpose: "attack", slot, targets: tgts.map((s) => ({ p: 1 - V.me, slot: s })), prompt: taunt ? "TAPE MUMMY taunts: you must attack it." : "Pick one of their monsters to attack." };
            render();
          } });
          if (V.legal.fly && V.legal.fly[slot]) btns.push({ label: "FLY OVER (DIRECT, HALF DAMAGE)", fn: () => { closeSheet(); ui.ctl.act({ a: "attack", slot, target: null }); } });
        }
        if (opts.includes("pos")) btns.push({ label: item.pos === "atk" ? "SWITCH TO DEFENSE" : "SWITCH TO ATTACK", fn: () => { closeSheet(); ui.ctl.act({ a: "pos", slot }); } });
        if (opts.includes("effect")) btns.push({ label: "POWER UP", fn: () => { closeSheet(); ui.ctl.act({ a: "effect", slot }); } });
        if (!opts.length && V.active === V.me && V.phase === "battle" && item.summonedTurn === V.turn && item.id !== "stick_runner") info = "Just played, so it can't attack yet.";
        if (!opts.length && V.active === V.me && V.phase === "battle" && V.turn === 1) info = "No attacks on the very first turn.";
        if (!opts.length && item.attacked) info = "Already attacked this turn.";
      } else {
        if (opts.includes("activate")) btns.push({ label: "CAST", fn: () => doCast({ slot }, item.id) });
        const d = BY[item.id];
        const when = d.fx.on === "summon" ? "when they summon" : d.fx.on === "spell" ? "when they cast a spell" : "when they attack";
        if (item.faceUp) {
          const t = item.attach && V.players[item.attach.p].mz[item.attach.slot];
          info = (d.sub === "curse" ? "CURSE on " : "EQUIPPED to ") + (t ? BY[t.id].name : "a monster") + ". It goes to the graveyard if that monster leaves.";
        } else if (d.kind === "trap") info = item.setTurn < V.turn ? "Set face-down. Ready: it fires " + when + "." : "Set face-down. Ready from their next turn (" + when + ").";
        else info = "Set face-down.";
      }
    } else if (kind === "sz" && item.faceUp) {
      const d = BY[item.id];
      const t = item.attach && V.players[item.attach.p].mz[item.attach.slot];
      info = (d.sub === "curse" ? "CURSE on " : "EQUIPPED to ") + (t ? BY[t.id].name : "a monster") + ".";
    } else if (kind === "sz") info = "Could be a spell or a trap.";
    btns.push({ label: "CLOSE", fn: closeSheet });
    openSheet(item, info, btns, item);
  }

  function describe(c) {
    let s = c.name + "\n" + kindLabel(c);
    if (c.kind === "monster") s += "  ·  ATK " + c.atk + " / DEF " + c.def;
    s += "\n" + c.effect;
    return s;
  }

  // wide screens: actions live in the detail panel; phones: a bottom sheet
  function openSheet(c, info, btns, item) {
    const real = btns.filter((b) => b.label !== "CLOSE");
    if (isWide() && c !== null) {
      ui.pinned = { c, item: item || null, info, btns: real, key: ui.anchorKey || null };
      ui.anchorKey = null;
      restoreDetail();
      return;
    }
    const holder = $("sheet-card");
    holder.innerHTML = "";
    if (c) { holder.hidden = false; holder.appendChild(cardEl(c && c.hidden ? null : c)); }
    else holder.hidden = true;
    let text = info;
    if (c && c.id) {
      text = describe(BY[c.id]);
      if (item && item.pos) text += "\nON FIELD: " + (item.pos === "atk" ? "ATTACK" : "DEFENSE") + " MODE  ·  NOW " + item.atk + " / " + item.def;
      if (info) text += "\n" + info;
    } else if (c) text = "FACE-DOWN\n" + (info || "");
    $("sheet-info").textContent = text;
    const box = $("sheet-btns");
    box.innerHTML = "";
    btns.forEach((b) => {
      const x = document.createElement("button");
      x.type = "button"; x.textContent = b.label;
      x.addEventListener("click", b.fn);
      box.appendChild(x);
    });
    $("duel-sheet").hidden = false;
  }
  function closeSheet() {
    $("duel-sheet").hidden = true;
    if (ui.pinned && ui.pinned.btns && ui.pinned.btns.length) { ui.pinned = null; restoreDetail(); }
  }
  $("duel-sheet").addEventListener("click", (e) => { if (e.target === $("duel-sheet")) closeSheet(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("duel-sheet").hidden) { closeSheet(); return; }
    if (!$("grave-view").hidden) { closeGrave(); return; }
    if (ui.select) { ui.select = null; render(); return; }
    if (ui.pinned) { ui.pinned = null; restoreDetail(); }
  });
  // clicking anywhere that isn't a card, the menu or the panel drops the selection
  document.addEventListener("click", (e) => {
    if (!ui.pinned || !ui.pinned.key) return;
    if (e.target.closest(".zone.full, .hcard, .pile, #act-pop, #detail-panel, #duel-sheet, .grave-view, .banner")) return;
    unpin();
  });
  // clicking empty board space drops a pinned card
  $("board").addEventListener("click", (e) => {
    if (e.target.closest(".zone.full, .hcard, .pile, button")) return;
    if (ui.pinned) { ui.pinned = null; restoreDetail(); }
  });

  function showOver(win, reason) {
    LLCAudio.play(win ? "win" : "lose");
    $("over-title").textContent = win ? "YOU WIN!" : "YOU LOSE";
    let reward = 0;
    if (!ui.awarded && ui.ctl) {
      ui.awarded = true;
      reward = win ? (ui.ctl.mode === "online" ? 150 : 100) : 25;
      if (ui.ctl.mode === "online" && reason === "Your rival left the match.") reward = 150;
      LLCStorage.addInk(reward);
    }
    $("over-sub").textContent = (reason || "") + (reward ? "\n+" + reward + " INK  (you have " + LLCStorage.ink() + ")" : "");
    $("duel-over").hidden = false;
    closeSheet();
    closeGrave();
    $("duel-banner").hidden = true;
  }

  let toastT = null;
  function toast(msg) {
    LLCAudio.play("nope");
    ui.toasts = (ui.toasts || 0) + 1;
    ui.toastOn = true;
    $("duel-log").textContent = String(msg || "");
    clearTimeout(toastT);
    toastT = setTimeout(() => { ui.toastOn = false; if (ui.V) $("duel-log").textContent = ui.V.log[ui.V.log.length - 1] || ""; }, 2500);
  }

  let rz = null;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (ui.V) render(); }, 80); });
  wideMQ.addEventListener && wideMQ.addEventListener("change", () => { closeSheet(); ui.pinned = null; if (ui.V) render(); });

  /* ================= test / autoplay hook ================= */
  function autoTick() {
    clearTimeout(ui.autoT);
    ui.autoT = setTimeout(() => {
      const V = ui.V;
      if (!ui.autoplay || !V || V.winner != null || !ui.ctl) return;
      if (ui.pendingViews > 0) return;
      const mineToAct = V.pending ? (!V.pending.waiting && V.pending.player === V.me) : V.active === V.me;
      if (!mineToAct) return;
      const a = LLCAI.decide(V);
      if (a) ui.ctl.act(a);
      setTimeout(autoTick, 200 / ui.speed);
    }, 150 / ui.speed);
  }
  window.LLCDuel = {
    get V() { return ui.V; },
    get ctl() { return ui.ctl; },
    get toasts() { return ui.toasts || 0; },
    get busy() { return busy(); },
    setAuto(on, speed) { ui.autoplay = !!on; ui.speed = speed || 1; if (on) autoTick(); },
    openGrave,
    startBot,
    render: () => render(),
  };
})();
