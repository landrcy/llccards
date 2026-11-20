/* LLC Cards — Edition One set data + pack math. No frameworks. */
(function (global) {
  const SET_ID = "edition_one";
  const SET_NAME = "LLC Cards Edition One";
  const PACK_SIZE = 5;
  const FOIL_CHANCE = 1 / 8;
  /* Lower stars are more common. */
  const STAR_WEIGHT = { 1: 8, 2: 5, 3: 3, 4: 2, 5: 1 };

  const CARDS = [
    { id: "dot_dummy", name: "DOT DUMMY", stars: 1, kind: "monster",
      effect: "Once per turn, this card cannot be destroyed by battle.",
      atk: 200, def: 400 },
    { id: "smudge", name: "SMUDGE", stars: 1, kind: "trap",
      effect: "Your opponent's attacking monster loses 300 ATK.",
      atk: null, def: null },
    { id: "stick_runner", name: "STICK RUNNER", stars: 2, kind: "monster",
      effect: "This card can attack the turn it is played.",
      atk: 500, def: 200 },
    { id: "erase", name: "ERASE", stars: 2, kind: "spell",
      effect: "Destroy 1 monster with 1000 ATK or less.",
      atk: null, def: null },
    { id: "squiggle_worm", name: "SQUIGGLE WORM", stars: 3, kind: "monster",
      effect: "When this card is played, draw 1 card.",
      atk: 900, def: 600 },
    { id: "quick_sketch", name: "QUICK SKETCH", stars: 3, kind: "spell",
      effect: "Draw 2 cards, then discard 1 card.",
      atk: null, def: null },
    { id: "whoops", name: "WHOOPS!", stars: 3, kind: "trap",
      effect: "Negate an attack. That monster loses 400 ATK.",
      atk: null, def: null },
    { id: "box_knight", name: "BOX KNIGHT", stars: 4, kind: "monster",
      effect: "If this card destroys a monster in battle, it gains 200 ATK.",
      atk: 1400, def: 1200 },
    { id: "ink_flood", name: "INK FLOOD", stars: 4, kind: "spell",
      effect: "All face-up monsters lose 400 ATK until the end of the turn.",
      atk: null, def: null },
    { id: "lord_of_lines", name: "LORD OF LINES", stars: 5, kind: "monster",
      effect: "Once per turn: this card gains 200 ATK for each monster you control.",
      atk: 2000, def: 1600 },
  ];

  const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

  function params() {
    return new URLSearchParams(location.search);
  }

  function forceFoil() {
    const v = params().get("foil");
    return v === "1" || v === "true";
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
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

  function pullPack(rng) {
    rng = rng || makeRng();
    const pool = CARDS.slice();
    const pulled = [];
    const foilAll = forceFoil();
    for (let n = 0; n < PACK_SIZE && pool.length; n++) {
      const weights = pool.map((c) => STAR_WEIGHT[c.stars] || 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rng() * total;
      let idx = 0;
      for (; idx < pool.length; idx++) {
        r -= weights[idx];
        if (r <= 0) break;
      }
      if (idx >= pool.length) idx = pool.length - 1;
      const card = pool.splice(idx, 1)[0];
      pulled.push({
        id: card.id,
        card,
        foil: foilAll || rng() < FOIL_CHANCE,
      });
    }
    return pulled;
  }

  global.LLCData = {
    SET_ID, SET_NAME, PACK_SIZE, FOIL_CHANCE, STAR_WEIGHT,
    CARDS, BY_ID, params, forceFoil, makeRng, pullPack, mulberry32,
  };
})(window);
