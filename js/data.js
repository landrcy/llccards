/* LLC Cards: Edition One set data, rarities and pack math. No frameworks.
   kind: monster | spell | trap.  sub (spells/traps): normal, buff, curse, equip, field, combo, counter.
   type (monsters): DOODLE, BEAST, MACHINE, SPIRIT, PAPER.
   rarity: C (common), R (rare), SR (super rare, full-art colour), SCR (secret rare, inverted full art). */
(function (global) {
  const SET_ID = "edition_one";
  const SET_NAME = "LLC Cards Edition One";
  const PACK_SIZE = 5;
  const FOIL_CHANCE = 1 / 10;

  const M = (id, name, stars, rarity, type, atk, def, effect, fx) => ({ id, name, kind: "monster", sub: fx && fx.vanilla ? "normal" : "effect", type, stars, rarity, atk, def, effect, fx: fx || {}, set: (fx && fx.set) || "edition_one" });
  const S = (id, name, stars, rarity, sub, effect, fx) => ({ id, name, kind: "spell", sub, stars, rarity, atk: null, def: null, effect, fx: fx || {}, set: (fx && fx.set) || "edition_one" });
  const T = (id, name, stars, rarity, sub, effect, fx) => ({ id, name, kind: "trap", sub, stars, rarity, atk: null, def: null, effect, fx: fx || {}, set: (fx && fx.set) || "edition_one" });

  const CARDS = [
    /* ---------- monsters ---------- */
    M("dot_dummy", "DOT DUMMY", 1, "C", "DOODLE", 200, 400, "Once per match: cannot be destroyed by battle."),
    M("paper_clip", "PAPER CLIP", 1, "C", "PAPER", 300, 300, "When destroyed: draw 1 card."),
    M("ink_blot", "INK BLOT", 1, "C", "SPIRIT", 100, 200, "When destroyed by battle: the attacker loses 300 ATK for good."),
    M("stick_runner", "STICK RUNNER", 2, "C", "DOODLE", 500, 200, "Can attack the turn it is played."),
    M("doodle_dog", "DOODLE DOG", 2, "C", "BEAST", 600, 400, "Gains 300 ATK while you control another BEAST."),
    M("paper_plane", "PAPER PLANE", 2, "C", "PAPER", 700, 100, "Can fly over monsters to attack directly, for half damage."),
    M("squiggle_worm", "SQUIGGLE WORM", 3, "C", "BEAST", 900, 600, "When played, draw 1 card."),
    M("crayon_kid", "CRAYON KID", 3, "C", "DOODLE", 800, 900, "When summoned: gain 500 LP."),
    M("tape_mummy", "TAPE MUMMY", 3, "C", "PAPER", 500, 1400, "Taunt: enemies must attack this monster first."),
    M("scribble_cat", "SCRIBBLE CAT", 3, "R", "BEAST", 1000, 700, "Your opponent's spells and traps can't target it."),
    M("eraser_bug", "ERASER BUG", 3, "R", "BEAST", 700, 500, "When summoned: destroy 1 random spell/trap your opponent controls."),
    M("pencil_warrior", "PENCIL WARRIOR", 4, "C", "DOODLE", 1500, 800, "A brave little doodle with a big pencil. No effect.", { vanilla: true }),
    M("gear_golem", "GEAR GOLEM", 4, "C", "MACHINE", 1200, 1600, "You take no battle damage from fights with this card."),
    M("robo_ruler", "ROBO RULER", 4, "C", "MACHINE", 1600, 900, "Cannot attack directly."),
    M("box_knight", "BOX KNIGHT", 4, "R", "MACHINE", 1400, 1200, "When it destroys a monster in battle: +200 ATK (max +600)."),
    M("ghost_scribble", "GHOST SCRIBBLE", 4, "R", "SPIRIT", 1200, 600, "Once per match: when destroyed by battle, return it to your hand."),
    M("shadow_hatch", "SHADOW HATCH", 4, "R", "SPIRIT", 1100, 1000, "When summoned: your opponent discards 1 random card."),
    M("stapler_croc", "STAPLER CROC", 4, "R", "BEAST", 1500, 800, "When it destroys a monster in battle: deal 300 damage."),
    M("lord_of_lines", "LORD OF LINES", 5, "SR", "DOODLE", 2000, 1600, "Once per turn: +100 ATK this turn for each other monster you control."),
    M("doodle_prince", "DOODLE PRINCE", 5, "R", "DOODLE", 1800, 1200, "Combo: needs no tribute if you control another DOODLE."),
    M("marker_titan", "MARKER TITAN", 6, "SR", "MACHINE", 2200, 1600, "Pierce: deals battle damage past DEFENSE."),
    M("notebook_hydra", "NOTEBOOK HYDRA", 6, "SR", "BEAST", 2000, 1800, "+100 ATK for each monster in your graveyard (max +600)."),
    M("ink_dragon", "INK DRAGON", 7, "SR", "SPIRIT", 2700, 2200, "When summoned: destroy every enemy monster with 1000 ATK or less."),
    M("eraser_god", "THE ERASER GOD", 8, "SCR", "SPIRIT", 3500, 3000, "When summoned: destroy all other monsters. You lose 600 LP each of your turns."),

    /* ---------- spells ---------- */
    S("erase", "ERASE", 2, "C", "normal", "Destroy 1 monster with 1200 ATK or less.", { tgt: "any_mon", maxAtk: 1200 }),
    S("quick_sketch", "QUICK SKETCH", 3, "C", "normal", "Draw 2 cards, then discard 1 card."),
    S("ink_flood", "INK FLOOD", 4, "R", "normal", "All enemy monsters lose 500 ATK until end of turn."),
    S("sharpen", "SHARPEN", 1, "C", "buff", "Buff: a monster you control gains 500 ATK this turn.", { tgt: "my_mon" }),
    S("refill", "REFILL", 1, "C", "buff", "Buff: gain 1000 LP."),
    S("crumple", "CRUMPLE", 3, "C", "normal", "Destroy 1 enemy monster in DEFENSE mode.", { tgt: "opp_def" }),
    S("page_turn", "PAGE TURN", 3, "R", "normal", "Return 1 monster to its owner's hand.", { tgt: "any_mon" }),
    S("second_draft", "SECOND DRAFT", 3, "R", "normal", "Summon your strongest 4-star-or-lower monster from your graveyard in DEFENSE mode."),
    S("masterpiece", "MASTERPIECE", 4, "SR", "normal", "Draw 3 cards, then discard 1 card."),
    S("smear_curse", "SMEAR CURSE", 2, "C", "curse", "Curse: an enemy monster loses 500 ATK while this card stays.", { tgt: "opp_mon", attach: true, atk: -500 }),
    S("writers_block", "WRITER'S BLOCK", 3, "R", "curse", "Curse: an enemy monster can't attack while this card stays.", { tgt: "opp_mon", attach: true, noAttack: true }),
    S("paper_cut", "PAPER CUT", 1, "C", "curse", "Curse: your opponent takes 500 damage."),
    S("pencil_sword", "PENCIL SWORD", 2, "C", "equip", "Equip: +400 ATK.", { tgt: "my_mon", attach: true, atk: 400 }),
    S("cardboard_shield", "CARDBOARD SHIELD", 2, "C", "equip", "Equip: +200 ATK and +700 DEF.", { tgt: "my_mon", attach: true, atk: 200, def: 700 }),
    S("ruler_lance", "RULER LANCE", 3, "R", "equip", "Equip: +300 ATK and pierce (damage past DEFENSE).", { tgt: "my_mon", attach: true, atk: 300, pierce: true }),
    S("cursed_crown", "CURSED CROWN", 5, "SCR", "equip", "Equip: +1500 ATK. You lose 500 LP at the start of each of your turns.", { tgt: "my_mon", attach: true, atk: 1500 }),
    S("graph_paper", "GRAPH PAPER", 2, "C", "field", "Field: MACHINE monsters gain 300 ATK and 300 DEF.", { field: { MACHINE: [300, 300] } }),
    S("ink_sea", "INK SEA", 3, "R", "field", "Field: SPIRIT monsters gain 400 ATK. MACHINE monsters lose 200 ATK.", { field: { SPIRIT: [400, 0], MACHINE: [-200, 0] } }),
    S("doodle_park", "DOODLE PARK", 2, "C", "field", "Field: DOODLE and BEAST monsters gain 300 ATK.", { field: { DOODLE: [300, 0], BEAST: [300, 0] } }),
    S("stick_squad", "STICK SQUAD", 3, "R", "combo", "Combo: if you control 2+ DOODLE monsters, destroy 1 enemy monster.", { tgt: "opp_mon" }),
    S("knights_charge", "KNIGHT'S CHARGE", 2, "C", "combo", "Combo: your BOX KNIGHT or PENCIL WARRIOR gains 800 ATK this turn.", { tgt: "my_mon" }),
    S("big_eraser", "THE BIG ERASER", 6, "SCR", "normal", "Destroy ALL monsters. Then you lose half your LP."),

    /* ---------- traps ---------- */
    T("smudge", "SMUDGE", 2, "C", "normal", "When attacked: the attacker loses 300 ATK this turn.", { on: "attack" }),
    T("sticky_note", "STICKY NOTE", 2, "C", "normal", "When attacked: stop the attack and flip the attacker to DEFENSE.", { on: "attack" }),
    T("spike_pit", "SPIKE PIT", 3, "R", "normal", "When an enemy attacks: destroy it if its ATK is 1600 or less.", { on: "attack" }),
    T("whoops", "WHOOPS!", 4, "R", "normal", "Pay 300 LP: stop an attack. If its ATK is 1500+, it loses 500 ATK for good.", { on: "attack" }),
    T("mirror_sheet", "MIRROR SHEET", 5, "SR", "normal", "When an enemy attacks: stop it and deal half its ATK to your opponent.", { on: "attack" }),
    T("pitfall_doodle", "PITFALL DOODLE", 3, "C", "normal", "When your opponent summons a monster with 1500+ ATK: it loses 700 ATK for good.", { on: "summon" }),
    T("nope", "NOPE!", 4, "R", "counter", "Counter: when your opponent casts a spell, pay 300 LP to cancel it.", { on: "spell" }),
    T("scratch_that", "SCRATCH THAT", 2, "C", "counter", "Counter: cancel a spell that targets one of your monsters.", { on: "spell" }),
  ];

  const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const RARITY_NAME = { C: "COMMON", R: "RARE", SR: "SUPER RARE", SCR: "SECRET RARE" };
  const RARITY_ORDER = ["C", "R", "SR", "SCR"];
  const fullArt = (c) => c && (c.rarity === "SR" || c.rarity === "SCR");

  /* Pack rates, per card slot. Shown in the shop. */
  const PACKS = {
    edition_one: {
      id: "edition_one", name: "EDITION ONE", size: 5, cost: 0,
      set: "edition_one",
      slots: [{ C: 74, R: 22, SR: 3.5, SCR: 0.5 }],
    },
    super_rare: {
      id: "super_rare", name: "SUPER RARE PACK", size: 3, cost: 300,
      slots: [{ R: 78, SR: 19, SCR: 3 }, { R: 78, SR: 19, SCR: 3 }, { SR: 88, SCR: 12 }],
    },
    edition_two: {
      id: "edition_two", name: "EDITION TWO", size: 5, cost: 0,
      set: "edition_two",
      slots: [{ C: 74, R: 22, SR: 3.5, SCR: 0.5 }],
    },
  };

  function params() { return new URLSearchParams(location.search); }
  function forceFoil() { const v = params().get("foil"); return v === "1" || v === "true"; }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng() {
    const s = params().get("seed");
    if (s != null && s !== "") {
      const n = Number(s);
      return mulberry32(Number.isFinite(n) ? n : [...s].reduce((a, ch) => a + ch.charCodeAt(0), 0));
    }
    return Math.random;
  }
  function pick(rng, weights) {
    const keys = Object.keys(weights).filter((k) => weights[k] > 0);
    const total = keys.reduce((a, k) => a + weights[k], 0);
    let r = rng() * total;
    for (const k of keys) { r -= weights[k]; if (r <= 0) return k; }
    return keys[keys.length - 1];
  }
  /* Within a rarity, lower-star cards are a little more common. */
  const STAR_WEIGHT = { 1: 6, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 2, 8: 1 };
  function pullPack(rng, packId, opts) {
    opts = opts || {};
    rng = rng || makeRng();
    const P = PACKS[packId || "edition_one"];
    const foilAll = forceFoil();
    const out = [];
    for (let n = 0; n < P.size; n++) {
      const slot = P.slots[Math.min(n, P.slots.length - 1)];
      const rar = opts.force && n === P.size - 1 ? opts.force : pick(rng, slot);
      const inSet = (c) => !P.set || c.set === P.set;
      let pool = CARDS.filter((c) => c.rarity === rar && inSet(c) && !out.some((o) => o.id === c.id));
      if (!pool.length) pool = CARDS.filter((c) => c.rarity === rar && inSet(c));
      const w = {};
      pool.forEach((c) => { w[c.id] = STAR_WEIGHT[c.stars] || 1; });
      const card = BY_ID[pick(rng, w)];
      out.push({ id: card.id, card, rarity: card.rarity, foil: !fullArt(card) && (foilAll || opts.allFoil || rng() < FOIL_CHANCE) });
    }
    return out;
  }
  /* Exact per-card chance of a pack slot, for the shop's rate table. */
  function rateTable(packId) {
    const P = PACKS[packId];
    return RARITY_ORDER.map((r) => {
      const per = P.slots.map((s) => (s[r] || 0) / 100);
      const anyInPack = 1 - Array.from({ length: P.size }, (_, i) => 1 - per[Math.min(i, per.length - 1)]).reduce((a, b) => a * b, 1);
      const inSet = (c) => !P.set || c.set === P.set;
      return { rarity: r, name: RARITY_NAME[r], perCard: per, perPack: anyInPack, count: CARDS.filter((c) => c.rarity === r && inSet(c)).length };
    }).filter((x) => x.perPack > 0);
  }

  function register(extra) {
    if (!extra || !extra.length) return;
    extra.forEach((c) => CARDS.push(c));
    extra.forEach((c) => { BY_ID[c.id] = c; });
  }
  /* Official starter decks the builder can load in one click. Hangar is 0–2 fusions, not part of the 20. */
  const TEMPLATES = [
    {
      id: "ed1-starter",
      name: "INK STARTER",
      label: "EDITION ONE: INK STARTER",
      set: "edition_one",
      cards: [
        "stick_runner","stick_runner",
        "pencil_warrior","pencil_warrior","pencil_warrior",
        "doodle_dog","doodle_dog",
        "crayon_kid","squiggle_worm","tape_mummy","doodle_prince",
        "erase","erase","quick_sketch","quick_sketch","crumple","doodle_park",
        "sticky_note","sticky_note","pitfall_doodle"
      ],
      hangar: []
    }
  ];

  global.LLCData = {
    SET_ID, SET_NAME, PACK_SIZE, FOIL_CHANCE, STAR_WEIGHT, PACKS, RARITY_NAME, RARITY_ORDER,
    CARDS, BY_ID, TEMPLATES, params, forceFoil, makeRng, pullPack, rateTable, mulberry32, fullArt,
    register, M, S, T,
  };
})(typeof window !== "undefined" ? window : globalThis);
