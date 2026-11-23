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
  const NORMAL_SUMMONS_PER_TURN = 2;   // shared by the engine, UI and bot; tribute summons count, special summons do not

  function summonsUsed(pl) { return pl.summons || 0; }
  function canNormalSummon(pl) { return summonsUsed(pl) < NORMAL_SUMMONS_PER_TURN; }
  function summonsLeft(pl) { return Math.max(0, NORMAL_SUMMONS_PER_TURN - summonsUsed(pl)); }

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
  function isFusion(c) { return !!(c && c.fx && c.fx.fusion); }
  function ownedRec(collection, id) {
    if (!collection) return null;
    return (collection.edition_one && collection.edition_one[id]) ||
           (collection.edition_two && collection.edition_two[id]) || null;
  }

  function create(opts) {
    const s = {
      v: 2, rng: (opts.seed >>> 0) || 1, turn: 0, active: 0, phase: "draw",
      players: [], cards: {}, nextUid: 1, pending: null, winner: null, endReason: "",
      log: [], seq: 0, field: null, god: [false, false],
    };
    [0, 1].forEach((p) => {
      const deck = (opts.decks[p] || []).slice(0, 40).filter((c) => def(c.id) && !isFusion(def(c.id)));
      const uids = deck.map((c) => {
        const uid = s.nextUid++;
        s.cards[uid] = { uid, id: c.id, foil: !!c.foil, owner: p };
        return uid;
      });
      const hangarSrc = ((opts.hangars && opts.hangars[p]) || []).filter((c) => def(c.id) && isFusion(def(c.id))).slice(0, 2);
      const hangar = hangarSrc.map((c) => {
        const uid = s.nextUid++;
        s.cards[uid] = { uid, id: c.id, foil: !!c.foil, owner: p };
        return uid;
      });
      s.players.push({
        name: String((opts.names && opts.names[p]) || (p ? "Opponent" : "You")).slice(0, 16),
        lp: START_LP, deck: shuffle(s, uids), hand: [], grave: [], hangar,
        mz: new Array(ZONES).fill(null), sz: new Array(ZONES).fill(null),
        summons: 0, fused: false, trapTurn: -1, dummyUsed: false, fatigue: 0,
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
  function fieldMod(s, c, m) {
    if (!s.field) return [0, 0];
    const fc = cardOf(s, s.field.uid);
    const f = fc.fx.field || {};
    let bonus = (f[c.type] || [0, 0]).slice();
    if (fc.fx.fieldFusion && isFusion(c) && m && s.field.owner === controller(s, m)) {
      bonus[0] += fc.fx.fieldFusion[0] || 0;
      bonus[1] += fc.fx.fieldFusion[1] || 0;
    }
    return bonus;
  }
  function atkOf(s, m) {
    if (!m) return 0;
    const c = cardOf(s, m.uid);
    let a = c.atk + (m.mod || 0) + (m.tmp || 0);
    attached(s, m.uid).forEach((x) => { a += x.c.fx.atk || 0; });
    a += fieldMod(s, c, m)[0];
    const p = controller(s, m);
    if (c.id === "doodle_dog" && countType(s, p, "BEAST", m.uid) > 0) a += 300;
    if (c.id === "notebook_hydra") a += Math.min(600, 100 * s.players[p].grave.filter((u) => cardOf(s, u).kind === "monster").length);
    if (c.fx.atkPerType) {
      a += (c.fx.atkPerType[1] || 0) * countType(s, p, c.fx.atkPerType[0], m.uid);
    }
    return Math.max(0, a);
  }
  function defOf(s, m) {
    if (!m) return 0;
    const c = cardOf(s, m.uid);
    let d = c.def + (m.dmod || 0);
    attached(s, m.uid).forEach((x) => { d += x.c.fx.def || 0; });
    d += fieldMod(s, c, m)[1];
    return Math.max(0, d);
  }
  const pierces = (s, m) => {
    const c = cardOf(s, m.uid);
    return c.id === "marker_titan" || !!(c.fx && c.fx.pierce) || attached(s, m.uid).some((x) => x.c.fx.pierce);
  };
  const blocked = (s, m) => attached(s, m.uid).some((x) => x.c.fx.noAttack);
  const untargetable = (s, m, byP) => {
    const c = cardOf(s, m.uid);
    return controller(s, m) !== byP && (c.id === "scribble_cat" || !!(c.fx && c.fx.untargetable));
  };
  const spellUntargetable = (s, m, byP) => untargetable(s, m, byP) || (controller(s, m) !== byP && !!(cardOf(s, m.uid).fx && cardOf(s, m.uid).fx.spellUntargetable));
  function tributesNeeded(c, s, p) {
    if (c.id === "doodle_prince" && s && countType(s, p, "DOODLE") > 0) return 0;
    if (c.fx && c.fx.noTributeIfType && s && countType(s, p, c.fx.noTributeIfType) > 0) return 0;
    return c.stars >= 7 ? 2 : c.stars >= 5 ? 1 : 0;
  }
  function maxAttacks(s, m) {
    const c = cardOf(s, m.uid);
    let n = 1;
    if (c.fx && c.fx.attackTwice) n = 2;
    if (c.fx && c.fx.extraAttackOnKill && m.extraReady) n += 1;
    return n;
  }
  function pickMats(s, p, recipe) {
    const used = {};
    const mats = [];
    const avail = () => s.players[p].mz.map((m, i) => (!m || used[i] || !m.faceUp) ? null : { i, m, c: cardOf(s, m.uid) }).filter(Boolean);
    for (let r = 0; r < recipe.length; r++) {
      const req = recipe[r];
      const found = req.id ? avail().find((x) => x.c.id === req.id) : avail().find((x) => x.c.type === req.type);
      if (!found) return null;
      used[found.i] = true;
      mats.push(found.i);
    }
    return mats;
  }
  function legalFusions(s, p) {
    const pl = s.players[p];
    if (!pl || s.turn <= 1 || pl.fused) return [];
    const out = [];
    (pl.hangar || []).forEach((uid) => {
      const c = cardOf(s, uid);
      if (!isFusion(c)) return;
      const mats = pickMats(s, p, c.fx.fusion);
      if (mats) out.push({ id: c.id, uid, mats });
    });
    return out;
  }
  function bounceToOwner(s, m, ev) {
    const owner = s.cards[m.uid].owner;
    const c = cardOf(s, m.uid);
    if (isFusion(c)) {
      s.players[owner].hangar.push(m.uid);
      ev.push({ e: "hangar", p: owner, id: c.id, uid: m.uid });
      log(s, ev, c.name + " returns to {O" + owner + "} Hangar.");
    } else {
      s.players[owner].hand.push(m.uid);
      ev.push({ e: "bounce", p: owner, id: c.id });
    }
  }
  function sendMaterial(s, p, slot, ev) {
    const m = leaveField(s, p, slot, ev);
    if (!m) return;
    const c = cardOf(s, m.uid);
    const owner = s.cards[m.uid].owner;
    ev.push({ e: "destroy", p, zone: "mz", slot, id: c.id, material: true });
    sendToGrave(s, m.uid);
    if (c.fx && c.fx.onMaterialDraw) {
      if (draw(s, owner, ev, true)) log(s, ev, c.name + ": {P" + owner + ":draws|draw} 1 (material).");
    }
  }
  function performFusion(s, p, choice, ev) {
    const pl = s.players[p];
    const hi = (pl.hangar || []).indexOf(choice.uid);
    if (hi === -1) return;
    (choice.mats || []).forEach((slot) => sendMaterial(s, p, slot, ev));
    pl.hangar.splice(hi, 1);
    const slot = freeSlot(pl.mz);
    if (slot === -1) { pl.hangar.push(choice.uid); log(s, ev, "MECH LINK fizzles: no room."); return; }
    pl.mz[slot] = newMon(s, choice.uid, "atk");
    pl.fused = true;
    ev.push({ e: "summon", p, slot, pos: "atk", fusion: true, id: cardOf(s, choice.uid).id });
    log(s, ev, "{P" + p + ":links|link} " + nm(s, choice.uid) + " from the Hangar!");
    onSummon(s, p, slot, ev);
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
    if (by === "battle" && ((c.id === "ghost_scribble") || (c.fx && c.fx.ghostReturn)) && !s.cards[m.uid].ghostUsed) {
      s.cards[m.uid].ghostUsed = true;
      s.players[owner].hand.push(m.uid);
      ev.push({ e: "bounce", p: owner, id: c.id });
      log(s, ev, c.name + " floats back to {O" + owner + "} hand.");
    } else sendToGrave(s, m.uid);
    if (c.id === "paper_clip" || (c.fx && c.fx.drawOnDeath)) { if (draw(s, owner, ev, true)) log(s, ev, c.name + ": {P" + owner + ":draws|draw} 1."); }
    if (by === "battle" && killer && findMon(s, killer.uid) && (c.id === "ink_blot" || (c.fx && c.fx.deathStain))) {
      const amt = (c.fx && c.fx.deathStain) || 300;
      killer.mod = (killer.mod || 0) - amt;
      ev.push({ e: "debuff", p: controller(s, killer), slot: findMon(s, killer.uid).slot, amount: -amt });
      log(s, ev, c.name + " stains " + nm(s, killer.uid) + ": -" + amt + " ATK for good.");
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
    pl.summons = 0;
    pl.fused = false;
    s.players.forEach((q) => q.mz.forEach((m) => { if (m) { m.attacked = 0; m.posChanged = false; m.lordUsed = false; m.guardUsed = false; m.protected = false; m.extraReady = false; } }));
    s.phase = "draw";
    ev.push({ e: "turn", p, turn: s.turn });
    // upkeep costs of the overpowered cards
    pl.mz.forEach((m) => {
      if (!m) return;
      const c = cardOf(s, m.uid);
      if (c.id === "eraser_god") { log(s, ev, "THE ERASER GOD drains {N" + p + "}: -600 LP."); damage(s, p, 600, ev, "upkeep"); }
      else if (c.fx && c.fx.upkeep) { log(s, ev, c.name + " drains {N" + p + "}: -" + c.fx.upkeep + " LP."); damage(s, p, c.fx.upkeep, ev, "upkeep"); }
    });
    pl.sz.forEach((st) => {
      if (!st || !st.faceUp) return;
      const c = cardOf(s, st.uid);
      if (c.id === "cursed_crown") { log(s, ev, "CURSED CROWN weighs on {N" + p + "}: -500 LP."); damage(s, p, 500, ev, "upkeep"); }
      else if (c.fx && c.fx.equipUpkeep) { log(s, ev, c.name + " weighs on {N" + p + "}: -" + c.fx.equipUpkeep + " LP."); damage(s, p, c.fx.equipUpkeep, ev, "upkeep"); }
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
      if (!mine && spellUntargetable(s, m, p)) return;
      if (c.fx.maxAtk != null && atkOf(s, m) > c.fx.maxAtk) return;
      if (c.fx.onlyIds && c.fx.onlyIds.indexOf(cardOf(s, m.uid).id) === -1) return;
      if (c.id === "knights_charge" && ["box_knight", "pencil_warrior"].indexOf(cardOf(s, m.uid).id) === -1) return;
      out.push({ p: q, slot });
    }));
    return out;
  }
  function graveRevive(s, p, filter) {
    let best = null;
    const stars = filter && filter.stars != null ? filter.stars : 4;
    s.players[p].grave.forEach((u) => {
      const c = cardOf(s, u);
      if (c.kind !== "monster" || isFusion(c) || c.stars > stars) return;
      if (filter && filter.type && c.type !== filter.type) return;
      if (!best || c.atk > cardOf(s, best).atk) best = u;
    });
    return best;
  }
  function spellUsable(s, p, c, fromHand) {
    const pl = s.players[p];
    if (c.fx.attach && fromHand && freeSlot(pl.sz) === -1) return false;
    const tg = targetsFor(s, p, c);
    if (tg && !tg.length) return false;
    const anyMon = [0, 1].some((q) => countMon(s, q) > 0);
    if (c.fx.drawDiscard) return pl.deck.length >= 1;
    if (c.fx.wipeAll) return anyMon;
    if (c.fx.revive) return graveRevive(s, p, c.fx.revive) != null && freeSlot(pl.mz) !== -1;
    if (c.fx.needType && countType(s, p, c.fx.needType[0]) < c.fx.needType[1]) return false;
    if (c.fx.mechLink) return legalFusions(s, p).length > 0;
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
        const pay = c.fx.pay || (c.id === "whoops" ? 300 : 0);
        if (pay && pl.lp <= pay) return;
        const pop = c.fx.popIfAtk != null ? c.fx.popIfAtk : (c.id === "spike_pit" ? 1600 : null);
        if (pop != null && (A > pop || untargetable(s, ctx.attacker, p))) return;
      }
      if (on === "summon") {
        const min = c.fx.minAtk != null ? c.fx.minAtk : (c.id === "pitfall_doodle" ? 1500 : 0);
        if (atkOf(s, ctx.m) < min || untargetable(s, ctx.m, p)) return;
      }
      if (on === "spell") {
        const pay = c.fx.pay || (c.id === "nope" ? 300 : 0);
        if (pay && pl.lp <= pay) return;
        if ((c.id === "scratch_that" || c.fx.ifTargetMe) && !(ctx.target && ctx.target.p === p)) return;
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
    if (!m || m.pos !== "atk" || (m.attacked || 0) >= maxAttacks(s, m)) return false;
    if (s.turn === 1) return false;
    if (blocked(s, m)) return false;
    const c = cardOf(s, m.uid);
    if (m.summonedTurn === s.turn && c.id !== "stick_runner" && !(c.fx && c.fx.haste)) return false;
    return true;
  }
  function attackTargets(s, p) {
    const o = 1 - p;
    const opp = s.players[o].mz.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
    const taunts = opp.filter((i) => {
      const c = cardOf(s, s.players[o].mz[i].uid);
      return c.id === "tape_mummy" || !!(c.fx && c.fx.taunt);
    });
    return taunts.length ? taunts : opp;
  }
  function legal(s, p) {
    const L = { hand: {}, mz: {}, sz: {}, phase: false, attackDirect: false, atkTargets: {}, fly: {}, fusions: [] };
    if (s.winner != null || s.pending || s.active !== p) return L;
    const pl = s.players[p];
    if (s.phase === "main") {
      L.phase = true;
      pl.hand.forEach((uid) => {
        const c = cardOf(s, uid);
        const opts = [];
        if (c.kind === "monster") {
          if (!isFusion(c)) {
            const need = tributesNeeded(c, s, p);
            const room = freeSlot(pl.mz) !== -1 || need > 0;
            if (canNormalSummon(pl) && countMon(s, p) >= need && room) opts.push("summon", "set");
            if (c.fx && c.fx.ssIfType && countType(s, p, c.fx.ssIfType) > 0 && freeSlot(pl.mz) !== -1) opts.push("ss");
          }
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
        const mc = cardOf(s, m.uid);
        if (mc.id === "lord_of_lines" && !m.lordUsed && countMon(s, p) > 1) o.push("effect");
        if (mc.fx && mc.fx.protectAlly && !m.guardUsed && countMon(s, p) > 1) o.push("effect");
        L.mz[slot] = o;
      });
      pl.sz.forEach((st, slot) => {
        if (!st) return;
        const c = cardOf(s, st.uid);
        L.sz[slot] = !st.faceUp && c.kind === "spell" && spellUsable(s, p, c, false) ? ["activate"] : [];
      });
      L.fusions = legalFusions(s, p);
    } else if (s.phase === "battle") {
      L.phase = true;
      const oppHas = countMon(s, 1 - p) > 0;
      const tg = attackTargets(s, p);
      pl.mz.forEach((m, slot) => {
        if (!m) return;
        const ok = canAttackWith(s, p, slot);
        const c = cardOf(s, m.uid);
        const direct = !oppHas && c.id !== "robo_ruler";
        const fly = oppHas && (c.id === "paper_plane" || !!(c.fx && c.fx.fly));
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
    if (c.fx && c.fx.mechLink) {
      const opts = legalFusions(s, p);
      let choice = null;
      if (sp.fusion) choice = opts.find((x) => x.id === sp.fusion) || null;
      if (choice && Array.isArray(sp.mats) && sp.mats.length) choice = { id: choice.id, uid: choice.uid, mats: sp.mats.slice() };
      if (!choice) choice = opts.slice().sort((a, b) => cardOf(s, b.uid).atk - cardOf(s, a.uid).atk)[0];
      if (!choice) { log(s, ev, "MECH LINK fizzles."); return; }
      performFusion(s, p, choice, ev);
      return;
    }
    if (c.fx && c.fx.drawDiscard) {
      const [nDraw, nDisc] = c.fx.drawDiscard;
      log(s, ev, "{P" + p + ":casts|cast} " + c.name + ": draw " + nDraw + ", discard " + nDisc + ".");
      for (let i = 0; i < nDraw; i++) draw(s, p, ev, true);
      if (pl.hand.length) s.pending = { type: "discard", player: p, count: nDisc, then: "main" };
      return;
    }
    if (c.fx && c.fx.destroy && tm) {
      log(s, ev, c.name + " destroys " + nm(s, tm.uid) + ".");
      destroyMon(s, target.p, target.slot, ev, "effect");
      return;
    }
    if (c.fx && c.fx.bounce && tm) {
      leaveField(s, target.p, target.slot, ev);
      ev.push({ e: "bounce", p: target.p, slot: target.slot, id: cardOf(s, tm.uid).id });
      log(s, ev, c.name + ": " + nm(s, tm.uid) + " leaves the field.");
      bounceToOwner(s, tm, ev);
      return;
    }
    if (c.fx && c.fx.tmpAtk && tm) {
      tm.tmp = (tm.tmp || 0) + c.fx.tmpAtk;
      ev.push({ e: "buff", p: target.p, slot: target.slot, amount: c.fx.tmpAtk });
      log(s, ev, nm(s, tm.uid) + " gains " + c.fx.tmpAtk + " ATK this turn.");
      return;
    }
    if (c.fx && c.fx.heal) { heal(s, p, c.fx.heal, ev); log(s, ev, c.name + ": {P" + p + ":gains|gain} " + c.fx.heal + " LP."); return; }
    if (c.fx && c.fx.burn) { log(s, ev, c.name + ": {P" + o + ":takes|take} " + c.fx.burn + " damage."); damage(s, o, c.fx.burn, ev, "burn"); return; }
    if (c.fx && c.fx.teamTmp) {
      const typ = c.fx.teamTmp.type, amt = c.fx.teamTmp.atk || 0;
      log(s, ev, c.name + ": your " + typ + " monsters gain " + amt + " ATK this turn.");
      pl.mz.forEach((m, slot) => {
        if (m && cardOf(s, m.uid).type === typ) { m.tmp = (m.tmp || 0) + amt; ev.push({ e: "buff", p, slot, amount: amt }); }
      });
      return;
    }
    if (c.fx && c.fx.revive) {
      const r = graveRevive(s, p, c.fx.revive);
      const slot = freeSlot(pl.mz);
      if (r == null || slot === -1) return;
      pl.grave.splice(pl.grave.indexOf(r), 1);
      pl.mz[slot] = newMon(s, r, "def");
      ev.push({ e: "summon", p, slot, pos: "def", revive: true });
      log(s, ev, c.name + " brings back " + nm(s, r) + " in defense mode.");
      return;
    }
    if (c.fx && c.fx.wipeAll) {
      log(s, ev, c.name + " wipes the whole field!");
      [0, 1].forEach((q) => s.players[q].mz.forEach((m, slot) => { if (m) destroyMon(s, q, slot, ev, "effect"); }));
      if (c.fx.halfLp) {
        const cost = Math.floor(pl.lp / 2);
        log(s, ev, "{P" + p + ":pays|pay} half of {O" + p + "} LP: -" + cost + ".");
        damage(s, p, cost, ev, "cost");
      }
      return;
    }
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
        ev.push({ e: "bounce", p: target.p, slot: target.slot, id: cardOf(s, tm.uid).id });
        log(s, ev, "PAGE TURN: " + nm(s, tm.uid) + " leaves the field.");
        bounceToOwner(s, tm, ev);
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
    if (c.fx && c.fx.healOnSummon) { heal(s, p, c.fx.healOnSummon, ev); log(s, ev, c.name + ": {P" + p + ":gains|gain} " + c.fx.healOnSummon + " LP."); }
    if (c.fx && c.fx.summonDebuff) {
      let best = null, bestSlot = -1;
      s.players[o].mz.forEach((x, i) => { if (x && x.faceUp && !untargetable(s, x, p) && (!best || atkOf(s, x) > atkOf(s, best))) { best = x; bestSlot = i; } });
      if (best) {
        best.mod = (best.mod || 0) - c.fx.summonDebuff;
        ev.push({ e: "debuff", p: o, slot: bestSlot, amount: -c.fx.summonDebuff });
        log(s, ev, c.name + ": " + nm(s, best.uid) + " loses " + c.fx.summonDebuff + " ATK for good.");
      }
    }
    if (c.fx && c.fx.wipeWeak != null) {
      log(s, ev, c.name + " locks on!");
      s.players[o].mz.forEach((x, i) => { if (x && atkOf(s, x) <= c.fx.wipeWeak) destroyMon(s, o, i, ev, "effect"); });
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
    let A = atkOf(s, a);
    if (ac.fx && ac.fx.secondHalf && (a.attacked || 0) >= 2) A = Math.floor(A / 2);
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
      const cc = cardOf(s, m.uid);
      if (cc.id === "dot_dummy" && !s.players[owner].dummyUsed) {
        s.players[owner].dummyUsed = true; clash.saved = true; return true;
      }
      if (cc.fx && cc.fx.battleArmor && !s.cards[m.uid].armorUsed) {
        s.cards[m.uid].armorUsed = true; clash.saved = true; return true;
      }
      if (m.protected) { clash.saved = true; return true; }
      return false;
    };
    const noDmg = (who) => {
      const chk = (mm, cc) => mm && (cc.id === "gear_golem" || (cc.fx && cc.fx.noBattleDmg)) && controller(s, mm) === who;
      return chk(a, ac) || chk(d, dc);
    };
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
    if (clash.dmg && noDmg(clash.dmgTo)) { clash.golem = true; clash.dmg = 0; }
    const bits = [];
    if (clash.dDestroyed) bits.push(dName + " is destroyed");
    if (clash.aDestroyed) bits.push(aName + " is destroyed");
    if (!clash.dDestroyed && !clash.aDestroyed) bits.push(d.pos === "def" && A < D_safe(clash) ? "it holds" : "no one falls");
    if (clash.dmg) bits.push("{P" + clash.dmgTo + ":takes|take} " + clash.dmg + (clash.pierce ? " (pierce)" : ""));
    if (clash.golem) bits.push("armor blocks the damage");
    if (clash.saved) bits.push("a once-per-match shield is now used up");
    log(s, ev, line + bits.join(", ") + ".");
    ev.push(clash);
    if (clash.dDestroyed) {
      destroyMon(s, o, target, ev, "battle", a);
      const still = findMon(s, a.uid);
      if (still && !clash.aDestroyed) {
        if (ac.id === "box_knight" && (a.kills || 0) < 3) { a.kills = (a.kills || 0) + 1; a.mod = (a.mod || 0) + 200; ev.push({ e: "buff", p, slot, amount: 200 }); log(s, ev, "BOX KNIGHT gains 200 ATK."); }
        if (ac.id === "stapler_croc" || (ac.fx && ac.fx.killBurn)) {
          const burn = ac.fx && ac.fx.killBurn ? ac.fx.killBurn : 300;
          log(s, ev, ac.name + " burns for " + burn + " damage."); damage(s, o, burn, ev, "effect");
        }
        if (ac.fx && ac.fx.extraAttackOnKill) { a.extraReady = true; log(s, ev, ac.name + " can attack once more."); }
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
        if (c.id === "whoops" || (c.fx && c.fx.stop && c.fx.pay)) {
          const pay = (c.fx && c.fx.pay) || 300;
          const stainIf = (c.fx && c.fx.stainIf) || (c.id === "whoops" ? [1500, 500] : null);
          const doStain = a && stainIf && atkOf(s, a) >= stainIf[0];
          log(s, ev, "{P" + p + ":pays|pay} " + pay + " LP: " + c.name + " stops the attack.");
          damage(s, p, pay, ev, "cost");
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          if (doStain) { a.mod = (a.mod || 0) - stainIf[1]; ev.push({ e: "debuff", p: attacker, slot: pend.attacker, amount: -stainIf[1] }); log(s, ev, nm(s, a.uid) + " loses " + stainIf[1] + " ATK for good."); }
          return;
        }
        if (c.id === "sticky_note" || (c.fx && c.fx.stopFlip)) {
          log(s, ev, "{P" + p + ":springs|spring} " + c.name + ": the attack stops and " + (a ? nm(s, a.uid) : "it") + " flips to defense.");
          if (a) { a.pos = "def"; ev.push({ e: "pos", p: attacker, slot: pend.attacker }); }
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          return;
        }
        if (c.id === "spike_pit" || (c.fx && c.fx.popIfAtk != null)) {
          log(s, ev, "{P" + p + ":springs|spring} " + c.name + "! " + (a ? nm(s, a.uid) : "The attacker") + " is destroyed.");
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          if (a) destroyMon(s, attacker, pend.attacker, ev, "effect");
          return;
        }
        if (c.id === "mirror_sheet" || (c.fx && c.fx.reflectHalf)) {
          const back = a ? Math.floor(atkOf(s, a) / 2) : 0;
          log(s, ev, "{P" + p + ":springs|spring} " + c.name + ": the hit bounces back for " + back + ".");
          ev.push({ e: "negated", p: attacker, slot: pend.attacker, target: pend.target, id: c.id });
          damage(s, attacker, back, ev, "reflect");
          return;
        }
        if (c.id === "smudge" || (c.fx && c.fx.tmpAtk)) {
          const amt = (c.fx && c.fx.tmpAtk) || -300;
          log(s, ev, "{P" + p + ":springs|spring} " + c.name + ": the attacker changes ATK by " + amt + " this turn.");
          if (a) { a.tmp = (a.tmp || 0) + amt; ev.push({ e: "debuff", p: attacker, slot: pend.attacker, amount: amt }); }
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
          const amt = (c.fx && c.fx.stain) || 700;
          m.mod = (m.mod || 0) - amt;
          ev.push({ e: "debuff", p: pend.summoned.p, slot: pend.summoned.slot, amount: -amt });
          log(s, ev, "{P" + p + ":springs|spring} " + c.name + ": " + nm(s, m.uid) + " loses " + amt + " ATK for good.");
        }
      }
      return;
    }
    if (pend.on === "spell") {
      const sp = pend.spell;
      if (slot != null) {
        const c = springTrap(s, p, slot, ev);
        const pay = (c.fx && c.fx.pay) || (c.id === "nope" ? 300 : 0);
        if (pay) { log(s, ev, "{P" + p + ":pays|pay} " + pay + " LP: " + c.name + " cancels " + nm(s, sp.uid) + "."); damage(s, p, pay, ev, "cost"); }
        else log(s, ev, c.name + " cancels " + nm(s, sp.uid) + ".");
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
        if (!canNormalSummon(pl)) throw new Error("No normal summons left this turn");
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
        pl.summons = summonsUsed(pl) + 1;
        ev.push({ e: "summon", p, slot, pos: atkMode ? "atk" : "def", id: c.id });
        log(s, ev, "{P" + p + ":summons|summon} " + c.name + (atkMode ? " in attack mode." : " in defense mode.") + (trib.length ? " (tribute summon)" : ""));
        const left = summonsLeft(pl);
        log(s, ev, left ? "{P" + p + ":can|can} normal summon " + left + " more monster" + (left === 1 ? "" : "s") + " this turn." : "No normal summons left this turn.");
        onSummon(s, p, slot, ev);
        break;
      }
      case "ss": {
        if ((L.hand[act.uid] || []).indexOf("ss") === -1) throw new Error("cannot special summon");
        const slot = freeSlot(pl.mz);
        if (slot === -1) throw new Error("no room");
        pl.hand.splice(pl.hand.indexOf(act.uid), 1);
        pl.mz[slot] = newMon(s, act.uid, "atk");
        ev.push({ e: "summon", p, slot, pos: "atk", special: true, id: cardOf(s, act.uid).id });
        log(s, ev, "{P" + p + ":special summons|special summon} " + nm(s, act.uid) + ".");
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
        castSpell(s, p, { uid, target: tg ? { p: act.target.p, slot: act.target.slot } : null, fromSlot: fromHand ? null : act.slot, fusion: act.fusion, mats: act.mats }, ev);
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
        const ec = cardOf(s, m.uid);
        if (ec.id === "lord_of_lines") {
          m.lordUsed = true;
          const gain = 100 * (countMon(s, p) - 1);
          m.tmp = (m.tmp || 0) + gain;
          ev.push({ e: "effect", p, slot: act.slot });
          ev.push({ e: "buff", p, slot: act.slot, amount: gain });
          log(s, ev, "LORD OF LINES gains " + gain + " ATK this turn.");
        } else if (ec.fx && ec.fx.protectAlly) {
          const others = pl.mz.map((x, i) => (x && i !== act.slot ? i : -1)).filter((i) => i >= 0);
          let tslot = act.target != null ? (typeof act.target === "number" ? act.target : act.target.slot) : -1;
          if (tslot < 0) {
            tslot = others.slice().sort((i, j) => atkOf(s, pl.mz[j]) - atkOf(s, pl.mz[i]))[0];
          }
          if (others.indexOf(tslot) === -1) throw new Error("pick another monster");
          pl.mz[tslot].protected = true;
          m.guardUsed = true;
          ev.push({ e: "effect", p, slot: act.slot, target: tslot });
          log(s, ev, ec.name + " shields " + nm(s, pl.mz[tslot].uid) + " this turn.");
        }
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
      if (op.toHand) {
        pl.hand.push(uid); ev.push({ e: "draw", p: op.p });
      } else if (c.kind === "monster") {
        const slot = freeSlot(pl.mz);
        if (slot === -1) { delete s.cards[uid]; throw new Error("no room"); }
        pl.mz[slot] = newMon(s, uid, "atk"); pl.mz[slot].summonedTurn = -1;
        ev.push({ e: "summon", p: op.p, slot, pos: "atk", id: c.id });
      } else if (c.kind === "spell") {
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
        summons: summonsUsed(q), fused: !!q.fused, dummyUsed: !!q.dummyUsed, trapUsed: q.trapTurn === s.turn,
        hangar: (q.hangar || []).map(pub),
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
      fusions: (s.active === p && !s.pending && s.phase === "main") ? legalFusions(s, p) : [],
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
      return c.atk * (t === 2 ? 0.55 : t === 1 ? 0.75 : 1) + c.def * 0.25 + (c.sub === "effect" || (c.fx && c.fx.fusion) ? 150 : 0);
    }
    const table = { erase: 1100, crumple: 800, stick_squad: 900, page_turn: 900, quick_sketch: 800, masterpiece: 1100, ink_flood: 500,
      sharpen: 600, refill: 500, second_draft: 800, smear_curse: 800, writers_block: 900, paper_cut: 500, pencil_sword: 800,
      cardboard_shield: 600, ruler_lance: 900, cursed_crown: 1400, graph_paper: 600, ink_sea: 700, doodle_park: 700,
      knights_charge: 500, big_eraser: 1300, smudge: 700, sticky_note: 800, spike_pit: 900, whoops: 900, mirror_sheet: 1100,
      pitfall_doodle: 800, nope: 1000, scratch_that: 800,
      mech_link: 1200, system_reboot: 800, dismantle: 800, lockdown: 800, charge: 600, repair_kit: 500, emp: 800, jammer: 500,
      beam_saber: 800, plate_armor: 700, nebula_dock: 700, wing_clip: 500, recall: 900, rebuild: 800, overclock: 700,
      stasis_lock: 900, rail_rifle: 900, battle_station: 800, squad_link: 900, mainframe: 1100, omega_core: 1400, singularity: 1300,
      static_shock: 700, hard_light: 800, trip_mine: 800, force_dampener: 800, rail_trap: 900, abort: 900, no_signal: 1000, reflect_array: 1100 };
    return table[c.id] || (c.rarity === "SCR" ? 1400 : c.rarity === "SR" ? 1100 : c.rarity === "R" ? 800 : 600);
  }
  /* Deck from the binder: owned cards first (best first, about 11 monsters / 6 spells / 3 traps),
     then common starters fill to 20. */
  function deckFromCollection(collection, opts) {
    opts = opts || {};
    const CARDS = global.LLCData.CARDS;
    const rec = (id) => ownedRec(collection, id);
    const ownedAll = CARDS.filter((c) => rec(c.id) && rec(c.id).owned);
    const hangar = ownedAll.filter((c) => isFusion(c)).slice().sort((a, b) => cardValue(b) - cardValue(a)).slice(0, 2)
      .map((c) => ({ id: c.id, foil: !!(rec(c.id) && rec(c.id).foil) }));
    const owned = ownedAll.filter((c) => !isFusion(c) && (!opts.set || c.set === opts.set));
    const want = { monster: 11, spell: 6, trap: 3 };
    const out = [];
    const add = (c, foil) => { if (!isFusion(c)) out.push({ id: c.id, foil: !!foil }); };
    const n = (id) => out.filter((x) => x.id === id).length;
    const kindCount = (k) => out.filter((x) => def(x.id).kind === k).length;
    const sorted = owned.slice().sort((a, b) => cardValue(b) - cardValue(a));
    for (let round = 0; round < 3; round++) {
      sorted.forEach((c) => {
        if (out.length >= DECK_SIZE || n(c.id) > round || n(c.id) >= copyCap(c) || kindCount(c.kind) >= want[c.kind]) return;
        add(c, rec(c.id) && rec(c.id).foil);
      });
    }
    const starters = CARDS.filter((c) => c.rarity === "C" && !isFusion(c) && (!opts.set || c.set === opts.set)).sort((a, b) => cardValue(b) - cardValue(a));
    for (let round = 0; round < 3 && out.length < DECK_SIZE; round++) {
      starters.forEach((c) => {
        if (out.length >= DECK_SIZE || n(c.id) > round || n(c.id) >= copyCap(c) || kindCount(c.kind) >= want[c.kind]) return;
        add(c, rec(c.id) && rec(c.id).foil);
      });
    }
    for (const c of starters.concat(sorted)) { while (out.length < DECK_SIZE && n(c.id) < copyCap(c)) add(c, false); }
    return { cards: out.slice(0, DECK_SIZE), hangar, owned: ownedAll.length };
  }
  /* The bot's deck. Easy leans on commons, Normal is the original mix, Hard is weighted to higher rarities. */
  const BOT_OWN_RATES = {
    easy:   { C: 0.95, R: 0.10, SR: 0,    SCR: 0 },
    normal: { C: 0.75, R: 0.35, SR: 0.08, SCR: 0 },
    hard:   { C: 0.55, R: 0.80, SR: 0.55, SCR: 0.22 },
  };
  function botDeck(seed, diff) {
    const id = BOT_OWN_RATES[diff] ? diff : "normal";
    const rates = BOT_OWN_RATES[id];
    const r = global.LLCData.mulberry32(seed >>> 0 || 7);
    const CARDS = global.LLCData.CARDS;
    const coll = { edition_one: {}, edition_two: {} };
    CARDS.forEach((c) => {
      let ch = rates[c.rarity] || 0;
      if (isFusion(c)) {
        if (id === "easy") ch = c.rarity === "SCR" ? 0.02 : 0.08;
        else if (id === "hard") ch = c.rarity === "SCR" ? 0.35 : 0.55;
        else ch = c.rarity === "SCR" ? 0.15 : 0.25;
      }
      if (r() < ch) {
        const bucket = c.set === "edition_two" ? "edition_two" : "edition_one";
        coll[bucket][c.id] = { owned: true, foil: false, n: 1 };
      }
    });
    return deckFromCollection(coll);
  }
  /* Custom decks: a list of card ids, limited by copies owned and the copy caps. Returns problems (empty = valid). */
  function deckProblems(ids, collection, hangarIds) {
    const probs = [];
    if (!Array.isArray(ids)) return ["no deck"];
    if (ids.length !== DECK_SIZE) probs.push(ids.length + " / " + DECK_SIZE + " cards");
    const counts = {};
    ids.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    Object.keys(counts).forEach((id) => {
      const c = def(id);
      if (!c) { probs.push("unknown card"); return; }
      if (isFusion(c)) { probs.push(c.name + " belongs in the Hangar"); return; }
      const rec = ownedRec(collection, id);
      const have = rec && rec.owned ? rec.n || 1 : 0;
      if (counts[id] > have) probs.push(c.name + ": you own " + have);
      else if (counts[id] > copyCap(c)) probs.push(c.name + ": max " + copyCap(c));
    });
    if (!ids.some((id) => def(id) && def(id).kind === "monster")) probs.push("needs a monster");
    const h = hangarIds || [];
    if (h.length > 2) probs.push("Hangar holds 2");
    const hCounts = {};
    h.forEach((id) => {
      const c = def(id);
      if (!c) { probs.push("unknown Hangar card"); return; }
      if (!isFusion(c)) { probs.push(c.name + " is not a fusion"); return; }
      hCounts[id] = (hCounts[id] || 0) + 1;
      if (hCounts[id] > 1) probs.push(c.name + ": one copy in the Hangar");
      const rec = ownedRec(collection, id);
      const have = rec && rec.owned ? rec.n || 1 : 0;
      if (have < 1) probs.push(c.name + ": you do not own it");
    });
    return probs;
  }
  /* The deck a player battles with: the active custom deck if it is valid, else the auto deck. */
  function activeDeck(collection) {
    const c = collection || {};
    const i = c.activeDeck;
    const d = Array.isArray(c.decks) && typeof i === "number" && i >= 0 ? c.decks[i] : null;
    const hangarIds = (d && d.hangar) || [];
    if (d && d.cards && !deckProblems(d.cards, c, hangarIds).length) {
      const foilOf = (id) => { const rec = ownedRec(c, id); return !!(rec && rec.foil); };
      return {
        cards: d.cards.map((id) => ({ id, foil: foilOf(id) })),
        hangar: hangarIds.filter((id) => def(id) && isFusion(def(id))).slice(0, 2).map((id) => ({ id, foil: foilOf(id) })),
        custom: true, name: d.name,
      };
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
    START_LP, ZONES, DECK_SIZE, HAND_LIMIT, FATIGUE, NORMAL_SUMMONS_PER_TURN,
    create, apply, view, legal, admin, deckFromCollection, botDeck, validDeck, deckProblems, activeDeck, tributesNeeded, copyCap, cardValue,
    legalFusions, isFusion, ownedRec,
    _atkOf: atkOf, _defOf: defOf, _mon: mon,
  };
})(typeof window !== "undefined" ? window : globalThis);
