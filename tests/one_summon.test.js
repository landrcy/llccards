// Regression: ONE normal summon per turn (attack, defense/set and tribute summons all share it).
// Run: node tests/one_summon.test.js
global.window = global; global.location = { search: "" };
require("../js/data.js"); require("../js/engine.js"); require("../js/ai.js");
const E = LLCEngine, assert = require("assert");
const deck = Array.from({ length: 20 }, (_, i) => ({ id: ["pencil_warrior", "gear_golem", "squiggle_worm", "doodle_prince", "crayon_kid"][i % 5] }));
function fresh() {
  const { state: s } = E.create({ seed: 5, decks: [deck, deck] });
  s.active = 0; s.phase = "main"; s.pending = null; s.turn = 3;
  return s;
}
const mons = (s, p) => s.players[p].hand.filter((u) => s.cards[u].id !== "doodle_prince");
let n = 0;
for (const [a1, a2] of [["summon", "summon"], ["summon", "set"], ["set", "summon"], ["set", "set"], ["defense", "summon"], ["summon", "defense"]]) {
  const s = fresh();
  const [u1, u2] = mons(s, 0);
  E.apply(s, 0, { a: a1, uid: u1 });
  assert.throws(() => E.apply(s, 0, { a: a2, uid: u2 }), /Already summoned/, a1 + " then " + a2 + " must be refused");
  assert.deepStrictEqual(E.legal(s, 0).hand[u2], [], "no summon/set offered after " + a1);
  n++;
}
{ // tribute summon counts too, and a tribute summon after a normal summon is refused
  const s = fresh();
  s.players[0].hand.push(s.players[0].hand.find((u) => s.cards[u].id === "doodle_prince") || s.players[0].hand[0]);
  const [u1] = mons(s, 0);
  E.apply(s, 0, { a: "summon", uid: u1 });
  const prince = s.players[0].hand.find((u) => s.cards[u].id === "doodle_prince");
  if (prince) assert.throws(() => E.apply(s, 0, { a: "summon", uid: prince, tributes: [0] }), /Already summoned/);
  n++;
}
{ // the flag resets on your next turn, not on the opponent's
  const s = fresh();
  const [u1, u2] = mons(s, 0);
  E.apply(s, 0, { a: "summon", uid: u1 });
  E.apply(s, 0, { a: "endturn" });
  if (s.pending) E.apply(s, s.pending.player, s.pending.type === "discard" ? { a: "discard", uid: s.players[s.pending.player].hand[0] } : { a: "respond", slot: null });
  assert.strictEqual(s.players[0].summoned, true, "opponent's turn must not reset my summon");
  E.apply(s, 1, { a: "endturn" });
  if (s.pending) E.apply(s, s.pending.player, s.pending.type === "discard" ? { a: "discard", uid: s.players[s.pending.player].hand[0] } : { a: "respond", slot: null });
  assert.strictEqual(s.players[0].summoned, false);
  E.apply(s, 0, { a: "summon", uid: u2 });
  n++;
}
{ // 1000 bot-vs-bot games: never 2 normal summons by one player in one turn (SECOND DRAFT's revive is a special summon)
  let bad = 0;
  for (let g = 0; g < 1000; g++) {
    const { state: s } = E.create({ seed: g + 1, decks: [E.botDeck(g * 2 + 11).cards, E.botDeck(g * 2 + 12).cards] });
    const cnt = {};
    for (let k = 0; s.winner == null && k < 4000; k++) {
      const p = s.pending ? s.pending.player : s.active;
      let ev; try { ev = E.apply(s, p, LLCAI.decide(E.view(s, p))); } catch (e) { break; }
      ev.forEach((e) => { if (e.e === "summon" && !e.revive) { const key = s.turn + ":" + e.p; cnt[key] = (cnt[key] || 0) + 1; if (cnt[key] > 1) bad++; } });
    }
  }
  assert.strictEqual(bad, 0, "bot summoned twice in a turn");
  n++;
}
console.log("one_summon: " + n + " checks passed");
