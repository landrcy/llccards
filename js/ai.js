/* LLC Cards bot. Reads only its own redacted view, returns one action at a time.
   Difficulty (easy / normal / hard) is chosen on the VS BOT screen and passed into decide(). */
(function (global) {
  const BY = () => global.LLCData.BY_ID;
  const can = (L, c, what) => (L.hand[c.uid] || []).includes(what);
  const LOSS_INK = 25;
  const DIFF = {
    easy:   { id: "easy",   label: "EASY",   winInk: 60,  summons: 1, missAttack: 0.4, missTrap: 0.65 },
    normal: { id: "normal", label: "NORMAL", winInk: 100, summons: 2, missAttack: 0,   missTrap: 0 },
    hard:   { id: "hard",   label: "HARD",   winInk: 150, summons: 2, missAttack: 0,   missTrap: 0 },
  };
  function normalizeDiff(d) {
    const id = typeof d === "string" ? d : (d && (d.diff || d.difficulty)) || "normal";
    return DIFF[id] ? id : "normal";
  }
  function cfgOf(d) { return DIFF[normalizeDiff(d)]; }
  function inkReward(win, mode, diff) {
    if (!win) return LOSS_INK;
    if (mode === "online") return 150;
    return cfgOf(diff).winInk;
  }

  function value(id) {
    const c = BY()[id];
    if (!c) return 0;
    return global.LLCEngine && global.LLCEngine.cardValue ? global.LLCEngine.cardValue(c) : (c.atk || 500);
  }
  const REMOVAL = ["erase", "crumple", "stick_squad", "page_turn", "smear_curse", "writers_block", "big_eraser", "dismantle", "lockdown", "recall", "squad_link", "singularity"];

  function decide(V, opts) {
    const cfg = cfgOf(opts);
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
        if (cfg.missTrap && Math.random() < cfg.missTrap) return pass;
        if (pd.on === "summon" || pd.on === "ss") { const t = pick("pitfall_doodle") || pick("trip_mine"); return t ? { a: "respond", slot: t.slot } : pass; }
        if (pd.on === "spell") {
          const sid = pd.spell && pd.spell.id;
          const harmful = REMOVAL.indexOf(sid) !== -1 || ["masterpiece", "cursed_crown", "paper_cut", "second_draft"].indexOf(sid) !== -1 ||
            (BY()[sid] && BY()[sid].sub === "field");
          const scratch = pick("scratch_that") || pick("force_dampener");
          if (scratch && harmful) return { a: "respond", slot: scratch.slot };
          const nope = pick("nope") || pick("no_signal");
          const big = ["erase", "crumple", "stick_squad", "big_eraser", "masterpiece", "cursed_crown", "page_turn", "writers_block", "singularity", "mainframe", "mech_link", "squad_link", "dismantle"].indexOf(sid) !== -1;
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
        const spike = pick("spike_pit") || pick("rail_trap"), mirror = pick("mirror_sheet") || pick("reflect_array"), sticky = pick("sticky_note") || pick("hard_light");
        const smudge = pick("smudge") || pick("static_shock"), whoops = pick("whoops") || pick("abort");
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
      const fx = BY()[fid].fx || {};
      const f = fx.field || {};
      const mons = side === me ? myMons.concat(P.hand.filter((c) => BY()[c.id].kind === "monster").map((c) => ({ id: c.id, half: true }))) : oppMons;
      let n = mons.reduce((t, m) => t + ((f[BY()[m.id].type] || [0])[0] * (m.half ? 0.5 : 1)), 0);
      if (fx.fieldFusion) {
        const fus = (side === me ? myMons : oppMons).filter((m) => BY()[m.id].fx && BY()[m.id].fx.fusion);
        n += fus.length * (fx.fieldFusion[0] || 0);
        if (side === me) n += ((P.hangar || []).length) * (fx.fieldFusion[0] || 0) * 0.5;
      }
      return n;
    };
    const threat = (m) => m.atk + (BY()[m.id].sub === "effect" ? 200 : 0) + (m.eq ? m.eq.length * 300 : 0);

    if (V.phase === "main") {
      /* 0. fusion via MECH LINK, then special-summon pilots */
      const ml = find("mech_link");
      const fusions = V.fusions || (L.fusions || []);
      if (ml && fusions.length) {
        const best = fusions.slice().sort((a, b) => value(b.id) - value(a.id))[0];
        return Object.assign({}, ml.act, { fusion: best.id, mats: best.mats });
      }
      const ss = P.hand.find((c) => can(L, c, "ss"));
      if (ss) return { a: "ss", uid: ss.uid };
      /* 1. removal on the scariest enemy */
      for (const id of ["erase", "crumple", "stick_squad", "page_turn", "dismantle", "lockdown", "recall", "squad_link"]) {
        const x = find(id);
        if (!x) continue;
        const ts = tg(x).filter((t) => t.p === op).sort((a, b) => threat(O.mz[b.slot]) - threat(O.mz[a.slot]));
        if (!ts.length) continue;
        const m = O.mz[ts[0].slot];
        if (id === "page_turn" && BY()[m.id].stars < 5 && !(m.eq && m.eq.length)) continue;
        if (m.atk >= 900 || m.atk >= myBest || id === "crumple") return cast(x, ts[0]);
      }
      /* 2. the big eraser when behind on board */
      const be = find("big_eraser") || find("singularity");
      if (be) {
        const mine = myMons.reduce((t, m) => t + threat(m), 0), theirs = oppMons.reduce((t, m) => t + threat(m), 0);
        if (theirs > mine + 1800 && P.lp > 1600) return cast(be);
      }
      /* 3. curses on their best monster */
      for (const id of ["writers_block", "smear_curse", "stasis_lock", "emp"]) {
        const x = find(id);
        if (!x) continue;
        const ts = tg(x).filter((t) => t.p === op).sort((a, b) => O.mz[b.slot].atk - O.mz[a.slot].atk);
        if (ts.length && O.mz[ts[0].slot].atk >= 1200 && !(O.mz[ts[0].slot].eq || []).some((e) => e.id === id)) return cast(x, ts[0]);
      }
      /* 4. card draw / tempo */
      const qs = find("masterpiece") || find("mainframe") || find("quick_sketch") || find("system_reboot");
      if (qs && P.hand.length <= 5 && P.deck > 5) return cast(qs);
      const rf = find("refill") || find("repair_kit");
      if (rf && P.lp <= 3000) return cast(rf);
      const pc = find("paper_cut") || find("jammer");
      if (pc && (O.lp <= 400 || P.hand.length >= 4)) return cast(pc);
      const sd = find("second_draft") || find("rebuild");
      if (sd && myMons.length < 3) return cast(sd);
      /* 5. field spells that help me more than them */
      for (const id of ["graph_paper", "ink_sea", "doodle_park", "nebula_dock", "battle_station"]) {
        const x = find(id);
        if (!x || (V.field && V.field.id === id)) continue;
        const gain = fieldBonus(id, me) - fieldBonus(id, op);
        const cur = V.field ? fieldBonus(V.field.id, me) - fieldBonus(V.field.id, op) : 0;
        if (gain >= 300 && gain > cur) return cast(x);
      }
      const ink = find("ink_flood");
      if (ink && V.turn > 1 && myMons.some((m) => m.pos === "atk" && !m.attacked && oppMons.some((o) => o.pos === "atk" && o.atk >= m.atk && o.atk - 500 < m.atk))) return cast(ink);

      /* 6. summon (up to the difficulty's cap; tribute summons count, special summons do not) */
      const used = P.summons || 0;
      const cap = Math.min((global.LLCEngine && LLCEngine.NORMAL_SUMMONS_PER_TURN) || 2, cfg.summons);
      if (used < cap) {
        const mons = P.hand.filter((c) => BY()[c.id].kind === "monster" && can(L, c, "summon"));
        const tribOf = (c) => {
          const cd = BY()[c.id];
          if (cd.id === "doodle_prince" && myMons.some((m) => BY()[m.id].type === "DOODLE")) return 0;
          if (cd.fx && cd.fx.noTributeIfType && myMons.some((m) => BY()[m.id].type === cd.fx.noTributeIfType)) return 0;
          return cd.stars >= 7 ? 2 : cd.stars >= 5 ? 1 : 0;
        };
        const fillsReq = (card, req) => req.id ? card.id === req.id : BY()[card.id].type === req.type;
        const missingFor = (recipe, fieldList) => {
          const used = {};
          const miss = [];
          (recipe || []).forEach((req) => {
            const idx = fieldList.findIndex((m, i) => !used[i] && fillsReq(m, req));
            if (idx >= 0) used[idx] = true; else miss.push(req);
          });
          return miss;
        };
        const recipes = (P.hangar || []).map((c) => ({ id: c.id, recipe: (BY()[c.id].fx || {}).fusion || [], val: value(c.id) })).sort((a, b) => b.val - a.val);
        const wantLink = !!(find("mech_link") && recipes.length && V.turn > 1 && !P.fused);
        const reserved = {};
        if (wantLink && cfg.id !== "easy" && recipes[0]) {
          const usedF = {};
          recipes[0].recipe.forEach((req) => {
            const idx = myMons.findIndex((m, i) => !usedF[i] && fillsReq(m, req));
            if (idx >= 0) { usedF[idx] = true; reserved[myMons[idx].slot] = true; }
          });
        }
        let pick = null, trib = [];
        const slack = cfg.id === "hard" ? 200 : 400;   // hard is happier to tribute
        const big = mons.filter((c) => tribOf(c) > 0).sort((a, b) => BY()[b.id].atk - BY()[a.id].atk);
        for (const c of big) {
          const n = tribOf(c);
          if (myMons.length < n) continue;
          const cd = BY()[c.id];
          if (cd.id === "eraser_god") {
            const mine = myMons.reduce((tot, m) => tot + threat(m), 0), theirs = oppMons.reduce((tot, m) => tot + threat(m), 0);
            if (!(theirs > mine && P.lp > 2400)) continue;
          }
          const fodder = myMons.filter((m) => !reserved[m.slot]).slice().sort((a, b) => threat(a) - threat(b)).slice(0, n);
          if (fodder.length < n) continue;
          const lostVal = fodder.reduce((tot, m) => tot + m.atk, 0);
          if (lostVal + slack < cd.atk) { pick = c; trib = fodder.map((m) => m.slot); break; }
        }
        // Hard: if a tribute monster is in hand but we still need fodder, and we have a second
        // summon this turn, play a weak monster first so the tribute can come out next.
        if (!pick && cfg.id === "hard" && used + 1 < cap) {
          const want = big.find((c) => tribOf(c) === myMons.length + 1);
          const free = P.mz.some((m) => !m);
          const fodder = mons.filter((c) => tribOf(c) === 0).sort((a, b) => value(a.id) - value(b.id));
          if (want && free && fodder.length) pick = fodder[0];
        }
        // Normal/Hard: if MECH LINK is in hand and a Hangar recipe is almost ready, summon the missing piece.
        if (!pick && wantLink && cfg.id !== "easy") {
          const rec = recipes[0];
          const miss = missingFor(rec.recipe, myMons);
          const free = P.mz.some((m) => !m);
          const ssReady = P.hand.some((c) => can(L, c, "ss"));
          if (free && miss.length && miss.length <= (cap - used) + (ssReady ? 1 : 0)) {
            const fill = mons.filter((c) => tribOf(c) === 0 && miss.some((req) => fillsReq(c, req)))
              .sort((a, b) => {
                const ae = miss.some((req) => req.id && a.id === req.id) ? 0 : 1;
                const be = miss.some((req) => req.id && b.id === req.id) ? 0 : 1;
                return ae - be || value(b.id) - value(a.id);
              });
            if (fill.length) pick = fill[0];
          }
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
      for (const id of ["omega_core", "cursed_crown", "rail_rifle", "ruler_lance", "beam_saber", "pencil_sword", "plate_armor", "cardboard_shield"]) {
        const x = find(id);
        if (!x) continue;
        if ((id === "cursed_crown" || id === "omega_core") && P.lp < 2200) continue;
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
      const oc = find("overclock");
      if (oc && V.turn > 1 && myMons.some((m) => BY()[m.id].type === "MACHINE" && m.pos === "atk" && !m.attacked)) return cast(oc);
      for (const id of ["knights_charge", "sharpen", "charge", "wing_clip"]) {
        const x = find(id);
        if (!x || V.turn <= 1) continue;
        const n = id === "sharpen" || id === "charge" ? 500 : 800;
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
      const dmgVs = (m, t) => {
        if (!t) return L.attackDirect ? m.atk : (L.fly[m.slot] ? Math.floor(m.atk / 2) : 0);
        if (t.pos === "atk") return m.atk > t.atk ? m.atk - t.atk : 0;
        return m.atk > t.def && m.pierce ? m.atk - t.def : 0;
      };
      const winsVs = (m, t) => t.pos === "atk" ? m.atk > t.atk : m.atk > t.def;
      if (cfg.id === "hard") {
        // lethal: a direct hit or one winning battle that finishes them
        if (L.attackDirect && mine.length) {
          const killer = mine.find((m) => m.atk >= O.lp) || mine[0];
          return { a: "attack", slot: killer.slot, target: null };
        }
        for (const m of mine) {
          const lethal = (L.atkTargets[m.slot] || []).find((slot) => dmgVs(m, O.mz[slot]) >= O.lp);
          if (lethal != null) return { a: "attack", slot: m.slot, target: lethal };
        }
        // smallest attacker that still wins, so bigger ones can go for lethal later
        let pick = null, pickScore = -Infinity;
        for (const m of mine) {
          (L.atkTargets[m.slot] || []).forEach((slot) => {
            const t = Object.assign({ slot }, O.mz[slot]);
            if (!winsVs(m, t)) return;
            let score = (t.pos === "atk" ? t.atk : t.def) + dmgVs(m, t) - m.atk * 0.15;
            if (t.id === "dot_dummy" && !O.dummyUsed) score -= 400;
            if (t.id === "ink_blot") score -= 200;
            if (score > pickScore) { pick = { m, t }; pickScore = score; }
          });
        }
        if (pick) return { a: "attack", slot: pick.m.slot, target: pick.t.slot };
        const flyer = mine.find((m) => L.fly[m.slot]);
        if (flyer) return { a: "attack", slot: flyer.slot, target: null };
        return { a: "phase" };
      }
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
        if (best) {
          if (cfg.missAttack && Math.random() < cfg.missAttack) continue;
          return { a: "attack", slot: m.slot, target: best.slot };
        }
        if (L.fly[m.slot]) {
          if (cfg.missAttack && Math.random() < cfg.missAttack) continue;
          return { a: "attack", slot: m.slot, target: null };
        }
      }
      return { a: "phase" };
    }
    return null;
  }

  global.LLCAI = { decide, value, DIFF, LOSS_INK, normalizeDiff, cfgOf, inkReward };
})(typeof window !== "undefined" ? window : globalThis);
