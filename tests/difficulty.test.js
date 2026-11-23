// Bot difficulty config, ink rewards, decks and a couple of AI checks.
// Run: node tests/difficulty.test.js
const mem = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};
global.window = global; global.location = { search: "" };
require("../js/data.js"); require("../js/data_ed2.js"); require("../js/engine.js"); require("../js/ai.js"); require("../js/storage.js");
const E = LLCEngine, S = LLCStorage, assert = require("assert");

assert.deepStrictEqual(Object.keys(LLCAI.DIFF).sort(), ["easy", "hard", "normal"]);
assert.strictEqual(LLCAI.normalizeDiff("easy"), "easy");
assert.strictEqual(LLCAI.normalizeDiff("hard"), "hard");
assert.strictEqual(LLCAI.normalizeDiff("normal"), "normal");
assert.strictEqual(LLCAI.normalizeDiff("nope"), "normal");
assert.strictEqual(LLCAI.normalizeDiff(undefined), "normal");
assert.strictEqual(LLCAI.normalizeDiff({ diff: "hard" }), "hard");
assert.strictEqual(LLCAI.cfgOf("easy").summons, 1);
assert.strictEqual(LLCAI.cfgOf("normal").summons, 2);
assert.strictEqual(LLCAI.cfgOf("hard").summons, 2);

assert.strictEqual(LLCAI.inkReward(true, "bot", "easy"), 60);
assert.strictEqual(LLCAI.inkReward(true, "bot", "normal"), 100);
assert.strictEqual(LLCAI.inkReward(true, "bot", "hard"), 150);
assert.strictEqual(LLCAI.inkReward(false, "bot", "hard"), 25);
assert.strictEqual(LLCAI.inkReward(false, "bot", "easy"), 25);
assert.strictEqual(LLCAI.inkReward(true, "online", "easy"), 150);
assert.strictEqual(LLCAI.inkReward(false, "online", "hard"), 25);
assert.strictEqual(LLCAI.LOSS_INK, 25);

S.reset();
assert.strictEqual(S.botDiff(), "normal", "default difficulty is normal");
assert.strictEqual(S.setBotDiff("hard"), "hard");
assert.strictEqual(S.botDiff(), "hard");
assert.strictEqual(S.setBotDiff("easy"), "easy");
assert.strictEqual(S.botDiff(), "easy");
assert.strictEqual(S.setBotDiff("nope"), "normal");
assert.strictEqual(S.botDiff(), "normal");

function rarityScore(diff, seed) {
  const d = E.botDeck(seed, diff);
  const pts = { C: 1, R: 3, SR: 6, SCR: 10 };
  return d.cards.reduce((t, c) => t + (pts[LLCData.BY_ID[c.id].rarity] || 0), 0);
}
let easy = 0, mid = 0, hard = 0;
for (let i = 0; i < 80; i++) {
  easy += rarityScore("easy", i + 1);
  mid += rarityScore("normal", i + 100);
  hard += rarityScore("hard", i + 200);
}
assert.ok(hard > mid && mid > easy, "hard decks should be rarer than normal, normal rarer than easy (" + [easy, mid, hard].join(" / ") + ")");
assert.strictEqual(E.botDeck(7, "easy").cards.length, 20);
assert.strictEqual(E.botDeck(7, "hard").cards.length, 20);

// Hard AI takes a lethal direct attack
{
  const deck = Array.from({ length: 20 }, () => ({ id: "pencil_warrior" }));
  const { state: s } = E.create({ seed: 1, decks: [deck, deck], first: 0 });
  s.active = 0; s.phase = "battle"; s.pending = null; s.turn = 3;
  s.players[1].lp = 200;
  const uid = s.players[0].hand.find((u) => LLCData.BY_ID[s.cards[u].id].kind === "monster");
  const pl = s.players[0];
  pl.hand.splice(pl.hand.indexOf(uid), 1);
  pl.mz[0] = { uid, pos: "atk", faceUp: true, mod: 0, dmod: 0, tmp: 0, summonedTurn: 1, attacked: 0, posChanged: false, lordUsed: false, kills: 0 };
  const V = E.view(s, 0);
  const a = LLCAI.decide(V, { diff: "hard" });
  assert.strictEqual(a.a, "attack");
  assert.strictEqual(a.slot, 0);
  assert.strictEqual(a.target, null, "hard bot should go for lethal direct");
}


// Hard (and Normal) fire MECH LINK when the materials and Hangar are ready
{
  const ids = Array.from({ length: 20 }, (_, i) => ({ id: i < 8 ? "mech_link" : "drone_bit" }));
  // copy caps will fail validDeck but create() does not check caps; keep 3 mech_link + fillers
  const deck = ["mech_link", "mech_link", "mech_link", "ace_pilot", "tread_frame", "drone_bit", "pulse_knight", "flash_jet",
    "repair_drone", "wing_frame", "scope_drone", "shield_bug", "clicker_bot", "hex_plate", "signal_pilot",
    "blade_dancer", "charge", "beam_saber", "nebula_dock", "static_shock"].map((id) => ({ id }));
  const hangar = [{ id: "storm_wing" }];
  const { state: s } = E.create({ seed: 1, first: 0, decks: [deck, deck], hangars: [hangar, []] });
  s.active = 0; s.phase = "main"; s.pending = null; s.turn = 3;
  const pl = s.players[0];
  pl.fused = false; pl.summons = 0;
  // put a DOODLE and a MACHINE on the field as leftover monsters (no summon cost)
  function place(id, slot) {
    let uid = pl.hand.find((u) => s.cards[u].id === id);
    if (!uid) { uid = s.nextUid++; s.cards[uid] = { uid, id, foil: false, owner: 0 }; }
    else pl.hand.splice(pl.hand.indexOf(uid), 1);
    pl.mz[slot] = { uid, pos: "atk", faceUp: true, mod: 0, dmod: 0, tmp: 0, summonedTurn: 1, attacked: 0, posChanged: false, lordUsed: false, kills: 0 };
  }
  place("ace_pilot", 0);
  place("drone_bit", 1);
  const V = E.view(s, 0);
  assert.ok((V.fusions || []).some((f) => f.id === "storm_wing"), "storm wing should be a legal fusion");
  const a = LLCAI.decide(V, { diff: "hard" });
  assert.strictEqual(a.a, "activate", "hard bot should cast MECH LINK, got " + JSON.stringify(a));
  assert.strictEqual(a.fusion, "storm_wing");
  E.apply(s, 0, a);
  assert.ok(pl.mz.some((m) => m && s.cards[m.uid].id === "storm_wing"), "fusion should hit the field");
  assert.strictEqual(pl.summons, 0, "MECH LINK must not use a normal summon");
  assert.strictEqual(pl.fused, true);
}

console.log("difficulty: all checks passed");

