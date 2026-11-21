/* LLC Cards duel engine. Pure rules, no DOM. Host-authoritative:
   state + apply(state, player, action) -> events. Views are redacted per player. */
(function (global) {
  const START_LP = 4000;
  const HAND_START = 5;
  const HAND_LIMIT = 6;
  const ZONES = 3;
  const DECK_SIZE = 20;

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

  /* deck: [{id, foil}] */
  function create(opts) {
    const s = {
      v: 1,
      rng: (opts.seed >>> 0) || 1,
      turn: 0,
      active: 0,
      phase: "draw",
      players: [],
      cards: {},
      nextUid: 1,
      pending: null,
      winner: null,
      endReason: "",
      log: [],
      seq: 0,
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
        lp: START_LP,
        deck: shuffle(s, uids),
        hand: [],
        grave: [],
        mz: new Array(ZONES).fill(null),
        sz: new Array(ZONES).fill(null),
        summoned: false,
      });
    });
    s.first = opts.first != null ? opts.first : (rng(s) < 0.5 ? 0 : 1);
    s.active = s.first;
    const ev = [];
    [0, 1].forEach((p) => { for (let i = 0; i < HAND_START; i++) draw(s, p, ev, true); });
    log(s, ev, "{P"+s.first+":goes|go} first.");
    startTurn(s, ev);
    return { state: s, events: ev };
  }

  function log(s, ev, text) {
    s.log.push(text);
    if (s.log.length > 40) s.log.shift();
    ev.push({ e: "log", text });
  }

  function draw(s, p, ev, quiet) {
    const pl = s.players[p];
    if (!pl.deck.length) {
      if (!quiet) lose(s, p, ev, "{P"+p+":has|have} no cards left to draw.");
      return null;
    }
    const uid = pl.deck.pop();
    pl.hand.push(uid);
    ev.push({ e: "draw", p });
    return uid;
  }

  function lose(s, p, ev, reason) {
    if (s.winner != null) return;
    s.winner = 1 - p;
    s.phase = "over";
    s.pending = null;
    s.endReason = reason;
    log(s, ev, reason);
    ev.push({ e: "over", winner: s.winner });
  }

  function startTurn(s, ev) {
    s.turn += 1;
    const p = s.active;
    const pl = s.players[p];
    pl.summoned = false;
    s.players.forEach((q) => q.mz.forEach((m) => {
      if (!m) return;
      m.attacked = false; m.posChanged = false; m.dummyUsed = false; m.lordUsed = false;
    }));
    s.phase = "draw";
    ev.push({ e: "turn", p, turn: s.turn });
    if (s.turn > 1) {
      const got = draw(s, p, ev, false);
      if (s.winner != null) return;
      if (got) log(s, ev, "{P"+p+":draws|draw}.");
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

  /* ---------- helpers ---------- */
  function mon(s, p, slot) { return s.players[p].mz[slot] || null; }
  function atkOf(s, m) {
    if (!m) return 0;
    return Math.max(0, def(s.cards[m.uid].id).atk + (m.mod || 0) + (m.tmp || 0));
  }
  function defOf(s, m) { return m ? def(s.cards[m.uid].id).def : 0; }
  function cardOf(s, uid) { return s.cards[uid] ? def(s.cards[uid].id) : null; }
  function freeSlot(arr) { return arr.indexOf(null); }
  function countMon(s, p) { return s.players[p].mz.filter(Boolean).length; }
  function tributesNeeded(c) { return c.stars >= 7 ? 2 : c.stars >= 5 ? 1 : 0; }

  function sendToGrave(s, p, uid) { s.players[p].grave.push(uid); }
  function destroyMon(s, p, slot, ev) {
    const m = s.players[p].mz[slot];
    if (!m) return;
    s.players[p].mz[slot] = null;
    sendToGrave(s, p, m.uid);
    ev.push({ e: "destroy", p, zone: "mz", slot, id: s.cards[m.uid].id });
  }
  function damage(s, p, amount, ev) {
    if (amount <= 0) return;
    const pl = s.players[p];
    pl.lp = Math.max(0, pl.lp - amount);
    ev.push({ e: "damage", p, amount });
    if (pl.lp <= 0) lose(s, p, ev, "{P"+p+":is|are} out of LP.");
  }
  function canAttackWith(s, p, slot) {
    const m = mon(s, p, slot);
    if (!m || m.pos !== "atk" || !m.faceUp || m.attacked) return false;
    if (s.turn === 1) return false;
    const c = cardOf(s, m.uid);
    if (m.summonedTurn === s.turn && c.id !== "stick_runner") return false;
    return true;
  }
  function eraseTargets(s) {
    const out = [];
    [0, 1].forEach((p) => s.players[p].mz.forEach((m, slot) => {
      if (m && m.faceUp && atkOf(s, m) <= 1000) out.push({ p, slot });
    }));
    return out;
  }
  function trapOptions(s, p) {
    const out = [];
    s.players[p].sz.forEach((st, slot) => {
      if (!st) return;
      const c = cardOf(s, st.uid);
      if (c.kind === "trap" && st.setTurn < s.turn) out.push(slot);
    });
    return out;
  }

  /* What can player p legally do right now (used by UI + AI + validation). */
  function legal(s, p) {
    const L = { hand: {}, mz: {}, sz: {}, phase: false, attackDirect: false };
    if (s.winner != null) return L;
    if (s.pending) return L;
    if (s.active !== p) return L;
    const pl = s.players[p];
    if (s.phase === "main") {
      L.phase = true;
      pl.hand.forEach((uid) => {
        const c = cardOf(s, uid);
        const opts = [];
        if (c.kind === "monster") {
          const need = tributesNeeded(c);
          const have = countMon(s, p);
          const room = freeSlot(pl.mz) !== -1 || need > 0;
          if (!pl.summoned && have >= need && room) {
            opts.push("summon", "set");
          }
        } else {
          if (c.kind === "spell" && spellUsable(s, p, c.id)) opts.push("activate");
          if (freeSlot(pl.sz) !== -1) opts.push("setst");
        }
        L.hand[uid] = opts;
      });
      pl.mz.forEach((m, slot) => {
        if (!m) return;
        const o = [];
        if (!m.posChanged && m.summonedTurn !== s.turn && !m.attacked) o.push("pos");
        const c = cardOf(s, m.uid);
        if (c.id === "lord_of_lines" && m.faceUp && !m.lordUsed) o.push("effect");
        L.mz[slot] = o;
      });
      pl.sz.forEach((st, slot) => {
        if (!st) return;
        const c = cardOf(s, st.uid);
        L.sz[slot] = c.kind === "spell" && spellUsable(s, p, c.id) ? ["activate"] : [];
      });
    } else if (s.phase === "battle") {
      L.phase = true;
      const oppHas = countMon(s, 1 - p) > 0;
      pl.mz.forEach((m, slot) => {
        if (!m) return;
        L.mz[slot] = canAttackWith(s, p, slot) ? ["attack"] : [];
      });
      L.attackDirect = !oppHas;
    }
    return L;
  }

  function spellUsable(s, p, id) {
    if (id === "erase") return eraseTargets(s).length > 0;
    if (id === "quick_sketch") return s.players[p].deck.length >= 1;
    if (id === "ink_flood") return [0, 1].some((q) => s.players[q].mz.some((m) => m && m.faceUp));
    return true;
  }

  function resolveSpell(s, p, id, target, ev) {
    const pl = s.players[p];
    if (id === "erase") {
      const m = target && mon(s, target.p, target.slot);
      if (!m || !m.faceUp || atkOf(s, m) > 1000) throw new Error("bad target");
      log(s, ev, "{P"+p+":casts|cast} ERASE on " + cardOf(s, m.uid).name + ".");
      destroyMon(s, target.p, target.slot, ev);
    } else if (id === "quick_sketch") {
      log(s, ev, "{P"+p+":casts|cast} QUICK SKETCH: draw 2, discard 1.");
      draw(s, p, ev, true); draw(s, p, ev, true);
      if (pl.hand.length) s.pending = { type: "discard", player: p, count: 1, then: "main" };
    } else if (id === "ink_flood") {
      log(s, ev, "{P"+p+":casts|cast} INK FLOOD: all monsters -400 ATK this turn.");
      s.players.forEach((q) => q.mz.forEach((m) => { if (m && m.faceUp) m.tmp = (m.tmp || 0) - 400; }));
    }
  }

  /* ---------- battle ---------- */
  function declareAttack(s, p, slot, target, ev) {
    const m = mon(s, p, slot);
    m.attacked = true;
    const tgtName = target == null ? "directly" : cardOf(s, mon(s, 1 - p, target).uid).name;
    const tgtLabel = target == null ? "directly" : (mon(s, 1 - p, target).faceUp ? tgtName : "a face-down card");
    log(s, ev, cardOf(s, m.uid).name + " attacks " + (target == null ? "directly" : tgtLabel) + ".");
    ev.push({ e: "attack", p, slot, target });
    const opts = trapOptions(s, 1 - p);
    if (opts.length) {
      s.pending = { type: "trap", player: 1 - p, attacker: slot, target, options: opts };
      return;
    }
    resolveBattle(s, p, slot, target, ev);
  }

  function resolveBattle(s, p, slot, target, ev) {
    const a = mon(s, p, slot);
    if (!a) return;
    const o = 1 - p;
    if (target == null) {
      damage(s, o, atkOf(s, a), ev);
      return;
    }
    const d = mon(s, o, target);
    if (!d) return;
    if (!d.faceUp) {
      d.faceUp = true;
      ev.push({ e: "flip", p: o, slot: target });
      log(s, ev, "It was " + cardOf(s, d.uid).name + ".");
    }
    const A = atkOf(s, a);
    const dc = cardOf(s, d.uid);
    const survives = (m, who) => {
      if (cardOf(s, m.uid).id === "dot_dummy" && !m.dummyUsed) {
        m.dummyUsed = true;
        log(s, ev, "DOT DUMMY shrugs it off.");
        return true;
      }
      return false;
    };
    const killedBy = () => {
      if (cardOf(s, a.uid).id === "box_knight") {
        a.mod = (a.mod || 0) + 200;
        log(s, ev, "BOX KNIGHT gains 200 ATK.");
      }
    };
    if (d.pos === "atk") {
      const D = atkOf(s, d);
      if (A > D) {
        if (!survives(d, o)) { destroyMon(s, o, target, ev); killedBy(); }
        damage(s, o, A - D, ev);
      } else if (A < D) {
        if (!survives(a, p)) destroyMon(s, p, slot, ev);
        damage(s, p, D - A, ev);
      } else {
        const dSurv = survives(d, o);
        const aSurv = survives(a, p);
        if (!dSurv) destroyMon(s, o, target, ev);
        if (!aSurv) destroyMon(s, p, slot, ev);
        if (!dSurv && !aSurv) {} else if (!dSurv && mon(s, p, slot)) killedBy();
      }
    } else {
      const D = defOf(s, d);
      if (A > D) {
        if (!survives(d, o)) { destroyMon(s, o, target, ev); killedBy(); }
      } else if (A < D) {
        damage(s, p, D - A, ev);
      }
    }
    void dc;
  }

  /* ---------- apply ---------- */
  function apply(s, p, act) {
    const ev = [];
    if (!act || typeof act !== "object") throw new Error("no action");
    if (s.winner != null) throw new Error("game over");
    if (act.a === "concede") {
      lose(s, p, ev, "{P"+p+":concedes|concede}.");
      s.seq++;
      return ev;
    }
    const pl = s.players[p];
    const pend = s.pending;
    if (pend) {
      if (pend.player !== p) throw new Error("waiting on other player");
      if (pend.type === "trap" && act.a === "respond") {
        s.pending = null;
        const attacker = s.active;
        if (act.slot != null) {
          if (pend.options.indexOf(act.slot) === -1) throw new Error("bad trap");
          const st = pl.sz[act.slot];
          const c = cardOf(s, st.uid);
          pl.sz[act.slot] = null;
          sendToGrave(s, p, st.uid);
          ev.push({ e: "activate", p, id: c.id, zone: "sz", slot: act.slot });
          const a = mon(s, attacker, pend.attacker);
          if (c.id === "whoops") {
            log(s, ev, "{P"+p+":springs|spring} WHOOPS! The attack is negated.");
            if (a) a.mod = (a.mod || 0) - 400;
            s.seq++;
            return ev;
          }
          if (c.id === "smudge") {
            log(s, ev, "{P"+p+":springs|spring} SMUDGE: attacker -300 ATK.");
            if (a) a.mod = (a.mod || 0) - 300;
          }
        }
        resolveBattle(s, attacker, pend.attacker, pend.target, ev);
        s.seq++;
        return ev;
      }
      if (pend.type === "discard" && act.a === "discard") {
        const i = pl.hand.indexOf(act.uid);
        if (i === -1) throw new Error("not in hand");
        pl.hand.splice(i, 1);
        sendToGrave(s, p, act.uid);
        ev.push({ e: "discard", p, id: s.cards[act.uid].id });
        log(s, ev, "{P"+p+":discards|discard} " + cardOf(s, act.uid).name + ".");
        pend.count -= 1;
        if (pend.count <= 0) {
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
      case "summon":
      case "set": {
        const opts = L.hand[act.uid] || [];
        if (opts.indexOf(act.a) === -1) throw new Error("cannot summon");
        const c = cardOf(s, act.uid);
        const need = tributesNeeded(c);
        const trib = (act.tributes || []).filter((x, i, arr) => arr.indexOf(x) === i);
        if (trib.length !== need) throw new Error("need " + need + " tribute");
        trib.forEach((slot) => { if (!pl.mz[slot]) throw new Error("bad tribute"); });
        trib.forEach((slot) => {
          log(s, ev, cardOf(s, pl.mz[slot].uid).name + " is tributed.");
          const m = pl.mz[slot];
          pl.mz[slot] = null;
          sendToGrave(s, p, m.uid);
          ev.push({ e: "tribute", p, slot });
        });
        let slot = act.slot != null && !pl.mz[act.slot] ? act.slot : freeSlot(pl.mz);
        if (slot === -1) throw new Error("no room");
        pl.hand.splice(pl.hand.indexOf(act.uid), 1);
        const faceUp = act.a === "summon";
        pl.mz[slot] = {
          uid: act.uid, pos: faceUp ? "atk" : "def", faceUp,
          mod: 0, tmp: 0, summonedTurn: s.turn, attacked: false, posChanged: false,
          dummyUsed: false, lordUsed: false,
        };
        pl.summoned = true;
        ev.push({ e: faceUp ? "summon" : "setmon", p, slot });
        log(s, ev, faceUp ? "{P"+p+":summons|summon} " + c.name + "." : "{P"+p+":sets|set} a monster.");
        if (faceUp && c.id === "squiggle_worm") {
          if (draw(s, p, ev, true)) log(s, ev, "SQUIGGLE WORM: draw 1.");
        }
        break;
      }
      case "activate": {
        const fromHand = act.uid != null;
        let id;
        if (fromHand) {
          if ((L.hand[act.uid] || []).indexOf("activate") === -1) throw new Error("cannot activate");
          id = s.cards[act.uid].id;
          if (id === "erase") checkErase(s, act.target);
          pl.hand.splice(pl.hand.indexOf(act.uid), 1);
          sendToGrave(s, p, act.uid);
          ev.push({ e: "activate", p, id, zone: "hand" });
        } else {
          if ((L.sz[act.slot] || []).indexOf("activate") === -1) throw new Error("cannot activate");
          const st = pl.sz[act.slot];
          id = s.cards[st.uid].id;
          if (id === "erase") checkErase(s, act.target);
          pl.sz[act.slot] = null;
          sendToGrave(s, p, st.uid);
          ev.push({ e: "activate", p, id, zone: "sz", slot: act.slot });
        }
        resolveSpell(s, p, id, act.target, ev);
        break;
      }
      case "setst": {
        if ((L.hand[act.uid] || []).indexOf("setst") === -1) throw new Error("cannot set");
        const slot = freeSlot(pl.sz);
        pl.hand.splice(pl.hand.indexOf(act.uid), 1);
        pl.sz[slot] = { uid: act.uid, setTurn: s.turn };
        ev.push({ e: "setst", p, slot });
        log(s, ev, "{P"+p+":sets|set} a card.");
        break;
      }
      case "pos": {
        if ((L.mz[act.slot] || []).indexOf("pos") === -1) throw new Error("cannot change");
        const m = pl.mz[act.slot];
        m.posChanged = true;
        if (!m.faceUp) {
          m.faceUp = true; m.pos = "atk";
          log(s, ev, "{P"+p+":flips|flip} up " + cardOf(s, m.uid).name + ".");
          if (cardOf(s, m.uid).id === "squiggle_worm" && draw(s, p, ev, true)) log(s, ev, "SQUIGGLE WORM: draw 1.");
        } else {
          m.pos = m.pos === "atk" ? "def" : "atk";
          log(s, ev, cardOf(s, m.uid).name + " switches to " + (m.pos === "atk" ? "attack" : "defense") + ".");
        }
        ev.push({ e: "pos", p, slot: act.slot });
        break;
      }
      case "effect": {
        if ((L.mz[act.slot] || []).indexOf("effect") === -1) throw new Error("no effect");
        const m = pl.mz[act.slot];
        m.lordUsed = true;
        const gain = 200 * countMon(s, p);
        m.tmp = (m.tmp || 0) + gain;
        ev.push({ e: "effect", p, slot: act.slot });
        log(s, ev, "LORD OF LINES gains " + gain + " ATK this turn.");
        break;
      }
      case "phase": {
        if (!L.phase) throw new Error("cannot change phase");
        if (s.phase === "main") {
          if (s.turn === 1) { log(s, ev, "No battle on the first turn."); endTurn(s, ev); }
          else { s.phase = "battle"; ev.push({ e: "phase", phase: "battle" }); }
        } else if (s.phase === "battle") {
          endTurn(s, ev);
        }
        break;
      }
      case "endturn": {
        if (!L.phase) throw new Error("cannot end");
        endTurn(s, ev);
        break;
      }
      case "attack": {
        if ((L.mz[act.slot] || []).indexOf("attack") === -1) throw new Error("cannot attack");
        if (act.target == null) {
          if (!L.attackDirect) throw new Error("must target a monster");
        } else if (!mon(s, 1 - p, act.target)) throw new Error("no target");
        declareAttack(s, p, act.slot, act.target, ev);
        break;
      }
      default:
        throw new Error("unknown action");
    }
    s.seq++;
    return ev;
  }

  function checkErase(s, t) {
    const ok = eraseTargets(s).some((x) => t && x.p === t.p && x.slot === t.slot);
    if (!ok) throw new Error("pick a face-up monster with 1000 ATK or less");
  }

  function fmt(s, p, text) {
    return String(text || "").replace(/\{P(\d):([^|}]*)\|([^}]*)\}/g, (m, i, they, you) =>
      Number(i) === p ? "You " + you : s.players[Number(i)].name + " " + they);
  }

  /* ---------- redacted view for player p ---------- */
  function view(s, p) {
    const pub = (uid) => { const c = s.cards[uid]; return { uid, id: c.id, foil: c.foil }; };
    const V = {
      me: p, turn: s.turn, active: s.active, phase: s.phase, winner: s.winner, endReason: fmt(s, p, s.endReason),
      seq: s.seq, log: s.log.slice(-6).map((t) => fmt(s, p, t)), first: s.first,
      pending: null,
      players: s.players.map((pl, i) => ({
        name: pl.name, lp: pl.lp, deck: pl.deck.length,
        grave: pl.grave.map(pub),
        hand: i === p ? pl.hand.map(pub) : pl.hand.map(() => ({ hidden: true })),
        summoned: pl.summoned,
        mz: pl.mz.map((m) => {
          if (!m) return null;
          const show = m.faceUp || i === p;
          const o = { pos: m.pos, faceUp: m.faceUp, summonedTurn: m.summonedTurn, attacked: m.attacked };
          if (show) Object.assign(o, pub(m.uid), { atk: atkOf(s, m), def: defOf(s, m), mod: (m.mod || 0) + (m.tmp || 0) });
          return o;
        }),
        sz: pl.sz.map((st) => {
          if (!st) return null;
          return i === p ? Object.assign(pub(st.uid), { setTurn: st.setTurn }) : { hidden: true };
        }),
      })),
      legal: legal(s, p),
    };
    if (s.pending && s.pending.player === p) V.pending = JSON.parse(JSON.stringify(s.pending));
    else if (s.pending) V.pending = { type: s.pending.type, player: s.pending.player, waiting: true };
    if (s.pending && s.pending.type === "trap") {
      V.pending.attacker = s.pending.attacker;
      V.pending.target = s.pending.target;
    }
    V.eraseTargets = eraseTargets(s);
    return V;
  }

  /* Deck from the binder: owned cards first (3 copies), starters fill to 20. */
  function deckFromCollection(collection) {
    const set = (collection && collection.edition_one) || {};
    const CARDS = global.LLCData.CARDS;
    const owned = CARDS.filter((c) => set[c.id] && set[c.id].owned);
    const out = [];
    owned.forEach((c) => { for (let k = 0; k < 3 && out.length < DECK_SIZE; k++) out.push({ id: c.id, foil: !!set[c.id].foil }); });
    const starters = CARDS.filter((c) => !(set[c.id] && set[c.id].owned));
    let guard = 0;
    while (out.length < DECK_SIZE && starters.length && guard++ < 100) {
      starters.forEach((c) => { if (out.length < DECK_SIZE && out.filter((x) => x.id === c.id).length < 2) out.push({ id: c.id, foil: false }); });
      if (out.length < DECK_SIZE && starters.every((c) => out.filter((x) => x.id === c.id).length >= 2)) {
        CARDS.forEach((c) => { if (out.length < DECK_SIZE && out.filter((x) => x.id === c.id).length < 3) out.push({ id: c.id, foil: !!(set[c.id] && set[c.id].foil) }); });
      }
    }
    while (out.length < DECK_SIZE) out.push({ id: "dot_dummy", foil: false });
    return { cards: out, owned: owned.length };
  }

  function validDeck(list) {
    if (!Array.isArray(list) || list.length !== DECK_SIZE) return false;
    const counts = {};
    return list.every((c) => {
      if (!c || !def(c.id)) return false;
      counts[c.id] = (counts[c.id] || 0) + 1;
      return counts[c.id] <= 3;
    });
  }

  global.LLCEngine = {
    START_LP, ZONES, DECK_SIZE, HAND_LIMIT,
    create, apply, view, legal, deckFromCollection, validDeck, tributesNeeded,
    _atkOf: atkOf, _defOf: defOf, _mon: mon,
  };
})(typeof window !== "undefined" ? window : globalThis);
