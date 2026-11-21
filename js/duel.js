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
    $("deck-line").textContent = "YOUR DECK: 20 CARDS  ·  " + d.owned + " / 10 FROM YOUR BINDER" +
      (d.owned < 10 ? ", STARTERS FILL THE REST" : "");
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

  const hello = () => ({ v: 1, name: myName, deck: myDeck().cards });
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
    const bot = E.deckFromCollection({});
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
        const a = LLCAI.decide(E.view(s, 1));
        let ev;
        try { ev = E.apply(s, 1, a || { a: "phase" }); }
        catch (err) { ev = E.apply(s, 1, s.pending ? (s.pending.type === "trap" ? { a: "respond", slot: null } : { a: "discard", uid: s.players[1].hand[0] }) : { a: "endturn" }); }
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
      if (d.t === "state") { onView(d.view, d.events || []); if (ui.autoplay) autoTick(); }
      else if (d.t === "err") toast(d.msg);
    }, () => opponentLeft());
    return {
      mode: "online",
      start() { $("duel-log").textContent = "Shuffling…"; },
      act(a) { try { conn.send({ t: "act", action: a }); } catch (e) { toast("Connection lost."); } },
      leave() { close(); LLCNet.stop(); },
    };
  }

  function opponentLeft() {
    if (!ui.V || ui.V.winner != null) return;
    showOver(true, "Your rival left the match.");
  }

  /* ================= start / leave ================= */
  function resetBoardUi() {
    ui.V = null; ui.select = null; ui.shownSeq = -1;
    ui.shownLp = [4000, 4000];
    $("duel-over").hidden = true;
    $("duel-sheet").hidden = true;
    $("duel-banner").hidden = true;
    $("float-layer").innerHTML = "";
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

  /* ================= rendering ================= */
  function cardEl(c, opts) {
    opts = opts || {};
    if (!c || c.hidden || !c.id) {
      const el = document.createElement("div");
      el.className = "llc-card back-only";
      el.innerHTML = '<img src="assets/card_back.png?v=4" alt="Face-down card" draggable="false">';
      return el;
    }
    const el = LLCFoil.createCard(BY[c.id], { foil: !!c.foil, face: opts.back ? "back" : "front" });
    if (opts.back) el.classList.add("is-back");
    return el;
  }

  function zoneEl(kind, p, slot, item, V) {
    const z = document.createElement("div");
    z.className = "zone " + kind;
    z.dataset.p = p; z.dataset.slot = slot; z.dataset.kind = kind;
    if (item) {
      const wrap = document.createElement("div");
      wrap.className = "fcard";
      const faceDown = kind === "mz" ? !item.faceUp : true;
      const mineHidden = faceDown && item.id;
      const el = cardEl(item.id ? item : null, { back: false });
      if (mineHidden) el.classList.add("peek");
      if (kind === "mz" && item.pos === "def") wrap.classList.add("def");
      if (faceDown && !item.id) wrap.classList.add("down");
      if (faceDown) wrap.classList.add("facedown");
      wrap.appendChild(el);
      if (kind === "mz" && item.id) {
        const st = document.createElement("div");
        st.className = "stat" + (item.mod > 0 ? " up" : item.mod < 0 ? " down" : "");
        st.textContent = item.pos === "def" ? "DEF " + item.def : "ATK " + item.atk;
        wrap.appendChild(st);
      }
      if (kind === "mz" && item.attacked) wrap.classList.add("spent");
      z.appendChild(wrap);
    }
    return z;
  }

  function pileEl(label, n, top) {
    const d = document.createElement("div");
    d.className = "pile";
    if (top) d.appendChild(cardEl(top));
    else if (label === "DECK" && n) d.appendChild(cardEl(null));
    const t = document.createElement("span");
    t.className = "pile-n";
    t.textContent = label + " " + n;
    d.appendChild(t);
    return d;
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
    $("phases").querySelectorAll("span").forEach((s) => s.classList.toggle("on", s.dataset.ph === V.phase));
    $("duel-mid").classList.toggle("their-turn", !myTurn);
    $("duel-mid").classList.toggle("my-turn", myTurn);
    $("duel-log").textContent = V.log.length ? V.log[V.log.length - 1] : "";

    // opponent hand
    const oh = $("opp-hand");
    oh.innerHTML = "";
    O.hand.forEach(() => { const b = cardEl(null); b.classList.add("hand-back"); oh.appendChild(b); });
    fitHand(oh, 0.42);

    const rows = [
      ["opp-sz", "sz", op, O.sz, pileEl("GRAVE", O.grave.length, O.grave[O.grave.length - 1])],
      ["opp-mz", "mz", op, O.mz, pileEl("DECK", O.deck)],
      ["my-mz", "mz", me, P.mz, pileEl("DECK", P.deck)],
      ["my-sz", "sz", me, P.sz, pileEl("GRAVE", P.grave.length, P.grave[P.grave.length - 1])],
    ];
    rows.forEach(([id, kind, p, arr, pile]) => {
      const row = $(id);
      row.innerHTML = "";
      arr.forEach((item, slot) => {
        const z = zoneEl(kind, p, slot, item, V);
        if (sel) {
          if (isTarget(p, slot, kind)) z.classList.add("target");
          else if (sel.purpose === "tribute" && sel.picked && sel.picked.indexOf(slot) !== -1 && p === me && kind === "mz") z.classList.add("picked");
        } else if (p === me && myTurn && !V.pending) {
          const o = (kind === "mz" ? L.mz : L.sz)[slot];
          if (o && o.length) z.classList.add("can-act");
        }
        z.addEventListener("click", () => onZone(kind, p, slot));
        row.appendChild(z);
      });
      row.appendChild(pile);
    });

    // my hand
    const hand = $("my-hand");
    hand.innerHTML = "";
    const discarding = V.pending && !V.pending.waiting && V.pending.type === "discard";
    P.hand.forEach((c) => {
      const h = document.createElement("div");
      h.className = "hcard";
      h.appendChild(cardEl(c));
      if (discarding) h.classList.add("target");
      else if (!sel && myTurn && !V.pending && (L.hand[c.uid] || []).length) h.classList.add("can-act");
      h.addEventListener("click", () => onHand(c));
      hand.appendChild(h);
    });
    fitHand(hand, 0.86);

    // next button
    const nb = $("btn-next");
    if (V.winner != null) { nb.disabled = true; nb.textContent = "GAME OVER"; }
    else if (!myTurn) { nb.disabled = true; nb.textContent = V.pending && !V.pending.waiting ? "YOUR CALL" : "THEIR TURN"; }
    else if (V.pending) { nb.disabled = true; nb.textContent = V.pending.waiting ? "WAITING…" : "YOUR CALL"; }
    else {
      nb.disabled = !L.phase || !!sel;
      nb.textContent = V.phase === "main" && V.turn > 1 ? "BATTLE >" : "END TURN >";
    }

    // banners
    renderBanner();
    // LP
    tweenLp();
    if (V.winner != null && $("duel-over").hidden) {
      setTimeout(() => { if (ui.V && ui.V.winner != null) showOver(ui.V.winner === ui.V.me, ui.V.endReason); }, 700);
    }
  }

  function fitHand(row, wFactor) {
    const n = row.children.length;
    if (!n) return;
    const S = parseFloat(getComputedStyle($("board")).getPropertyValue("--S")) || 80;
    const cw = S * wFactor;
    const avail = (row.clientWidth || window.innerWidth - 24) - 12;
    const total = n * cw + (n - 1) * 6;
    const overlap = total > avail ? (total - avail) / (n - 1) + 6 : 0;
    Array.from(row.children).forEach((c, i) => { c.style.marginLeft = i === 0 ? "0" : (overlap ? -overlap + "px" : "6px"); });
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
      if (sel.direct) btn("DIRECT ATTACK", () => { const s = ui.select; ui.select = null; ui.ctl.act({ a: "attack", slot: s.slot, target: null }); });
      btn("CANCEL", () => { ui.select = null; render(); });
      return;
    }
    if (V && V.pending && !V.pending.waiting && V.pending.player === V.me && V.winner == null) {
      const pd = V.pending;
      if (pd.type === "trap") {
        const O = V.players[1 - V.me], P = V.players[V.me];
        const att = O.mz[pd.attacker];
        const tgt = pd.target == null ? null : P.mz[pd.target];
        $("banner-text").textContent = (att ? BY[att.id].name + " (ATK " + att.atk + ")" : "A monster") + " attacks " +
          (tgt ? (tgt.id ? BY[tgt.id].name : "your card") : "you directly") + ". Spring a trap?";
        pd.options.forEach((slot) => btn(BY[P.sz[slot].id].name, () => ui.ctl.act({ a: "respond", slot })));
        btn("NO", () => ui.ctl.act({ a: "respond", slot: null }));
        b.hidden = false;
        return;
      }
      if (pd.type === "discard") {
        $("banner-text").textContent = "Pick a card in your hand to discard" + (pd.count > 1 ? " (" + pd.count + " left)." : ".");
        b.hidden = false;
        return;
      }
    }
    b.hidden = true;
  }

  function tweenLp() {
    const V = ui.V;
    const me = V.me;
    const targets = [V.players[1 - me].lp, V.players[me].lp];
    const els = [$("opp-lp"), $("my-lp")];
    const from = ui.shownLp.slice();
    const start = performance.now();
    const dur = reduced() ? 1 : 520;
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

  /* ================= events → small animations ================= */
  function zoneNode(p, kind, slot) {
    return document.querySelector('.zone[data-p="' + p + '"][data-kind="' + kind + '"][data-slot="' + slot + '"]');
  }
  function floatText(anchor, text, cls) {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const f = document.createElement("div");
    f.className = "floater " + (cls || "");
    f.textContent = text;
    f.style.left = r.left + r.width / 2 + "px";
    f.style.top = r.top + r.height / 2 + "px";
    $("float-layer").appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }
  function lunge(fromEl, toEl) {
    return new Promise((res) => {
      const card = fromEl && fromEl.querySelector(".fcard");
      if (!card || reduced()) { res(); return; }
      const a = fromEl.getBoundingClientRect();
      const b = toEl ? toEl.getBoundingClientRect() : { left: a.left, top: a.top + (a.top > window.innerHeight / 2 ? -a.height * 2.2 : a.height * 2.2), width: a.width, height: a.height };
      const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) * 0.7;
      const dy = (b.top + b.height / 2 - (a.top + a.height / 2)) * 0.7;
      card.style.transition = "transform 0.18s cubic-bezier(0.5, 0, 0.9, 0.6)";
      card.style.transform = "translate(" + dx + "px," + dy + "px) scale(1.08)";
      card.style.zIndex = "20";
      setTimeout(() => {
        card.style.transition = "transform 0.2s cubic-bezier(0.2, 0.8, 0.3, 1)";
        card.style.transform = "";
        setTimeout(res, 120);
      }, 190);
    });
  }

  let queue = Promise.resolve();
  function onView(V, events) {
    ui.pendingViews = (ui.pendingViews || 0) + 1;
    queue = queue.then(() => playView(V, events || [])).catch((e) => console.warn(e));
  }
  async function playView(V, events) {
    const prev = ui.V;
    const atk = prev && events.find((e) => e.e === "attack");
    if (atk) LLCAudio.play("hit");
    if (atk && prev) {
      const attackerP = atk.p;
      const fromEl = zoneNode(attackerP, "mz", atk.slot);
      const toEl = atk.target == null ? null : zoneNode(1 - attackerP, "mz", atk.target);
      await lunge(fromEl, toEl);
    }
    ui.V = V;
    if (ui.select && (!V.legal || V.active !== V.me)) ui.select = null;
    render();
    const me = V.me;
    const has = (k) => events.some((e) => e.e === k);
    if (has("summon") || has("setmon") || has("setst") || has("pos")) LLCAudio.play("place");
    if (has("activate")) LLCAudio.play("cast");
    if (has("damage")) setTimeout(() => LLCAudio.play("drain"), 120);
    if (has("turn") && !has("over")) LLCAudio.play("slide", 0.6);
    events.forEach((e) => {
      if (e.e === "damage") floatText(e.p === me ? $("my-lp") : $("opp-lp"), "-" + e.amount, "dmg");
      if (e.e === "destroy") { const z = zoneNode(e.p, "mz", e.slot); if (z) { z.classList.add("poof"); floatText(z, "POOF", "poof-t"); } }
      if (e.e === "activate") floatText($("duel-mid"), BY[e.id].name + "!", "cast");
      if (e.e === "turn") floatText($("duel-mid"), e.p === me ? "YOUR TURN" : "THEIR TURN", "turn");
    });
    const delay = events.some((e) => e.e === "damage" || e.e === "destroy") ? 260 : 60;
    await new Promise((r) => setTimeout(r, reduced() ? 0 : delay / ui.speed));
    ui.pendingViews -= 1;
    if (ui.autoplay) autoTick();
  }

  /* ================= input ================= */
  function onHand(c) {
    const V = ui.V;
    if (!V || V.winner != null) return;
    if (V.pending && !V.pending.waiting && V.pending.type === "discard") {
      ui.ctl.act({ a: "discard", uid: c.uid });
      return;
    }
    if (ui.select) return;
    const opts = (V.legal.hand[c.uid]) || [];
    const card = BY[c.id];
    const btns = [];
    if (opts.includes("summon")) btns.push({ label: E.tributesNeeded(card) ? "TRIBUTE SUMMON" : "SUMMON", fn: () => doSummon(c, "summon") });
    if (opts.includes("set")) btns.push({ label: "SET (DEFENSE)", fn: () => doSummon(c, "set") });
    if (opts.includes("activate")) btns.push({ label: "CAST", fn: () => doCast({ uid: c.uid }, c.id) });
    if (opts.includes("setst")) btns.push({ label: "SET FACE-DOWN", fn: () => { closeSheet(); ui.ctl.act({ a: "setst", uid: c.uid }); } });
    let info = describe(card);
    if (!btns.length && V.active === V.me && V.phase === "main" && !V.pending) {
      if (card.kind === "monster" && V.players[V.me].summoned) info += "\nYou already played a monster this turn.";
      else if (card.kind === "monster" && E.tributesNeeded(card)) info += "\nNeeds 1 monster on your side to tribute.";
      else if (card.kind === "trap") info += "\nNo room to set it.";
    }
    btns.push({ label: "CLOSE", fn: closeSheet });
    openSheet(c, info, btns);
  }

  function doSummon(c, mode) {
    closeSheet();
    const need = E.tributesNeeded(BY[c.id]);
    if (!need) { ui.ctl.act({ a: mode, uid: c.uid }); return; }
    const V = ui.V;
    const targets = V.players[V.me].mz.map((m, slot) => (m ? { p: V.me, slot } : null)).filter(Boolean);
    ui.select = { purpose: "tribute", uid: c.uid, mode, need, picked: [], targets, prompt: "Pick " + need + " of your monsters to tribute." };
    render();
  }

  function doCast(src, id) {
    closeSheet();
    if (id === "erase") {
      const V = ui.V;
      ui.select = { purpose: "erase", src, targets: V.eraseTargets.map((t) => ({ p: t.p, slot: t.slot })), prompt: "ERASE: pick a face-up monster with 1000 ATK or less." };
      render();
      return;
    }
    ui.ctl.act(Object.assign({ a: "activate" }, src));
  }

  function onZone(kind, p, slot) {
    const V = ui.V;
    if (!V || V.winner != null) return;
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
      if (sel.purpose === "erase") ui.ctl.act(Object.assign({ a: "activate", target: { p, slot } }, sel.src));
      else if (sel.purpose === "attack") ui.ctl.act({ a: "attack", slot: sel.slot, target: slot });
      return;
    }
    const pl = V.players[p];
    const item = (kind === "mz" ? pl.mz : pl.sz)[slot];
    if (!item) return;
    const mine = p === V.me;
    const btns = [];
    let info = "";
    if (item.id) info = describe(BY[item.id]);
    else info = kind === "mz" ? "A face-down monster." : "A face-down spell or trap.";
    if (mine) {
      const opts = (kind === "mz" ? V.legal.mz : V.legal.sz)[slot] || [];
      if (kind === "mz") {
        if (item.id) info += "\nNow: " + (item.pos === "atk" ? "ATTACK" : "DEFENSE") + (item.faceUp ? "" : ", face-down") + "  ·  ATK " + item.atk + " / DEF " + item.def;
        if (opts.includes("attack")) {
          btns.push({ label: V.legal.attackDirect ? "ATTACK DIRECTLY" : "ATTACK", fn: () => {
            closeSheet();
            if (V.legal.attackDirect) { ui.ctl.act({ a: "attack", slot, target: null }); return; }
            const O = V.players[1 - V.me];
            ui.select = { purpose: "attack", slot, targets: O.mz.map((m, s) => (m ? { p: 1 - V.me, slot: s } : null)).filter(Boolean), prompt: "Pick a monster to attack." };
            render();
          } });
        }
        if (opts.includes("pos")) btns.push({ label: !item.faceUp ? "FLIP UP" : item.pos === "atk" ? "TO DEFENSE" : "TO ATTACK", fn: () => { closeSheet(); ui.ctl.act({ a: "pos", slot }); } });
        if (opts.includes("effect")) btns.push({ label: "POWER UP", fn: () => { closeSheet(); ui.ctl.act({ a: "effect", slot }); } });
        if (!opts.length && V.active === V.me && V.phase === "battle" && item.summonedTurn === V.turn && item.id !== "stick_runner") info += "\nJust played, so it can't attack yet.";
        if (!opts.length && V.active === V.me && V.phase === "battle" && V.turn === 1) info += "\nNo attacks on the very first turn.";
      } else {
        if (opts.includes("activate")) btns.push({ label: "CAST", fn: () => doCast({ slot }, item.id) });
        if (BY[item.id].kind === "trap") info += item.setTurn < V.turn ? "\nReady. It fires when they attack." : "\nReady from their next turn.";
      }
    }
    btns.push({ label: "CLOSE", fn: closeSheet });
    openSheet(item.id ? item : { hidden: true }, info, btns);
  }

  function describe(c) {
    let s = c.name + "\n" + c.stars + "-STAR " + c.kind.toUpperCase();
    if (c.kind === "monster") s += "  ·  ATK " + c.atk + " / DEF " + c.def;
    s += "\n" + c.effect;
    return s;
  }

  function openSheet(c, info, btns) {
    const holder = $("sheet-card");
    holder.innerHTML = "";
    if (c) { holder.hidden = false; holder.appendChild(cardEl(c && c.hidden ? null : c)); }
    else holder.hidden = true;
    $("sheet-info").textContent = info;
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
  function closeSheet() { $("duel-sheet").hidden = true; }
  $("duel-sheet").addEventListener("click", (e) => { if (e.target === $("duel-sheet")) closeSheet(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSheet(); if (ui.select) { ui.select = null; render(); } }
  });

  function showOver(win, reason) {
    LLCAudio.play(win ? "win" : "lose");
    $("over-title").textContent = win ? "YOU WIN!" : "YOU LOSE";
    $("over-sub").textContent = reason || "";
    $("duel-over").hidden = false;
    closeSheet();
    $("duel-banner").hidden = true;
  }

  let toastT = null;
  function toast(msg) {
    LLCAudio.play("nope");
    ui.toasts = (ui.toasts || 0) + 1;
    $("duel-log").textContent = String(msg || "");
    clearTimeout(toastT);
  }

  window.addEventListener("resize", () => { if (ui.V) render(); });

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
    setAuto(on, speed) { ui.autoplay = !!on; ui.speed = speed || 1; if (on) autoTick(); },
    startBot,
  };
})();
