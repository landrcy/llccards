/* LLC Cards bot. Reads only its own redacted view, returns one action at a time. */
(function (global) {
  const BY = () => global.LLCData.BY_ID;
  const can = (L, c, what) => (L.hand[c.uid] || []).includes(what);

  function value(id) {
    const c = BY()[id];
    if (!c) return 0;
    return global.LLCEngine && global.LLCEngine.cardValue ? global.LLCEngine.cardValue(c) : (c.atk || 500);
  }
  const REMOVAL = ["erase", "crumple", "stick_squad", "page_turn", "smear_curse", "writers_block", "big_eraser"];

  function decide(V) {
    const me = V.me, op = 1 - me;
    const P = V.players[me], O = V.players[op];
    const L = V.legal;
    const list = (pl) => pl.mz.map((m, slot) => (m ? Object.assign({ slot }, m) : null)).filter(Boolean);
    const myMons = list(P), oppMons = list(O);
    const oppMaxAtk = oppMons.reduce((mx, m) => Math.max(mx, m.pos === "atk" ? m.atk : 0), 0);
    const oppBest = oppMons.reduce((mx, m) => Math.max(mx, m.atk), 0);
    const myBest = myMons.reduce((mx, m) => Math.max(mx, m.atk), 0);

    /* ---- responses ---- */
    if (V.pending && !V.pending.waiting && V.pending.player === me) {
      const pd = V.pending;
      if (pd.type === "discard") {
        const worst = P.hand.slice().sort((a, b) => value(a.id) - value(b.id))[0];
        return { a: "discard", uid: worst.uid };
      }
      if (pd.type === "trap") {
        const ids = pd.options.map((slot) => ({ slot, id: P.sz[slot].id }));
        const pick = (id) => ids.find((x) => x.id === id);
        const pass = { a: "respond", slot: null };
        if (pd.on === "summon") { const t = pick("pitfall_doodle"); return t ? { a: "respond", slot: t.slot } : pass; }
        if (pd.on === "spell") {
          const sid = pd.spell && pd.spell.id;
          const harmful = REMOVAL.indexOf(sid) !== -1 || ["masterpiece", "cursed_crown", "paper_cut", "second_draft"].indexOf(sid) !== -1 ||
            (BY()[sid] && BY()[sid].sub === "field");
          const scratch = pick("scratch_that");
          if (scratch && harmful) return { a: "respond", slot: scratch.slot };
          const nope = pick("nope");
          const big = ["erase", "crumple", "stick_squad", "big_eraser", "masterpiece", "cursed_crown", "page_turn", "writers_block"].indexOf(sid) !== -1;
          if (nope && big && P.lp > 1200 && (sid !== "big_eraser" || myMons.length >= oppMons.length)) return { a: "respond", slot: nope.slot };
          return pass;
        }
        const att = O.mz[pd.attacker];
        const A = att ? att.atk : 0;
        const tgt = pd.target == null ? null : P.mz[pd.target];
        const outcome = (atk) => {
          if (!tgt) return { lost: false, dmg: pd.fly ? Math.floor(atk / 2) : atk };
          const myVal = tgt.pos === "atk" ? tgt.atk : tgt.def;
          const shield = tgt.id === "dot_dummy" && !P.dummyUsed;
          if (tgt.pos === "atk") return { lost: atk > myVal && !shield, dmg: Math.max(0, atk - myVal) };
          return { lost: atk > myVal && !shield, dmg: att && att.pierce ? Math.max(0, atk - myVal) : 0 };
        };
        const bad = (o) => o.lost || o.dmg >= 500;
        const now = outcome(A);
        const spike = pick("spike_pit"), mirror = pick("mirror_sheet"), sticky = pick("sticky_note");
        const smudge = pick("smudge"), whoops = pick("whoops");
        if (spike) return { a: "respond", slot: spike.slot };   // free kill: always worth it
        if (mirror && (now.dmg >= 600 || now.lost)) return { a: "respond", slot: mirror.slot };
        if (!bad(now)) return pass;
        if (smudge && !bad(outcome(Math.max(0, A - 300)))) return { a: "respond", slot: smudge.slot };
        if (sticky) return { a: "respond", slot: sticky.slot };
        const big = (now.lost && tgt && BY()[tgt.id].stars >= 3) || now.dmg >= 900;
        if (whoops && big && P.lp > 900) return { a: "respond", slot: whoops.slot };
        if (smudge && !now.lost) return { a: "respond", slot: smudge.slot };
        return pass;
      }
      return null;
    }
    if (V.active !== me || V.winner != null || V.pending) return null;

    /* casting helpers: a spell can be in hand or set face-down */
    const castables = [];
    P.hand.forEach((c) => { if (can(L, c, "activate")) castables.push({ id: c.id, act: { a: "activate", uid: c.uid }, key: "h" + c.uid }); });
    P.sz.forEach((c, i) => { if (c && !c.faceUp && (L.sz[i] || []).includes("activate")) castables.push({ id: c.id, act: { a: "activate", slot: i }, key: "s" + i }); });
    const find = (id) => castables.find((x) => x.id === id);
    const tg = (x) => (V.spellTargets && V.spellTargets[x.key]) || [];
    const cast = (x, target) => Object.assign({}, x.act, target ? { target } : {});
    const fieldBonus = (fid, side) => {
      const f = (BY()[fid].fx.field) || {};
      const mons = side === me ? myMons.concat(P.hand.filter((c) => BY()[c.id].kind === "monster").map((c) => ({ id: c.id, half: true }))) : oppMons;
      return mons.reduce((t, m) => t + ((f[BY()[m.id].type] || [0])[0] * (m.half ? 0.5 : 1)), 0);
    };
    const threat = (m) => m.atk + (BY()[m.id].sub === "effect" ? 200 : 0) + (m.eq ? m.eq.length * 300 : 0);

    if (V.phase === "main") {
      /* 1. removal on the scariest enemy */
      for (const id of ["erase", "crumple", "stick_squad", "page_turn"]) {
        const x = find(id);
        if (!x) continue;
        const ts = tg(x).filter((t) => t.p === op).sort((a, b) => threat(O.mz[b.slot]) - threat(O.mz[a.slot]));
        if (!ts.length) continue;
        const m = O.mz[ts[0].slot];
        if (id === "page_turn" && BY()[m.id].stars < 5 && !(m.eq && m.eq.length)) continue;
        if (m.atk >= 900 || m.atk >= myBest || id === "crumple") return cast(x, ts[0]);
      }
      /* 2. the big eraser when behind on board */
      const be = find("big_eraser");
      if (be) {
        const mine = myMons.reduce((t, m) => t + threat(m), 0), theirs = oppMons.reduce((t, m) => t + threat(m), 0);
        if (theirs > mine + 1800 && P.lp > 1600) return cast(be);
      }
      /* 3. curses on their best monster */
      for (const id of ["writers_block", "smear_curse"]) {
        const x = find(id);
        if (!x) continue;
        const ts = tg(x).filter((t) => t.p === op).sort((a, b) => O.mz[b.slot].atk - O.mz[a.slot].atk);
        if (ts.length && O.mz[ts[0].slot].atk >= 1200 && !(O.mz[ts[0].slot].eq || []).some((e) => e.id === id)) return cast(x, ts[0]);
      }
      /* 4. card draw / tempo */
      const qs = find("masterpiece") || find("quick_sketch");
      if (qs && P.hand.length <= 5 && P.deck > 5) return cast(qs);
      const rf = find("refill");
      if (rf && P.lp <= 3000) return cast(rf);
      const pc = find("paper_cut");
      if (pc && (O.lp <= 400 || P.hand.length >= 4)) return cast(pc);
      const sd = find("second_draft");
      if (sd && myMons.length < 3) return cast(sd);
      /* 5. field spells that help me more than them */
      for (const id of ["graph_paper", "ink_sea", "doodle_park"]) {
        const x = find(id);
        if (!x || (V.field && V.field.id === id)) continue;
        const gain = fieldBonus(id, me) - fieldBonus(id, op);
        const cur = V.field ? fieldBonus(V.field.id, me) - fieldBonus(V.field.id, op) : 0;
        if (gain >= 300 && gain > cur) return cast(x);
      }
      const ink = find("ink_flood");
      if (ink && V.turn > 1 && myMons.some((m) => m.pos === "atk" && !m.attacked && oppMons.some((o) => o.pos === "atk" && o.atk >= m.atk && o.atk - 500 < m.atk))) return cast(ink);

      /* 6. summon */
      if (!P.summoned) {
        const mons = P.hand.filter((c) => BY()[c.id].kind === "monster" && can(L, c, "summon"));
        const tribOf = (c) => {
          const cd = BY()[c.id];
          if (cd.id === "doodle_prince" && myMons.some((m) => BY()[m.id].type === "DOODLE")) return 0;
          return cd.stars >= 7 ? 2 : cd.stars >= 5 ? 1 : 0;
        };
        let pick = null, trib = [];
        const big = mons.filter((c) => tribOf(c) > 0).sort((a, b) => BY()[b.id].atk - BY()[a.id].atk);
        for (const c of big) {
          const n = tribOf(c);
          if (myMons.length < n) continue;
          const cd = BY()[c.id];
          if (cd.id === "eraser_god") {
            const mine = myMons.reduce((t, m) => t + threat(m), 0), theirs = oppMons.reduce((t, m) => t + threat(m), 0);
            if (!(theirs > mine && P.lp > 2400)) continue;
          }
          const fodder = myMons.slice().sort((a, b) => threat(a) - threat(b)).slice(0, n);
          const lostVal = fodder.reduce((t, m) => t + m.atk, 0);
          if (lostVal + 400 < cd.atk) { pick = c; trib = fodder.map((m) => m.slot); break; }
        }
        if (!pick) {
          const free = P.mz.some((m) => !m);
          const prince = mons.find((c) => c.id === "doodle_prince" && tribOf(c) === 0);
          const plain = mons.filter((c) => tribOf(c) === 0).sort((a, b) => value(b.id) - value(a.id));
          if (free && prince) pick = prince;
          else if (free && plain.length) pick = plain[0];
        }
        if (pick) {
          const c = BY()[pick.id];
          const strong = c.atk >= oppMaxAtk || oppMons.length === 0 || c.id === "stick_runner";
          const mode = strong || c.def < 300 ? "summon" : "set";
          return { a: mode, uid: pick.uid, tributes: trib };
        }
      }
      /* 7. equips on my best monster */
      for (const id of ["cursed_crown", "ruler_lance", "pencil_sword", "cardboard_shield"]) {
        const x = find(id);
        if (!x) continue;
        if (id === "cursed_crown" && P.lp < 2200) continue;
        const ts = tg(x).filter((t) => t.p === me && !P.mz[t.slot].blocked);
        if (!ts.length) continue;
        let t;
        if (id === "cardboard_shield") { t = ts.find((q) => P.mz[q.slot].pos === "def"); if (!t) continue; }
        else t = ts.sort((a, b) => P.mz[b.slot].atk - P.mz[a.slot].atk)[0];
        if ((P.mz[t.slot].eq || []).length >= 2) continue;
        return cast(x, t);
      }
      /* 8. switch positions */
      for (let slot = 0; slot < P.mz.length; slot++) {
        const m = P.mz[slot];
        if (!m || !(L.mz[slot] || []).includes("pos")) continue;
        if (m.pos === "def" && m.atk > oppMaxAtk && !m.blocked) return { a: "pos", slot };
        if (m.pos === "atk" && (m.atk < oppMaxAtk || m.blocked) && m.def > m.atk + 200) return { a: "pos", slot };
      }
      /* 9. one-turn pumps when they win a fight */
      for (const id of ["knights_charge", "sharpen"]) {
        const x = find(id);
        if (!x || V.turn <= 1) continue;
        const n = id === "sharpen" ? 500 : 800;
        const ts = tg(x).filter((t) => t.p === me);
        for (const t of ts) {
          const m = P.mz[t.slot];
          if (m.pos !== "atk" || m.blocked || m.attacked) continue;
          const turnsWin = oppMons.some((o) => { const v = o.pos === "atk" ? o.atk : o.def; return m.atk <= v && m.atk + n > v; });
          if (turnsWin || (!oppMons.length && O.lp <= m.atk + n)) return cast(x, t);
        }
      }
      /* 10. Lord of Lines */
      for (let slot = 0; slot < P.mz.length; slot++) {
        if ((L.mz[slot] || []).includes("effect") && V.turn > 1) return { a: "effect", slot };
      }
      /* 11. set traps (and a counter-able spare spell if hand is full) */
      const trap = P.hand.find((c) => BY()[c.id].kind === "trap" && can(L, c, "setst"));
      if (trap) return { a: "setst", uid: trap.uid };
      if (P.hand.length > 6) {
        const sp = P.hand.find((c) => BY()[c.id].kind === "spell" && can(L, c, "setst"));
        if (sp) return { a: "setst", uid: sp.uid };
      }
      return { a: "phase" };
    }

    if (V.phase === "battle") {
      const mine = myMons.filter((m) => (L.mz[m.slot] || []).includes("attack")).sort((a, b) => b.atk - a.atk);
      for (const m of mine) {
        if (L.attackDirect) return { a: "attack", slot: m.slot, target: null };
        let best = null, bestScore = -1;
        (L.atkTargets[m.slot] || []).forEach((slot) => {
          const t = Object.assign({ slot }, O.mz[slot]);
          let win = false, score = 0;
          if (t.pos === "atk") { win = m.atk > t.atk; score = t.atk + (m.atk - t.atk); }
          else { win = m.atk > t.def; score = t.atk + (m.pierce ? m.atk - t.def : 0); }
          if (t.id === "dot_dummy" && !O.dummyUsed) score -= 400;
          if (t.id === "ink_blot") score -= 200;
          if (win && score > bestScore) { best = t; bestScore = score; }
        });
        if (best) return { a: "attack", slot: m.slot, target: best.slot };
        if (L.fly[m.slot]) return { a: "attack", slot: m.slot, target: null };
      }
      return { a: "phase" };
    }
    return null;
  }

  global.LLCAI = { decide, value };
})(typeof window !== "undefined" ? window : globalThis);
