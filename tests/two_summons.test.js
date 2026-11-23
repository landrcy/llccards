// TWO normal summons per turn (attack, defense/set and tribute summons all share the cap).
// Special summons (e.g. SECOND DRAFT) do not count. The cap is LLCEngine.NORMAL_SUMMONS_PER_TURN.
// Run: node tests/two_summons.test.js
global.window = global; global.location = { search: "" };
require("../js/data.js"); require("../js/data_ed2.js"); require("../js/engine.js"); require("../js/ai.js");
const E = LLCEngine, assert = require("assert");
assert.strictEqual(E.NORMAL_SUMMONS_PER_TURN, 2, "the cap must be a single exported constant of 2");

const deck = Array.from({ length: 20 }, (_, i) => ({ id: ["pencil_warrior", "gear_golem", "squiggle_worm", "doodle_prince", "crayon_kid"][i % 5] }));
function fresh() {
  const { state: s } = E.create({ seed: 5, decks: [deck, deck] });
  s.active = 0; s.phase = "main"; s.pending = null; s.turn = 3;
  return s;
}
const mons = (s, p) => s.players[p].hand.filter((u) => s.cards[u].id !== "doodle_prince");
function flush(s) {
  if (!s.pending) return;
  const p = s.pending.player;
  if (s.pending.type === "discard") E.apply(s, p, { a: "discard", uid: s.players[p].hand[0] });
  else E.apply(s, p, { a: "respond", slot: null });
}
function give(s, p, id) {
  const uid = s.nextUid++;
  s.cards[uid] = { uid, id, foil: false, owner: p };
  s.players[p].hand.push(uid);
  return uid;
}
let n = 0;

{ // 0 summons: legal offers summon/set
  const s = fresh();
  const [u1] = mons(s, 0);
  const opts = E.legal(s, 0).hand[u1];
  assert.ok(opts.includes("summon") && opts.includes("set"), "first summon must be legal");
  assert.strictEqual(s.players[0].summons, 0);
  n++;
}

{ // 1 summon: a second is still legal, and the message says 1 more remains
  const s = fresh();
  const [u1, u2] = mons(s, 0);
  E.apply(s, 0, { a: "summon", uid: u1 });
  assert.strictEqual(s.players[0].summons, 1);
  assert.ok(s.log.some((t) => /1 more monster/.test(t)), "log should say 1 more monster this turn");
  const opts = E.legal(s, 0).hand[u2];
  assert.ok(opts.includes("summon") && opts.includes("set"), "second summon must still be offered");
  E.apply(s, 0, { a: "summon", uid: u2 });
  assert.strictEqual(s.players[0].summons, 2);
  n++;
}

for (const [a1, a2, a3] of [
  ["summon", "summon", "summon"],
  ["summon", "set", "summon"],
  ["set", "summon", "set"],
  ["set", "set", "summon"],
  ["defense", "summon", "defense"],
  ["summon", "defense", "summon"],
]) {
  const s = fresh();
  const [u1, u2, u3] = mons(s, 0);
  E.apply(s, 0, { a: a1, uid: u1 });
  E.apply(s, 0, { a: a2, uid: u2 });
  assert.throws(() => E.apply(s, 0, { a: a3, uid: u3 }), /No normal summons left this turn/, a1 + " + " + a2 + " then " + a3 + " must be refused");
  assert.deepStrictEqual(E.legal(s, 0).hand[u3], [], "no summon/set offered after two " + a1 + "/" + a2);
  assert.ok(s.log.some((t) => /No normal summons left this turn/.test(t)));
  n++;
}

{ // tribute summon counts toward the cap: normal then tribute uses both; a third is refused
  const s = fresh();
  const [u1] = mons(s, 0);
  E.apply(s, 0, { a: "summon", uid: u1 });
  const hydra = give(s, 0, "notebook_hydra");
  E.apply(s, 0, { a: "summon", uid: hydra, tributes: [0] });
  assert.strictEqual(s.players[0].summons, 2);
  const extra = mons(s, 0).find((u) => s.players[0].hand.includes(u));
  if (extra) {
    assert.throws(() => E.apply(s, 0, { a: "summon", uid: extra }), /No normal summons left this turn/);
    assert.deepStrictEqual(E.legal(s, 0).hand[extra], []);
  }
  n++;
}

{ // tribute first, then a free normal summon, then a third is refused
  const s = fresh();
  const fodder = mons(s, 0)[0];
  const pl = s.players[0];
  pl.hand.splice(pl.hand.indexOf(fodder), 1);
  pl.mz[0] = { uid: fodder, pos: "atk", faceUp: true, mod: 0, dmod: 0, tmp: 0, summonedTurn: 1, attacked: 0, posChanged: false, lordUsed: false, kills: 0 };
  const hydra = give(s, 0, "notebook_hydra");
  E.apply(s, 0, { a: "summon", uid: hydra, tributes: [0] });
  assert.strictEqual(pl.summons, 1);
  const next = mons(s, 0).find((u) => pl.hand.includes(u));
  E.apply(s, 0, { a: "summon", uid: next });
  assert.strictEqual(pl.summons, 2);
  const third = mons(s, 0).find((u) => pl.hand.includes(u));
  if (third) {
    // free a slot so the refusal is about the cap, not room
    const slot = pl.mz.findIndex(Boolean);
    pl.grave.push(pl.mz[slot].uid);
    pl.mz[slot] = null;
    assert.throws(() => E.apply(s, 0, { a: "summon", uid: third }), /No normal summons left this turn/);
  }
  n++;
}

{ // SECOND DRAFT is a special summon and does not consume the cap
  const s = fresh();
  const pl = s.players[0];
  const eaten = mons(s, 0)[0];
  pl.hand.splice(pl.hand.indexOf(eaten), 1);
  pl.grave.push(eaten);
  const draftUid = s.nextUid++;
  s.cards[draftUid] = { uid: draftUid, id: "second_draft", foil: false, owner: 0 };
  pl.hand.push(draftUid);
  const ev = E.apply(s, 0, { a: "activate", uid: draftUid });
  flush(s);
  assert.strictEqual(pl.summons, 0, "special summon must not increment the normal-summon count");
  assert.ok(pl.mz.some(Boolean), "revive should hit the field");
  const left = mons(s, 0).filter((u) => pl.hand.includes(u));
  E.apply(s, 0, { a: "summon", uid: left[0] });
  E.apply(s, 0, { a: "summon", uid: left[1] });
  assert.strictEqual(pl.summons, 2);
  // board is full after the revive + two summons; free a slot so the cap is what blocks the third
  const slot = pl.mz.findIndex(Boolean);
  pl.grave.push(pl.mz[slot].uid);
  pl.mz[slot] = null;
  const u3 = left[2] || give(s, 0, "pencil_warrior");
  assert.throws(() => E.apply(s, 0, { a: "summon", uid: u3 }), /No normal summons left this turn/);
  n++;
}

{ // the count resets on your next turn, not on the opponent's
  const s = fresh();
  const [u1, u2, u3] = mons(s, 0);
  E.apply(s, 0, { a: "summon", uid: u1 });
  E.apply(s, 0, { a: "summon", uid: u2 });
  E.apply(s, 0, { a: "endturn" });
  flush(s);
  assert.strictEqual(s.players[0].summons, 2, "opponent's turn must not reset my summons");
  E.apply(s, 1, { a: "endturn" });
  flush(s);
  assert.strictEqual(s.players[0].summons, 0, "my next turn must reset the count");
  E.apply(s, 0, { a: "summon", uid: u3 });
  assert.strictEqual(s.players[0].summons, 1);
  n++;
}

{ // 200 bot-vs-bot games at Normal: never 3+ normal summons, and at least some double summons
  let bad = 0, doubles = 0;
  for (let g = 0; g < 200; g++) {
    const { state: s } = E.create({ seed: g + 1, decks: [E.botDeck(g * 2 + 11, "normal").cards, E.botDeck(g * 2 + 12, "normal").cards] });
    const cnt = {};
    for (let k = 0; s.winner == null && k < 4000; k++) {
      const p = s.pending ? s.pending.player : s.active;
      let ev; try { ev = E.apply(s, p, LLCAI.decide(E.view(s, p), { diff: "normal" })); } catch (e) { break; }
      ev.forEach((e) => {
        if (e.e === "summon" && !e.revive && !e.fusion && !e.special) {
          const key = s.turn + ":" + e.p;
          cnt[key] = (cnt[key] || 0) + 1;
          if (cnt[key] === 2) doubles++;
          if (cnt[key] > 2) bad++;
        }
      });
    }
  }
  assert.strictEqual(bad, 0, "bot normal-summoned more than twice in a turn");
  assert.ok(doubles > 0, "normal bot should actually use a second summon sometimes (got " + doubles + ")");
  n++;
}

{ // Easy bot: about 1 summon — should almost never take a second
  let doubles = 0, bad = 0;
  for (let g = 0; g < 120; g++) {
    const { state: s } = E.create({ seed: g + 400, decks: [E.botDeck(g * 2 + 31, "easy").cards, E.botDeck(g * 2 + 32, "easy").cards] });
    const cnt = {};
    for (let k = 0; s.winner == null && k < 4000; k++) {
      const p = s.pending ? s.pending.player : s.active;
      let ev; try { ev = E.apply(s, p, LLCAI.decide(E.view(s, p), { diff: "easy" })); } catch (e) { break; }
      ev.forEach((e) => {
        if (e.e === "summon" && !e.revive && !e.fusion && !e.special) {
          const key = s.turn + ":" + e.p;
          cnt[key] = (cnt[key] || 0) + 1;
          if (cnt[key] === 2) doubles++;
          if (cnt[key] > 2) bad++;
        }
      });
    }
  }
  assert.strictEqual(bad, 0);
  assert.strictEqual(doubles, 0, "easy bot should cap at about 1 normal summon (got " + doubles + " doubles)");
  n++;
}

console.log("two_summons: " + n + " checks passed");
