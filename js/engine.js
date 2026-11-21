/* LLC Cards duel engine. Pure rules, no DOM. Host-authoritative:
   state + apply(state, player, action) -> events. Views are redacted per player.
   Yu-Gi-Oh-style: 4000 LP, stars/tributes as cost, 3 monster + 3 spell/trap zones each,
   one shared FIELD zone, equips/curses sit face-up in the spell/trap row attached to a monster. */
(function (global) {
  const START_LP = 4000;
  const HAND_START = 5;
  const HAND_LIMIT = 6;
  const ZONES = 3;
  const DECK_SIZE = 20;
  const FATIGUE = 500;            // no card to draw: lose 500 LP instead of an instant loss
  const MAX_TRAP_COPIES = 2;

  function rng(state) {
    let a = (state.rng = (state.rng + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(state, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng(state) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const def = (id) => global.LLCData.BY_ID[id];

  function create(opts) {
    const s = {
      v: 2, rng: (opts.seed >>> 0) || 1, turn: 0, active: 0, phase: "draw",
      players: [], cards: {}, nextUid: 1, pending: null, winner: null, endReason: "",
      log: [], seq: 0, field: null, god: [false, false],
    };
    [0, 1].forEach((p) => {
      const deck = (opts.decks[p] || []).slice(0, 40).filter((c) => def(c.id));
      const uids = deck.map((c) => {
        const uid = s.nextUid++;
        s.cards[uid] = { uid, id: c.id, foil: !!c.foil, owner: p };
        return uid;
      });
      s.players.push({
        name: String((opts.names && opts.names[p]) || (p ? "Opponent" : "You")).slice(0, 16),
        lp: START_LP, deck: shuffle(s, uids), hand: [], grave: [],
        mz: new Array(ZONES).fill(null), sz: new Array(ZONES).fill(null),
        summoned: false, trapTurn: -1, dummyUsed: false, fatigue: 0,
      });
    });
    s.first = opts.first != null ? opts.first : (rng(s) < 0.5 ? 0 : 1);
    s.active = s.first;
    const ev = [];
    [0, 1].forEach((p) => { for (let i = 0; i < HAND_START; i++) draw(s, p, ev, true); });
    log(s, ev, "{P" + s.first + ":goes|go} first.");
    startTurn(s, ev);
    return { state: s, events: ev };
  }

  function log(s, ev, text) {
    s.log.push(text);
    if (s.log.length > 60) s.log.shift();
    ev.push({ e: "log", text });
  }
  const nm = (s, uid) => (s.cards[uid] ? def(s.cards[uid].id).name : "?");

  function draw(s, p, ev, quiet) {
    const pl = s.players[p];
    if (!pl.deck.length) {
      if (quiet === "setup") return null;
      pl.fatigue++;
      log(s, ev, "{P" + p + ":has|have} no cards left to draw: -" + FATIGUE + " LP.");
      damage(s, p, FATIGUE, ev, "fatigue");
      return null;
    }
    const uid = pl.deck.pop();
    pl.hand.push(uid);
    ev.push({ e: "draw", p });
    return uid;
  }

  function lose(s, p, ev, reason) {
    if (s.winner != null) return;
    s.winner = 1 - p; s.phase = "over"; s.pending = null; s.endReason = reason;
    log(s, ev, reason);
    ev.push({ e: "over", winner: s.winner });
  }

  /* ---------- lookups ---------- */
  function cardOf(s, uid) { return s.cards[uid] ? def(s.cards[uid].id) : null; }
  function mon(s, p, slot) { return s.players[p].mz[slot] || null; }
  function findMon(s, uid) {
    for (let p = 0; p < 2; p++) for (let i = 0; i < ZONES; i++) { const m = s.players[p].mz[i]; if (m && m.uid === uid) return { p, slot: i, m }; }
    return null;
  }
  function attached(s, monUid) {
    const out = [];
    s.players.forEach((pl, p) => pl.sz.forEach((st, slot) => { if (st && st.attach === monUid) out.push({ p, slot, st, c: cardOf(s, st.uid) }); }));
    return out;
  }
  function freeSlot(arr) { return arr.indexOf(null); }
  function monsOf(s, p) { return s.players[p].mz.filter(Boolean); }
  function countMon(s, p) { return monsOf(s, p).length; }
  function countType(s, p, type, exceptUid) { return monsOf(s, p).filter((m) => m.uid !== exceptUid && cardOf(s, m.uid).type === type).length; }
  function controller(s, m) { const f = findMon(s, m.uid); return f ? f.p : s.cards[m.uid].owner; }
  function fieldMod(s, c) {
    if (!s.field) return [0, 0];
    const f = cardOf(s, s.field.uid).fx.field || {};
    return f[c.type] || [0, 0];
  }
  function atkOf(s, m) {
    if (!m) return 0;
    const c = cardOf(s, m.uid);
    let a = c.atk + (m.mod || 0) + (m.tmp || 0);
    attached(s, m.uid).forEach((x) => { a += x.c.fx.atk || 0; });
    a += fieldMod(s, c)[0];
    const p = controller(s, m);
    if (c.id === "doodle_dog" && countType(s, p, "BEAST", m.uid) > 0) a += 300;
    if (c.id === "notebook_hydra") a += Math.min(600, 100 * s.players[p].grave.filter((u) => cardOf(s, u).kind === "monster").length);
    return Math.max(0, a);
  }
  function defOf(s, m) {
    if (!m) return 0;
    const c = cardOf(s, m.uid);
    let d = c.def + (m.dmod || 0);
    attached(s, m.uid).forEach((x) => { d += x.c.fx.def || 0; });
    d += fieldMod(s, c)[1];
    return Math.max(0, d);
  }
  const pierces = (s, m) => cardOf(s, m.uid).id === "marker_titan" || attached(s, m.uid).some((x) => x.c.fx.pierce);
  const blocked = (s, m) => attached(s, m.uid).some((x) => x.c.fx.noAttack);
  const untargetable = (s, m, byP) => cardOf(s, m.uid).id === "scribble_cat" && controller(s, m) !== byP;
  function tributesNeeded(c, s, p) {
    if (c.id === "doodle_prince" && s && countType(s, p, "DOODLE") > 0) return 0;
    return c.stars >= 7 ? 2 : c.stars >= 5 ? 1 : 0;
  }

  /* ---------- moving cards ---------- */
  function sendToGrave(s, uid) { s.players[s.cards[uid].owner].grave.push(uid); }
  function detachAll(s, monUid, ev) {
    attached(s, monUid).forEach((x) => {
      s.players[x.p].sz[x.slot] = null;
      sendToGrave(s, x.st.uid);
      ev.push({ e: "unequip", p: x.p, slot: x.slot, id: x.c.id });
    });
  }
  function leaveField(s, p, slot, ev) {
    const m = s.players[p].mz[slot];
    if (!m) return null;
    s.players[p].mz[slot] = null;
    detachAll(s, m.uid, ev);
    return m;
  }
  /* by: "battle" | "effect"; killer: attacking monster for battle deaths */
  function destroyMon(s, p, slot, ev, by, killer) {
    const m = leaveField(s, p, slot, ev);
    if (!m) return;
    const c = cardOf(s, m.uid);
    const owner = s.cards[m.uid].owner;
    ev.push({ e: "destroy", p, zone: "mz", slot, id: c.id });
    if (by === "battle" && c.id === "ghost_scribble" && !s.cards[m.uid].ghostUsed) {
      s.cards[m.uid].ghostUsed = true;
      s.players[owner].hand.push(m.uid);
      ev.push({ e: "bounce", p: owner, id: c.id });
      log(s, ev, "GHOST SCRIBBLE floats back to {O" + owner + "} hand.");
    } else sendToGrave(s, m.uid);
    if (c.id === "paper_clip") { if (draw(s, owner, ev, true)) log(s, ev, "PAPER CLIP: {P" + owner + ":draws|draw} 1."); }
    if (by === "battle" && c.id === "ink_blot" && killer && findMon(s, killer.uid)) {
      killer.mod = (killer.mod || 0) - 300;
      ev.push({ e: "debuff", p: controller(s, killer), slot: findMon(s, killer.uid).slot, amount: -300 });
      log(s, ev, "INK BLOT stains " + nm(s, killer.uid) + ": -300 ATK for good.");
    }
  }
  function damage(s, p, amount, ev, kind) {
    if (amount <= 0 || s.winner != null) return;
    if (s.god[p]) { ev.push({ e: "damage", p, amount: 0, kind: kind || "", god: true }); return; }
    const pl = s.players[p];
    pl.lp = Math.max(0, pl.lp - amount);
    ev.push({ e: "damage", p, amount, kind: kind || "" });
    if (pl.lp <= 0) lose(s, p, ev, "{P" + p + ":is|are} out of LP.");
  }
  function heal(s, p, amount, ev) {
    s.players[p].lp += amount;
    ev.push({ e: "heal", p, amount });
  }

  /* ---------- turns ---------- */
  function startTurn(s, ev) {
    s.turn += 1;
    const p = s.active;
    const pl = s.players[p];
    pl.summoned = false;
    s.players.forEach((q) => q.mz.forEach((m) => { if (m) { m.attacked = 0; m.posChanged = false; m.lordUsed = false; } }));
    s.phase = "draw";
    ev.push({ e: "turn", p, turn: s.turn });
    // upkeep costs of the overpowered cards
    pl.mz.forEach((m) => {
      if (m && cardOf(s, m.uid).id === "eraser_god") { log(s, ev, "THE ERASER GOD drains {N" + p + "}: -600 LP."); damage(s, p, 600, ev, "upkeep"); }
    });
    pl.sz.forEach((st) => {
      if (st && st.faceUp && cardOf(s, st.uid).id === "cursed_crown") { log(s, ev, "CURSED CROWN weighs on {N" + p + "}: -500 LP."); damage(s, p, 500, ev, "upkeep"); }
    });
    if (s.winner != null) return;
    if (s.turn > 1) {
      const got = draw(s, p, ev, false);
      if (s.winner != null) return;
      if (got) log(s, ev, "{P" + p + ":draws|draw}.");
    }
    s.phase = "main";
  }
  function endTurn(s, ev) {
    s.phase = "end";
    s.players.forEach((q) => q.mz.forEach((m) => { if (m) m.tmp = 0; }));
    const pl = s.players[s.active];
    if (pl.hand.length > HAND_LIMIT) {
      s.pending = { type: "discard", player: s.active, count: pl.hand.length - HAND_LIMIT, then: "endturn" };
      return;
    }
    s.active = 1 - s.active;
    startTurn(s, ev);
  }

  /* ---------- targeting ---------- */
  function targetsFor(s, p, c) {
    const t = c.fx.tgt;
    if (!t) return null;
    const out = [];
    [0, 1].forEach((q) => s.players[q].mz.forEach((m, slot) => {
      if (!m) return;
      const mine = q === p;
      if (t === "my_mon" && !mine) return;
      if ((t === "opp_mon" || t === "opp_def") && mine) return;
      if (t === "opp_def" && m.pos !== "def") return;
      if (!mine && untargetable(s, m, p)) return;
      if (c.fx.maxAtk != null && atkOf(s, m) > c.fx.maxAtk) return;
      if (c.id === "knights_charge" && ["box_knight", "pencil_warrior"].indexOf(cardOf(s, m.uid).id) === -1) return;
      out.push({ p: q, slot });
    }));
    return out;
  }
  function graveRevive(s, p) {
    let best = null;
    s.players[p].grave.forEach((u) => { const c = cardOf(s, u); if (c.kind === "monster" && c.stars <= 4 && (!best || c.atk > cardOf(s, best).atk)) best = u; });
    return best;
  }
  function spellUsable(s, p, c, fromHand) {
    const pl = s.players[p];
    if (c.fx.attach && fromHand && freeSlot(pl.sz) === -1) return false;
    const tg = targetsFor(s, p, c);
    if (tg && !tg.length) return false;
    const anyMon = [0, 1].some((q) => countMon(s, q) > 0);
    switch (c.id) {
      case "quick_sketch": case "masterpiece": return pl.deck.length >= 1;
      case "ink_flood": return countMon(s, 1 - p) > 0;
      case "big_eraser": return anyMon;
      case "second_draft": return graveRevive(s, p) != null && freeSlot(pl.mz) !== -1;
      case "stick_squad": return countType(s, p, "DOODLE") >= 2;
      default: return true;
    }
  }

  /* ---------- traps ---------- */
  function trapOptions(s, p, on, ctx) {
    const out = [];
    const pl = s.players[p];
    if (pl.trapTurn === s.turn) return out;
    pl.sz.forEach((st, slot) => {
      if (!st || st.faceUp) return;
      const c = cardOf(s, st.uid);
      if (c.kind !== "trap" || st.setTurn >= s.turn || c.fx.on !== on) return;
      if (on === "attack") {
        const A = ctx.attacker ? atkOf(s, ctx.attacker) : 0;
        if (c.id === "whoops" && pl.lp <= 300) return;
        if (c.id === "spike_pit" && (A > 1600 || untargetable(s, ctx.attacker, p))) return;
      }
      if (on === "summon") {
        if (c.id === "pitfall_doodle" && (atkOf(s, ctx.m) < 1500 || untargetable(s, ctx.m, p))) return;
      }
      if (on === "spell") {
        if (c.id === "nope" && pl.lp <= 300) return;
        if (c.id === "scratch_that" && !(ctx.target && ctx.target.p === p)) return;
      }
      out.push(slot);
    });
    return out;
  }
  function springTrap(s, p, slot, ev) {
    const pl = s.players[p];
    const st = pl.sz[slot];
    const c = cardOf(s, st.uid);
    pl.sz[slot] = null;
    sendToGrave(s, st.uid);
    pl.trapTurn = s.turn;
    ev.push({ e: "activate", p, id: c.id, zone: "sz", slot, trap: true });
    return c;
  }

  /* ---------- legality ---------- */
  function canAttackWith(s, p, slot) {
    const m = mon(s, p, slot);
    if (!m || m.pos !== "atk" || m.attacked >= 1) return false;
    if (s.turn === 1) return false;
    if (blocked(s, m)) return false;
    const c = cardOf(s, m.uid);
    if (m.summonedTurn === s.turn && c.id !== "stick_runner") return false;
    return true;
  }
  function attackTargets(s, p) {
    const o = 1 - p;
    const opp = s.players[o].mz.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
    const taunts = opp.filter((i) => cardOf(s, s.players[o].mz[i].uid).id === "tape_mummy");
    return taunts.length ? taunts : opp;
  }
  function legal(s, p) {
    const L = { hand: {}, mz: {}, sz: {}, phase: false, attackDirect: false, atkTargets: {}, fly: {} };
    if (s.winner != null || s.pending || s.active !== p) return L;
    const pl = s.players[p];
    if (s.phase === "main") {
      L.phase = true;
      pl.hand.forEach((uid) => {
        const c = cardOf(s, uid);
        const opts = [];
        if (c.kind === "monster") {
          const need = tributesNeeded(c, s, p);
          const room = freeSlot(pl.mz) !== -1 || need > 0;
          if (!pl.summoned && countMon(s, p) >= need && room) opts.push("summon", "set");
        } else {
          if (c.kind === "spell" && spellUsable(s, p, c, true)) opts.push("activate");
          if (freeSlot(pl.sz) !== -1) opts.push("setst");
        }
        L.hand[uid] = opts;
      });
      pl.mz.forEach((m, slot) => {
        if (!m) return;
        const o = [];
        if (!m.posChanged && m.summonedTurn !== s.turn && !m.attacked) o.push("pos");
        if (cardOf(s, m.uid).id === "lord_of_lines" && !m.lordUsed && countMon(s, p) > 1) o.push("effect");
        L.mz[slot] = o;
      });
      pl.sz.forEach((st, slot) => {
        if (!st) return;
        const c = cardOf(s, st.uid);
        L.sz[slot] = !st.faceUp && c.kind === "spell" && spellUsable(s, p, c, false) ? ["activate"] : [];
      });
    } else if (s.phase === "battle") {
      L.phase = true;
      const oppHas = countMon(s, 1 - p) > 0;
      const tg = attackTargets(s, p);
      pl.mz.forEach((m, slot) => {
        if (!m) return;
        const ok = canAttackWith(s, p, slot);
        const c = cardOf(s, m.uid);
        const direct = !oppHas && c.id !== "robo_ruler";
        const fly = oppHas && c.id === "paper_plane";
        L.mz[slot] = ok && (oppHas || direct) ? ["attack"] : [];
        if (ok) { L.atkTargets[slot] = oppHas ? tg : []; L.fly[slot] = fly; }
      });
      L.attackDirect = !oppHas;
    }
    return L;
  }

  /* ---------- spells ---------- */
  function resolveSpell(s, p, sp, ev) {
    const { uid, target } = sp;
    const c = cardOf(s, uid);
    const pl = s.players[p], o = 1 - p;
    const tm = target ? mon(s, target.p, target.slot) : null;
    const place = () => {   // equips & curses stay face-up in the spell/trap row
      let slot = sp.fromSlot != null ? sp.fromSlot : freeSlot(pl.sz);
      if (slot === -1 || pl.sz[slot]) slot = freeSlot(pl.sz);
      if (slot === -1 || !tm) { sendToGrave(s, uid); return; }
      pl.sz[slot] = { uid, setTurn: s.turn, faceUp: true, attach: tm.uid };
      ev.push({ e: "equip", p, slot, id: c.id, target, curse: c.sub === "curse" });
    };
    if (c.fx.attach) {
      if (!tm) { log(s, ev, c.name + " fizzles."); sendToGrave(s, uid); return; }
      log(s, ev, "{P" + p + ":attaches|attach} " + c.name + " to " + nm(s, tm.uid) + ".");
      place();
      return;
    }
    if (c.sub === "field") {
      const prev = s.field;
      if (prev) sendToGrave(s, prev.uid);
      s.field = { uid, owner: p };
      ev.push({ e: "field", p, id: c.id, prev: prev ? s.cards[prev.uid].id : null });
      log(s, ev, "{P" + p + ":changes|change} the field to " + c.name + ".");
      return;
    }
    sendToGrave(s, uid);
    switch (c.id) {
      case "erase": case "crumple": case "stick_squad":
        if (!tm) break;
        log(s, ev, c.name + " destroys " + nm(s, tm.uid) + ".");
        destroyMon(s, target.p, target.slot, ev, "effect");
        break;
      case "quick_sketch":
        log(s, ev, "{P" + p + ":casts|cast} QUICK SKETCH: draw 2, discard 1.");
        draw(s, p, ev, true); draw(s, p, ev, true);
        if (pl.hand.length) s.pending = { type: "discard", player: p, count: 1, then: "main" };
        break;
      case "masterpiece":
        log(s, ev, "{P" + p + ":paints|paint} a MASTERPIECE: draw 3, discard 1.");
        draw(s, p, ev, true); draw(s, p, ev, true); draw(s, p, ev, true);
        if (pl.hand.length) s.pending = { type: "discard", player: p, count: 1, then: "main" };
        break;
      case "ink_flood":
        log(s, ev, "INK FLOOD: enemy monsters -500 ATK this turn.");
        s.players[o].mz.forEach((m, slot) => { if (m) { m.tmp = (m.tmp || 0) - 500; ev.push({ e: "debuff", p: o, slot, amount: -500 }); } });
        break;
      case "sharpen": case "knights_charge": {
        if (!tm) break;
        const n = c.id === "sharpen" ? 500 : 800;
        tm.tmp = (tm.tmp || 0) + n;
        ev.push({ e: "buff", p: target.p, slot: target.slot, amount: n });
        log(s, ev, nm(s, tm.uid) + " gains " + n + " ATK this turn.");
        break;
      }
      case "refill": heal(s, p, 1000, ev); log(s, ev, "REFILL: {P" + p + ":gains|gain} 1000 LP."); break;
      case "paper_cut": log(s, ev, "PAPER CUT: {P" + o + ":takes|take} 500 damage."); damage(s, o, 500, ev, "burn"); break;
      case "page_turn": {
        if (!tm) break;
        const owner = s.cards[tm.uid].owner;
        leaveField(s, target.p, target.slot, ev);
        s.players[owner].hand.push(tm.uid);
        ev.push({ e: "bounce", p: target.p, slot: target.slot, id: cardOf(s, tm.uid).id });
        log(s, ev, "PAGE TURN: " + nm(s, tm.uid) + " goes back to the hand.");
        break;
      }
      case "second_draft": {
        const r = graveRevive(s, p);
        const slot = freeSlot(pl.mz);
        if (r == null || slot === -1) break;
        pl.grave.splice(pl.grave.indexOf(r), 1);
        pl.mz[slot] = newMon(s, r, "def");
        ev.push({ e: "summon", p, slot, pos: "def", revive: true });
        log(s, ev, "SECOND DRAFT brings back " + nm(s, r) + " in defense mode.");
        break;
      }
      case "big_eraser": {
        log(s, ev, "THE BIG ERASER wipes the whole page!");
        [0, 1].forEach((q) => s.players[q].mz.forEach((m, slot) => { if (m) destroyMon(s, q, slot, ev, "effect"); }));
        const cost = Math.floor(pl.lp / 2);
        log(s, ev, "{P" + p + ":pays|pay} half of {O" + p + "} LP: -" + cost + ".");
        damage(s, p, cost, ev, "cost");
        break;
      }
    }
  }
  function castSpell(s, p, sp, ev) {
    const c = cardOf(s, sp.uid);
    ev.push({ e: "activate", p, id: c.id, zone: sp.fromSlot != null ? "sz" : "hand", slot: sp.fromSlot, target: sp.target || null });
    log(s, ev, "{P" + p + ":casts|cast} " + c.name + (sp.target ? " on " + nm(s, mon(s, sp.target.p, sp.target.slot).uid) : "") + ".");
    const opts = trapOptions(s, 1 - p, "spell", { target: sp.target });
    if (opts.length) { s.pending = { type: "trap", on: "spell", player: 1 - p, options: opts, spell: sp }; return; }
    resolveSpell(s, p, sp, ev);
  }

  /* ---------- summons ---------- */
  function newMon(s, uid, pos) {
    return { uid, pos, faceUp: true, mod: 0, dmod: 0, tmp: 0, summonedTurn: s.turn, attacked: 0, posChanged: false, lordUsed: false, kills: 0 };
  }
  function onSummon(s, p, slot, ev) {
    const m = mon(s, p, slot);
    const c = cardOf(s, m.uid);
    const o = 1 - p;
    switch (c.id) {
      case "squiggle_worm": if (draw(s, p, ev, true)) log(s, ev, "SQUIGGLE WORM: draw 1."); break;
      case "crayon_kid": heal(s, p, 500, ev); log(s, ev, "CRAYON KID: {P" + p + ":gains|gain} 500 LP."); break;
      case "shadow_hatch": {
        const h = s.players[o].hand;
        if (h.length) {
          const u = h.splice(Math.floor(rng(s) * h.length), 1)[0];
          sendToGrave(s, u);
          ev.push({ e: "discard", p: o, id: cardOf(s, u).id });
          log(s, ev, "SHADOW HATCH: {P" + o + ":discards|discard} " + nm(s, u) + ".");
        }
        break;
      }
      case "eraser_bug": {
        const opts = s.players[o].sz.map((st, i) => (st ? i : -1)).filter((i) => i >= 0);
        if (opts.length) {
          const i = opts[Math.floor(rng(s) * opts.length)];
          const st = s.players[o].sz[i];
          s.players[o].sz[i] = null;
          sendToGrave(s, st.uid);
          ev.push({ e: "destroy", p: o, zone: "sz", slot: i, id: cardOf(s, st.uid).id });
          log(s, ev, "ERASER BUG chews up " + nm(s, st.uid) + ".");
        }
        break;
      }
      case "ink_dragon": {
        log(s, ev, "INK DRAGON roars!");
        s.players[o].mz.forEach((x, i) => { if (x && atkOf(s, x) <= 1000) destroyMon(s, o, i, ev, "effect"); });
        break;
      }
      case "eraser_god": {
        log(s, ev, "THE ERASER GOD erases everything else!");
        [0, 1].forEach((q) => s.players[q].mz.forEach((x, i) => { if (x && x.uid !== m.uid) destroyMon(s, q, i, ev, "effect"); }));
        break;
      }
    }
    if (s.winner != null || !mon(s, p, slot)) return;
    const opts = trapOptions(s, o, "summon", { m });
    if (opts.length) s.pending = { type: "trap", on: "summon", player: o, options: opts, summoned: { p, slot } };
  }

  /* ---------- battle ---------- */
  function declareAttack(s, p, slot, target, ev, fly) {
    const m = mon(s, p, slot);
    m.attacked = (m.attacked || 0) + 1;
    const tgtName = target == null ? (fly ? "directly, flying over everyone" : "directly") : nm(s, mon(s, 1 - p, target).uid);
    log(s, ev, nm(s, m.uid) + " attacks " + tgtName + ".");
    ev.push({ e: "attack", p, slot, target, fly: !!fly });
    const opts = trapOptions(s, 1 - p, "attack", { attacker: m, target });
    if (opts.length) {
      s.pending = { type: "trap", on: "attack", player: 1 - p, attacker: slot, target, fly: !!fly, options: opts };
      return;
    }
    resolveBattle(s, p, slot, target, ev, fly);
  }
  function resolveBattle(s, p, slot, target, ev, fly) {
    const a = mon(s, p, slot);
    if (!a || s.winner != null) return;
    const o = 1 - p;
    const aName = nm(s, a.uid);
    const ac = cardOf(s, a.uid);
    const A = atkOf(s, a);
    const clash = { e: "clash", p, slot, target, aId: ac.id, A, dId: null, D: 0, dPos: null,
      aDestroyed: false, dDestroyed: false, dmgTo: null, dmg: 0, saved: false, pierce: false, fly: !!fly };
    if (target == null) {
      const dmg = fly ? Math.floor(A / 2) : A;
      clash.dmgTo = o; clash.dmg = dmg;
      log(s, ev, aName + " hits directly" + (fly ? " (half damage)" : "") + ": {P" + o + ":takes|take} " + dmg + ".");
      ev.push(clash);
      damage(s, o, dmg, ev, "battle");
      return;
    }
    const d = mon(s, o, target);
    if (!d) return;
    const dc = cardOf(s, d.uid);
    const dName = dc.name;
    clash.dId = dc.id; clash.dPos = d.pos;
    const survives = (m) => {
      const owner = s.cards[m.uid].owner;
      if (cardOf(s, m.uid).id === "dot_dummy" && !s.players[owner].dummyUsed) {
        s.players[owner].dummyUsed = true; clash.saved = true; return true;
      }
      return false;
    };
    const golemSafe = (who) => (who === p ? ac.id === "gear_golem" : dc.id === "gear_golem");
    let line = aName + " (ATK " + A + ") attacks " + dName;
    if (d.pos === "atk") {
      const D = atkOf(s, d); clash.D = D;
      line += " (ATK " + D + "): ";
      if (A > D) {
        if (!survives(d)) clash.dDestroyed = true;
        clash.dmgTo = o; clash.dmg = A - D;
      } else if (A < D) {
        if (!survives(a)) clash.aDestroyed = true;
        clash.dmgTo = p; clash.dmg = D - A;
      } else {
        if (!survives(d)) clash.dDestroyed = true;
        if (!survives(a)) clash.aDestroyed = true;
      }
    } else {
      const D = defOf(s, d); clash.D = D;
      line += " (DEF " + D + "): ";
      if (A > D) {
        if (!survives(d)) clash.dDestroyed = true;
        if (pierces(s, a)) { clash.pierce = true; clash.dmgTo = o; clash.dmg = A - D; }
      } else if (A < D) { clash.dmgTo = p; clash.dmg = D - A; }
    }
    if (clash.dmg && golemSafe(clash.dmgTo)) { clash.golem = true; clash.dmg = 0; }
    const bits = [];
    if (clash.dDestroyed) bits.push(dName + " is destroyed");
    if (clash.aDestroyed) bits.push(aName + " is destroyed");
    if (!clash.dDestroyed && !clash.aDestroyed) bits.push(d.pos === "def" && A < D_safe(clash) ? "it holds" : "no one falls");
    if (clash.dmg) bits.push("{P" + clash.dmgTo + ":takes|take} " + clash.dmg + (clash.pierce ? " (pierce)" : ""));
    if (clash.golem) bits.push("GEAR GOLEM blocks the damage");
    if (clash.saved) bits.push("DOT DUMMY's once-per-match shield is now used up");
    log(s, ev, line + bits.join(", ") + ".");
    ev.push(clash);
    if (clash.dDestroyed) {
      destroyMon(s, o, target, ev, "battle", a);
      const still = findMon(s, a.uid);
      if (still && !clash.aDestroyed) {
        if (ac.id === "box_knight" && (a.kills || 0) < 3) { a.kills = (a.kills || 0) + 1; a.mod = (a.mod || 0) + 200; ev.push({ e: "buff", p, slot, amount: 200 }); log(s, ev, "BOX KNIGHT gains 200 ATK."); }
        if (ac.id === "stapler_croc") { log(s, ev, "STAPLER CROC staples on 300 damage."); damage(s, o, 300, ev, "effect"); }
      }
    }
    if (clash.aDestroyed) destroyMon(s, p, slot, ev, "battle", d);
    if (clash.dmg) damage(s, clash.dmgTo, clash.dmg, ev, "battle");
  }
  function D_safe(clash) { return clash.D; }

  /* ---------- trap responses ---------- */
  function respondTrap(s, p, pend, slot, ev) {
    const pl = s.players[p];
    const other = 1 - p;
    if (pend.on === "attack") {
      const attacker = s.active;
      const a = mon(s, attacker, pend.attacker);
      if (slot != null) {
        const c = springTrap(s, p, slot, ev);
        ev.push({ e: "trapfx", p, id: c.id, target: { p: attacker, slot: pend.attacker } });
        if (c.id === "whoops") {
          log(s, ev, "{P" + p + ":pays|pay} 300 LP and {P" + p + ":springs|spring} WHOOPS! The attack is stopped.");
          damage(s, p, 300, ev, "cost");
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          if (a && atkOf(s, a) >= 1500) { a.mod = (a.mod || 0) - 500; ev.push({ e: "debuff", p: attacker, slot: pend.attacker, amount: -500 }); log(s, ev, nm(s, a.uid) + " loses 500 ATK for good."); }
          return;
        }
        if (c.id === "sticky_note") {
          log(s, ev, "{P" + p + ":springs|spring} STICKY NOTE: the attack stops and " + (a ? nm(s, a.uid) : "it") + " flips to defense.");
          if (a) { a.pos = "def"; ev.push({ e: "pos", p: attacker, slot: pend.attacker }); }
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          return;
        }
        if (c.id === "spike_pit") {
          log(s, ev, "{P" + p + ":springs|spring} SPIKE PIT! " + (a ? nm(s, a.uid) : "The attacker") + " falls in.");
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          if (a) destroyMon(s, attacker, pend.attacker, ev, "effect");
          return;
        }
        if (c.id === "mirror_sheet") {
          const back = a ? Math.floor(atkOf(s, a) / 2) : 0;
          log(s, ev, "{P" + p + ":springs|spring} MIRROR SHEET: the hit bounces back for " + back + ".");
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          damage(s, attacker, back, ev, "reflect");
          return;
        }
        if (c.id === "smudge") {
          log(s, ev, "{P" + p + ":springs|spring} SMUDGE: the attacker loses 300 ATK this turn.");
          if (a) { a.tmp = (a.tmp || 0) - 300; ev.push({ e: "debuff", p: attacker, slot: pend.attacker, amount: -300 }); }
        }
      }
      resolveBattle(s, attacker, pend.attacker, pend.target, ev, pend.fly);
      return;
    }
    if (pend.on === "summon") {
      if (slot != null) {
        const c = springTrap(s, p, slot, ev);
        const m = mon(s, pend.summoned.p, pend.summoned.slot);
        ev.push({ e: "trapfx", p, id: c.id, target: pend.summoned });
        if (m) {
          m.mod = (m.mod || 0) - 700;
          ev.push({ e: "debuff", p: pend.summoned.p, slot: pend.summoned.slot, amount: -700 });
          log(s, ev, "{P" + p + ":springs|spring} PITFALL DOODLE: " + nm(s, m.uid) + " loses 700 ATK for good.");
        }
      }
      return;
    }
    if (pend.on === "spell") {
      const sp = pend.spell;
      if (slot != null) {
        const c = springTrap(s, p, slot, ev);
        if (c.id === "nope") { log(s, ev, "{P" + p + ":pays|pay} 300 LP: NOPE! " + nm(s, sp.uid) + " is cancelled."); damage(s, p, 300, ev, "cost"); }
        else log(s, ev, "SCRATCH THAT! " + nm(s, sp.uid) + " is cancelled.");
        sendToGrave(s, sp.uid);
        ev.push({ e: "countered", p: other, id: cardOf(s, sp.uid).id, by: c.id });
        return;
      }
      resolveSpell(s, other, sp, ev);
    }
  }

  /* ---------- apply ---------- */
  function apply(s, p, act) {
    const ev = [];
    if (!act || typeof act !== "object") throw new Error("no action");
    if (s.winner != null) throw new Error("game over");
    if (act.a === "concede") { lose(s, p, ev, "{P" + p + ":concedes|concede}."); s.seq++; return ev; }
    const pl = s.players[p];
    const pend = s.pending;
    if (pend) {
      if (pend.player !== p) throw new Error("waiting on other player");
      if (pend.type === "trap" && act.a === "respond") {
        if (act.slot != null && pend.options.indexOf(act.slot) === -1) throw new Error("bad trap");
        s.pending = null;
        respondTrap(s, p, pend, act.slot, ev);
        s.seq++;
        return ev;
      }
      if (pend.type === "discard" && act.a === "discard") {
        const i = pl.hand.indexOf(act.uid);
        if (i === -1) throw new Error("not in hand");
        pl.hand.splice(i, 1);
        sendToGrave(s, act.uid);
        ev.push({ e: "discard", p, id: s.cards[act.uid].id });
        log(s, ev, "{P" + p + ":discards|discard} " + nm(s, act.uid) + ".");
        pend.count -= 1;
        if (pend.count <= 0 || !pl.hand.length) {
          s.pending = null;
          if (pend.then === "endturn") { s.active = 1 - s.active; startTurn(s, ev); }
        }
        s.seq++;
        return ev;
      }
      throw new Error("respond first");
    }
    if (s.active !== p) throw new Error("not your turn");
    const L = legal(s, p);
    switch (act.a) {
      case "defense": act = Object.assign({}, act, { a: "set" });
        /* falls through */
      case "summon":
      case "set": {
        const opts = L.hand[act.uid] || [];
        if (opts.indexOf(act.a) === -1) throw new Error("cannot summon");
        const c = cardOf(s, act.uid);
        const need = tributesNeeded(c, s, p);
        const trib = (act.tributes || []).filter((x, i, arr) => arr.indexOf(x) === i);
        if (trib.length !== need) throw new Error("need " + need + " tribute" + (need > 1 ? "s" : ""));
        trib.forEach((slot) => { if (!pl.mz[slot]) throw new Error("bad tribute"); });
        trib.forEach((slot) => {
          const m = pl.mz[slot];
          log(s, ev, nm(s, m.uid) + " is tributed.");
          leaveField(s, p, slot, ev);
          sendToGrave(s, m.uid);
          ev.push({ e: "tribute", p, slot, id: cardOf(s, m.uid).id });
        });
        const slot = act.slot != null && !pl.mz[act.slot] ? act.slot : freeSlot(pl.mz);
        if (slot === -1) throw new Error("no room");
        pl.hand.splice(pl.hand.indexOf(act.uid), 1);
        const atkMode = act.a === "summon";
        pl.mz[slot] = newMon(s, act.uid, atkMode ? "atk" : "def");
        pl.summoned = true;
        ev.push({ e: "summon", p, slot, pos: atkMode ? "atk" : "def", id: c.id });
        log(s, ev, "{P" + p + ":summons|summon} " + c.name + (atkMode ? " in attack mode." : " in defense mode."));
        onSummon(s, p, slot, ev);
        break;
      }
      case "activate": {
        const fromHand = act.uid != null;
        let uid;
        if (fromHand) {
          if ((L.hand[act.uid] || []).indexOf("activate") === -1) throw new Error("cannot activate");
          uid = act.uid;
        } else {
          if ((L.sz[act.slot] || []).indexOf("activate") === -1) throw new Error("cannot activate");
          uid = pl.sz[act.slot].uid;
        }
        const c = cardOf(s, uid);
        const tg = targetsFor(s, p, c);
        if (tg && !tg.some((t) => act.target && t.p === act.target.p && t.slot === act.target.slot)) throw new Error("pick a legal target for " + c.name);
        if (fromHand) pl.hand.splice(pl.hand.indexOf(uid), 1); else pl.sz[act.slot] = null;
        castSpell(s, p, { uid, target: tg ? { p: act.target.p, slot: act.target.slot } : null, fromSlot: fromHand ? null : act.slot }, ev);
        break;
      }
      case "setst": {
        if ((L.hand[act.uid] || []).indexOf("setst") === -1) throw new Error("cannot set");
        const slot = freeSlot(pl.sz);
        pl.hand.splice(pl.hand.indexOf(act.uid), 1);
        pl.sz[slot] = { uid: act.uid, setTurn: s.turn, faceUp: false, attach: null };
        ev.push({ e: "setst", p, slot });
        log(s, ev, "{P" + p + ":sets|set} a card.");
        break;
      }
      case "pos": {
        if ((L.mz[act.slot] || []).indexOf("pos") === -1) throw new Error("cannot change");
        const m = pl.mz[act.slot];
        m.posChanged = true;
        m.pos = m.pos === "atk" ? "def" : "atk";
        log(s, ev, nm(s, m.uid) + " switches to " + (m.pos === "atk" ? "attack" : "defense") + " mode.");
        ev.push({ e: "pos", p, slot: act.slot });
        break;
      }
      case "effect": {
        if ((L.mz[act.slot] || []).indexOf("effect") === -1) throw new Error("no effect");
        const m = pl.mz[act.slot];
        m.lordUsed = true;
        const gain = 100 * (countMon(s, p) - 1);
        m.tmp = (m.tmp || 0) + gain;
        ev.push({ e: "effect", p, slot: act.slot });
        ev.push({ e: "buff", p, slot: act.slot, amount: gain });
        log(s, ev, "LORD OF LINES gains " + gain + " ATK this turn.");
        break;
      }
      case "phase": {
        if (!L.phase) throw new Error("cannot change phase");
        if (s.phase === "main") {
          if (s.turn === 1) { log(s, ev, "No battle on the first turn."); endTurn(s, ev); }
          else { s.phase = "battle"; ev.push({ e: "phase", phase: "battle" }); }
        } else if (s.phase === "battle") endTurn(s, ev);
        break;
      }
      case "endturn": {
        if (!L.phase) throw new Error("cannot end");
        endTurn(s, ev);
        break;
      }
      case "attack": {
        if ((L.mz[act.slot] || []).indexOf("attack") === -1) throw new Error("cannot attack");
        let fly = false;
        if (act.target == null) {
          if (L.attackDirect) { if (cardOf(s, mon(s, p, act.slot).uid).id === "robo_ruler") throw new Error("ROBO RULER cannot attack directly"); }
          else if (L.fly[act.slot]) fly = true;
          else throw new Error("must target a monster");
        } else if ((L.atkTargets[act.slot] || []).indexOf(act.target) === -1) throw new Error(attackTargets(s, p).length && countMon(s, 1 - p) ? "a TAUNT monster must be attacked first" : "no target");
        declareAttack(s, p, act.slot, act.target, ev, fly);
        break;
      }
      default: throw new Error("unknown action");
    }
    s.seq++;
    return ev;
  }

  /* ---------- admin (local bot games only; the duel UI only calls this for vs-bot) ---------- */
  function admin(s, op) {
    const ev = [];
    const pl = s.players[op.p];
    if (op.cmd === "lp") { pl.lp = Math.max(0, Math.round(op.value)); ev.push({ e: "heal", p: op.p, amount: 0 }); log(s, ev, "ADMIN: " + pl.name + " LP set to " + pl.lp + "."); if (!pl.lp) lose(s, op.p, ev, "{P" + op.p + ":is|are} out of LP."); }
    if (op.cmd === "god") { s.god[op.p] = !!op.on; log(s, ev, "ADMIN: god mode " + (op.on ? "ON" : "OFF") + "."); }
    if (op.cmd === "spawn") {
      const c = def(op.id);
      if (!c) throw new Error("no card");
      const uid = s.nextUid++;
      s.cards[uid] = { uid, id: c.id, foil: false, owner: op.p };
      if (c.kind === "monster") {
        const slot = freeSlot(pl.mz);
        if (slot === -1) { delete s.cards[uid]; throw new Error("no room"); }
        pl.mz[slot] = newMon(s, uid, "atk"); pl.mz[slot].summonedTurn = -1;
        ev.push({ e: "summon", p: op.p, slot, pos: "atk", id: c.id });
      } else if (op.toHand || c.kind === "spell") {
        pl.hand.push(uid); ev.push({ e: "draw", p: op.p });
      } else {
        const slot = freeSlot(pl.sz);
        if (slot === -1) { delete s.cards[uid]; throw new Error("no room"); }
        pl.sz[slot] = { uid, setTurn: -1, faceUp: false, attach: null };
        ev.push({ e: "setst", p: op.p, slot });
      }
      log(s, ev, "ADMIN: spawned " + c.name + " for " + pl.name + ".");
    }
    if (op.cmd === "clear") {
      pl.mz.forEach((m, i) => { if (m) destroyMon(s, op.p, i, ev, "effect"); });
      if (op.all) pl.sz.forEach((st, i) => { if (st) { pl.sz[i] = null; sendToGrave(s, st.uid); ev.push({ e: "destroy", p: op.p, zone: "sz", slot: i, id: s.cards[st.uid].id }); } });
      log(s, ev, "ADMIN: cleared " + pl.name + "'s " + (op.all ? "field" : "monsters") + ".");
    }
    if (op.cmd === "draw") { draw(s, op.p, ev, true); }
    s.seq++;
    return ev;
  }

  function fmt(s, p, text) {
    return String(text || "").replace(/\{P(\d):([^|}]*)\|([^}]*)\}/g, (m, i, they, you) =>
      Number(i) === p ? "You " + you : s.players[Number(i)].name + " " + they)
      .replace(/\{N(\d)\}/g, (m, i) => (Number(i) === p ? "you" : s.players[Number(i)].name))
      .replace(/\{O(\d)\}/g, (m, i) => (Number(i) === p ? "your" : s.players[Number(i)].name + "'s"));
  }

  /* ---------- redacted view for player p ---------- */
  function view(s, p) {
    const pub = (uid) => { const c = s.cards[uid]; return { uid, id: c.id, foil: c.foil }; };
    const spellTargets = {};
    const pl = s.players[p];
    if (s.active === p && !s.pending && s.phase === "main") {
      pl.hand.forEach((uid) => { const t = targetsFor(s, p, cardOf(s, uid)); if (t) spellTargets["h" + uid] = t; });
      pl.sz.forEach((st, i) => { if (st && !st.faceUp) { const t = targetsFor(s, p, cardOf(s, st.uid)); if (t) spellTargets["s" + i] = t; } });
    }
    const V = {
      me: p, turn: s.turn, active: s.active, phase: s.phase, winner: s.winner, endReason: fmt(s, p, s.endReason),
      seq: s.seq, log: s.log.slice(-60).map((t) => fmt(s, p, t)), first: s.first,
      pending: null, god: s.god.slice(),
      field: s.field ? { id: s.cards[s.field.uid].id, owner: s.field.owner, uid: s.field.uid } : null,
      players: s.players.map((q, i) => ({
        name: q.name, lp: q.lp, deck: q.deck.length, fatigue: q.fatigue,
        grave: q.grave.map(pub),
        hand: i === p ? q.hand.map(pub) : q.hand.map(() => ({ hidden: true })),
        summoned: q.summoned, dummyUsed: !!q.dummyUsed, trapUsed: q.trapTurn === s.turn,
        mz: q.mz.map((m) => {
          if (!m) return null;
          const c = cardOf(s, m.uid);
          const o = { pos: m.pos, faceUp: true, summonedTurn: m.summonedTurn, attacked: m.attacked };
          Object.assign(o, pub(m.uid), {
            atk: atkOf(s, m), def: defOf(s, m), mod: atkOf(s, m) - c.atk,
            eq: attached(s, m.uid).map((x) => ({ id: x.c.id, p: x.p, slot: x.slot })),
            pierce: pierces(s, m), blocked: blocked(s, m), ghostUsed: !!s.cards[m.uid].ghostUsed,
          });
          return o;
        }),
        sz: q.sz.map((st) => {
          if (!st) return null;
          if (st.faceUp) {
            const f = findMon(s, st.attach);
            return Object.assign(pub(st.uid), { faceUp: true, setTurn: st.setTurn, attach: f ? { p: f.p, slot: f.slot } : null });
          }
          return i === p ? Object.assign(pub(st.uid), { setTurn: st.setTurn }) : { hidden: true };
        }),
      })),
      legal: legal(s, p),
      spellTargets,
    };
    if (s.pending && s.pending.player === p) {
      V.pending = JSON.parse(JSON.stringify(s.pending));
      if (s.pending.spell) V.pending.spell = { id: cardOf(s, s.pending.spell.uid).id, target: s.pending.spell.target };
    } else if (s.pending) V.pending = { type: s.pending.type, on: s.pending.on, player: s.pending.player, waiting: true };
    if (s.pending && s.pending.type === "trap") {
      V.pending.attacker = s.pending.attacker; V.pending.target = s.pending.target; V.pending.fly = s.pending.fly;
      V.pending.summoned = s.pending.summoned;
    }
    // legacy field kept for older UI code paths
    const e = def("erase");
    V.eraseTargets = targetsFor(s, p, e) || [];
    return V;
  }

  /* ---------- decks ---------- */
  function copyCap(c) { return c.rarity === "SCR" ? 1 : c.rarity === "SR" ? 2 : c.kind === "trap" ? MAX_TRAP_COPIES : 3; }
  function cardValue(c) {
    if (!c) return 0;
    if (c.kind === "monster") {
      const t = c.stars >= 7 ? 2 : c.stars >= 5 ? 1 : 0;
      return c.atk * (t === 2 ? 0.55 : t === 1 ? 0.75 : 1) + c.def * 0.25 + (c.sub === "effect" ? 150 : 0);
    }
    return ({ erase: 1100, crumple: 800, stick_squad: 900, page_turn: 900, quick_sketch: 800, masterpiece: 1100, ink_flood: 500,
      sharpen: 600, refill: 500, second_draft: 800, smear_curse: 800, writers_block: 900, paper_cut: 500, pencil_sword: 800,
      cardboard_shield: 600, ruler_lance: 900, cursed_crown: 1400, graph_paper: 600, ink_sea: 700, doodle_park: 700,
      knights_charge: 500, big_eraser: 1300, smudge: 700, sticky_note: 800, spike_pit: 900, whoops: 900, mirror_sheet: 1100,
      pitfall_doodle: 800, nope: 1000, scratch_that: 800 })[c.id] || 600;
  }
  /* Deck from the binder: owned cards first (best first, about 11 monsters / 6 spells / 3 traps),
     then common starters fill to 20. */
  function deckFromCollection(collection, opts) {
    opts = opts || {};
    const set = (collection && collection.edition_one) || {};
    const CARDS = global.LLCData.CARDS;
    const owned = CARDS.filter((c) => set[c.id] && set[c.id].owned);
    const want = { monster: 11, spell: 6, trap: 3 };
    const out = [];
    const add = (c, foil) => out.push({ id: c.id, foil: !!foil });
    const n = (id) => out.filter((x) => x.id === id).length;
    const kindCount = (k) => out.filter((x) => def(x.id).kind === k).length;
    const sorted = owned.slice().sort((a, b) => cardValue(b) - cardValue(a));
    // pass 1: owned cards up to the per-kind targets (one copy each first, then more copies)
    for (let round = 0; round < 3; round++) {
      sorted.forEach((c) => {
        if (out.length >= DECK_SIZE || n(c.id) > round || n(c.id) >= copyCap(c) || kindCount(c.kind) >= want[c.kind]) return;
        add(c, set[c.id].foil);
      });
    }
    // pass 2: commons as starters for whatever is missing
    const starters = CARDS.filter((c) => c.rarity === "C").sort((a, b) => cardValue(b) - cardValue(a));
    for (let round = 0; round < 3 && out.length < DECK_SIZE; round++) {
      starters.forEach((c) => {
        if (out.length >= DECK_SIZE || n(c.id) > round || n(c.id) >= copyCap(c) || kindCount(c.kind) >= want[c.kind]) return;
        add(c, set[c.id] && set[c.id].foil);
      });
    }
    // pass 3: anything legal
    for (const c of starters.concat(sorted)) { while (out.length < DECK_SIZE && n(c.id) < copyCap(c)) add(c, false); }
    return { cards: out.slice(0, DECK_SIZE), owned: owned.length };
  }
  /* The bot's deck: all commons plus a handful of random rares (and rarely a super rare). */
  function botDeck(seed) {
    const r = global.LLCData.mulberry32(seed >>> 0 || 7);
    const CARDS = global.LLCData.CARDS;
    const coll = { edition_one: {} };
    CARDS.forEach((c) => {
      const ch = c.rarity === "C" ? 0.75 : c.rarity === "R" ? 0.35 : c.rarity === "SR" ? 0.08 : 0;
      if (r() < ch) coll.edition_one[c.id] = { owned: true, foil: false };
    });
    return deckFromCollection(coll);
  }
  /* Custom decks: a list of card ids, limited by copies owned and the copy caps. Returns problems (empty = valid). */
  function deckProblems(ids, collection) {
    const set = (collection && collection.edition_one) || {};
    const probs = [];
    if (!Array.isArray(ids)) return ["no deck"];
    if (ids.length !== DECK_SIZE) probs.push(ids.length + " / " + DECK_SIZE + " cards");
    const counts = {};
    ids.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    Object.keys(counts).forEach((id) => {
      const c = def(id);
      if (!c) { probs.push("unknown card"); return; }
      const have = set[id] && set[id].owned ? set[id].n || 1 : 0;
      if (counts[id] > have) probs.push(c.name + ": you own " + have);
      else if (counts[id] > copyCap(c)) probs.push(c.name + ": max " + copyCap(c));
    });
    if (!ids.some((id) => def(id) && def(id).kind === "monster")) probs.push("needs a monster");
    return probs;
  }
  /* The deck a player battles with: the active custom deck if it is valid, else the auto deck. */
  function activeDeck(collection) {
    const c = collection || {};
    const i = c.activeDeck;
    const d = Array.isArray(c.decks) && typeof i === "number" && i >= 0 ? c.decks[i] : null;
    if (d && d.cards && !deckProblems(d.cards, c).length) {
      const set = c.edition_one || {};
      return { cards: d.cards.map((id) => ({ id, foil: !!(set[id] && set[id].foil) })), custom: true, name: d.name };
    }
    return Object.assign(deckFromCollection(c), { custom: false });
  }
  function validDeck(list) {
    if (!Array.isArray(list) || list.length !== DECK_SIZE) return false;
    const counts = {};
    return list.every((c) => {
      if (!c || !def(c.id)) return false;
      counts[c.id] = (counts[c.id] || 0) + 1;
      return counts[c.id] <= copyCap(def(c.id));
    });
  }

  global.LLCEngine = {
    START_LP, ZONES, DECK_SIZE, HAND_LIMIT, FATIGUE,
    create, apply, view, legal, admin, deckFromCollection, botDeck, validDeck, deckProblems, activeDeck, tributesNeeded, copyCap, cardValue,
    _atkOf: atkOf, _defOf: defOf, _mon: mon,
  };
})(typeof window !== "undefined" ? window : globalThis);
