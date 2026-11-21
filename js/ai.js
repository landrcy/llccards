/* LLC Cards bot. Reads only its own redacted view, returns one action at a time. */
(function (global) {
  const BY = () => global.LLCData.BY_ID;

  function value(id) {
    const c = BY()[id];
    if (!c) return 0;
    if (c.kind === "monster") return c.atk + c.def * 0.3;
    return { erase: 1100, whoops: 1000, smudge: 700, quick_sketch: 800, ink_flood: 400 }[c.id] || 500;
  }

  function decide(V) {
    const me = V.me, op = 1 - me;
    const P = V.players[me], O = V.players[op];
    const L = V.legal;

    /* ---- responses ---- */
    if (V.pending && !V.pending.waiting && V.pending.player === me) {
      const pd = V.pending;
      if (pd.type === "discard") {
        const worst = P.hand.slice().sort((a, b) => value(a.id) - value(b.id))[0];
        return { a: "discard", uid: worst.uid };
      }
      if (pd.type === "trap") {
        const att = O.mz[pd.attacker];
        const A = att ? att.atk : 0;
        const tgt = pd.target == null ? null : P.mz[pd.target];
        const outcome = (atk) => {
          if (!tgt) return { lost: false, dmg: atk };
          const myVal = tgt.pos === "atk" ? tgt.atk : tgt.def;
          if (tgt.pos === "atk") return { lost: atk > myVal && tgt.id !== "dot_dummy", dmg: Math.max(0, atk - myVal) };
          return { lost: atk > myVal && tgt.id !== "dot_dummy", dmg: 0 };
        };
        const bad = (o) => o.lost || o.dmg >= 500;
        const ids = pd.options.map((slot) => ({ slot, id: P.sz[slot].id }));
        const smudge = ids.find((x) => x.id === "smudge");
        const whoops = ids.find((x) => x.id === "whoops");
        const now = outcome(A);
        if (!bad(now)) return { a: "respond", slot: null };
        if (smudge && !bad(outcome(Math.max(0, A - 300)))) return { a: "respond", slot: smudge.slot };
        // WHOOPS! costs LP and only one trap fires per turn: save it for real threats
        const big = (now.lost && tgt && (BY()[tgt.id].stars >= 3)) || now.dmg >= 900;
        if (whoops && big && P.lp > 900) return { a: "respond", slot: whoops.slot };
        if (smudge && now.dmg - 300 < now.dmg && !now.lost) return { a: "respond", slot: smudge.slot };
        return { a: "respond", slot: null };
      }
      return null;
    }
    if (V.active !== me || V.winner != null || V.pending) return null;

    const oppMons = O.mz.map((m, slot) => (m ? Object.assign({ slot }, m) : null)).filter(Boolean);
    const oppMaxAtk = oppMons.reduce((mx, m) => Math.max(mx, m.pos === "atk" ? m.atk : 0), 0);

    if (V.phase === "main") {
      /* 1. Erase the best legal enemy target */
      const enemyErase = V.eraseTargets.filter((t) => t.p === op)
        .sort((a, b) => O.mz[b.slot].atk - O.mz[a.slot].atk);
      if (enemyErase.length) {
        const h = P.hand.find((c) => c.id === "erase" && (L.hand[c.uid] || []).includes("activate"));
        if (h) return { a: "activate", uid: h.uid, target: { p: op, slot: enemyErase[0].slot } };
        const zi = P.sz.findIndex((c, i) => c && c.id === "erase" && (L.sz[i] || []).includes("activate"));
        if (zi !== -1) return { a: "activate", slot: zi, target: { p: op, slot: enemyErase[0].slot } };
      }
      /* 2. Ink Flood when it opens up an Erase */
      const hasErase = P.hand.some((c) => c.id === "erase");
      const ink = P.hand.find((c) => c.id === "ink_flood" && (L.hand[c.uid] || []).includes("activate"));
      if (ink && hasErase && oppMons.some((m) => m.atk > 1000 && m.atk - 400 <= 1000)) {
        return { a: "activate", uid: ink.uid };
      }
      /* 3. Quick Sketch */
      const qs = P.hand.find((c) => c.id === "quick_sketch" && (L.hand[c.uid] || []).includes("activate"));
      if (qs && P.hand.length <= 5 && P.deck > 4) return { a: "activate", uid: qs.uid };

      /* 4. Summon */
      if (!P.summoned) {
        const mons = P.hand.filter((c) => BY()[c.id].kind === "monster" && (L.hand[c.uid] || []).includes("summon"));
        const myMons = P.mz.map((m, slot) => (m ? Object.assign({ slot }, m) : null)).filter(Boolean);
        let pick = null, trib = [];
        const lord = mons.find((c) => BY()[c.id].stars >= 5);
        if (lord && myMons.length) {
          const weakest = myMons.slice().sort((a, b) => value(a.id) - value(b.id))[0];
          if (BY()[weakest.id].atk + 500 < BY()[lord.id].atk) { pick = lord; trib = [weakest.slot]; }
        }
        if (!pick) {
          const plain = mons.filter((c) => BY()[c.id].stars < 5).sort((a, b) => BY()[b.id].atk - BY()[a.id].atk);
          if (plain.length && P.mz.some((m) => !m)) pick = plain[0];
        }
        if (pick) {
          const c = BY()[pick.id];
          const strong = c.atk >= oppMaxAtk || oppMons.length === 0;
          const mode = strong || c.def < 300 ? "summon" : "set";
          return { a: mode, uid: pick.uid, tributes: trib };
        }
      }
      /* 5. Switch positions */
      for (let slot = 0; slot < P.mz.length; slot++) {
        const m = P.mz[slot];
        if (!m || !(L.mz[slot] || []).includes("pos")) continue;
        if (m.pos === "def" && m.atk > oppMaxAtk) return { a: "pos", slot };
        if (m.pos === "atk" && m.atk < oppMaxAtk && m.def > m.atk + 200) return { a: "pos", slot };
      }
      /* 6. Lord of Lines boost */
      for (let slot = 0; slot < P.mz.length; slot++) {
        if ((L.mz[slot] || []).includes("effect") && V.turn > 1) return { a: "effect", slot };
      }
      /* 7. Set traps */
      const trap = P.hand.find((c) => BY()[c.id].kind === "trap" && (L.hand[c.uid] || []).includes("setst"));
      if (trap) return { a: "setst", uid: trap.uid };
      return { a: "phase" };
    }

    if (V.phase === "battle") {
      const mine = P.mz.map((m, slot) => (m ? Object.assign({ slot }, m) : null))
        .filter((m) => m && (L.mz[m.slot] || []).includes("attack"))
        .sort((a, b) => b.atk - a.atk);
      for (const m of mine) {
        if (L.attackDirect) return { a: "attack", slot: m.slot, target: null };
        let best = null, bestScore = -1;
        oppMons.forEach((t) => {
          let win = false, score = 0;
          if (t.pos === "atk") { win = m.atk > t.atk; score = t.atk + (m.atk - t.atk); }
          else { win = m.atk > t.def; score = t.atk; }
          if (t.id === "dot_dummy") score -= 400;
          if (win && score > bestScore) { best = t; bestScore = score; }
        });
        if (best) return { a: "attack", slot: m.slot, target: best.slot };
      }
      return { a: "phase" };
    }
    return null;
  }

  global.LLCAI = { decide };
})(typeof window !== "undefined" ? window : globalThis);
