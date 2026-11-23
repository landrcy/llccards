// Official starter templates: legal lists, loaner vs-bot, ownership still required online.
// Run: node tests/templates.test.js
const mem = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};
global.window = global;
global.location = { search: "" };
require("../js/data.js");
require("../js/data_ed2.js");
require("../js/engine.js");
require("../js/ai.js");
require("../js/storage.js");
const E = LLCEngine, D = LLCData, S = LLCStorage, assert = require("assert");

function tmpl(id) {
  const t = (D.TEMPLATES || []).find((x) => x.id === id);
  assert.ok(t, "missing template " + id);
  return t;
}
function ownAll(set) {
  const coll = { edition_one: {}, edition_two: {}, ink: 300, v: 2, decks: [], activeDeck: -1 };
  D.CARDS.forEach((c) => {
    const s = c.set || "edition_one";
    if (set && s !== set) return;
    coll[s][c.id] = { owned: true, foil: false, n: 3 };
  });
  return coll;
}
function emptyColl() {
  return { edition_one: {}, edition_two: {}, ink: 300, v: 2, decks: [], activeDeck: -1 };
}
function assertLegal(t) {
  assert.strictEqual(t.cards.length, 20, t.id + " must be 20 cards");
  assert.ok((t.hangar || []).length <= 2, t.id + " hangar overflow");
  assert.deepStrictEqual(E.deckRuleProblems(t.cards, t.hangar || []), [], t.id + " rule problems");
  const counts = {};
  t.cards.forEach((id) => {
    const c = D.BY_ID[id];
    assert.ok(c, t.id + " unknown " + id);
    assert.ok(!E.isFusion(c), t.id + " fusion in main: " + id);
    if (t.set) assert.strictEqual(c.set || "edition_one", t.set, t.id + " off-set " + id);
    counts[id] = (counts[id] || 0) + 1;
    assert.ok(counts[id] <= E.copyCap(c), t.id + " copy cap " + id);
  });
  (t.hangar || []).forEach((id) => {
    const c = D.BY_ID[id];
    assert.ok(c && E.isFusion(c), t.id + " hangar must be a fusion: " + id);
  });
  assert.ok(t.cards.some((id) => D.BY_ID[id].kind === "monster"), t.id + " needs a monster");
  assert.ok(t.name.length <= 18, t.id + " name too long for the slot: " + t.name);
}

assert.ok(D.TEMPLATES.length >= 2, "both edition templates should exist");
const ed2 = tmpl("ed2-starter");
const ed1 = tmpl("ed1-starter");
assertLegal(ed2);
assertLegal(ed1);
assert.strictEqual(ed2.name, "MECH LINK STARTER");
assert.deepStrictEqual(ed2.hangar.slice().sort(), ["phantom_blade", "storm_wing"]);
assert.strictEqual(ed2.cards.filter((id) => id === "mech_link").length, 3);
assert.ok(ed2.cards.filter((id) => id === "ace_pilot").length >= 2);
assert.ok(ed2.cards.includes("blade_dancer"), "Phantom Blade needs Blade Dancer");
assert.ok(ed2.cards.includes("signal_pilot") || ed2.cards.includes("ace_pilot"), "needs a DOODLE for Storm Wing");
const rares = ed2.cards.filter((id) => D.BY_ID[id].rarity === "SR" || D.BY_ID[id].rarity === "SCR");
assert.strictEqual(rares.length, 0, "main deck should be commons/rares, not SR/SCR");

assert.ok(E.matchTemplate(ed2.cards.slice().reverse(), ed2.hangar.slice().reverse()), "match ignores order");
assert.strictEqual(E.matchTemplate(ed2.cards, ed2.hangar).id, "ed2-starter");
assert.strictEqual(E.matchTemplate(ed2.cards.slice(1).concat(["jammer"]), ed2.hangar), null);

// Ownership: empty collection is structurally legal but not fully valid
const empty = emptyColl();
assert.deepStrictEqual(E.deckRuleProblems(ed2.cards, ed2.hangar), []);
assert.ok(E.deckOwnedProblems(ed2.cards, empty, ed2.hangar).length > 0);
assert.ok(E.deckProblems(ed2.cards, empty, ed2.hangar).length > 0);
const miss = E.missingCopies(ed2.cards, empty, ed2.hangar);
assert.ok(miss.reduce((n, m) => n + m.missing, 0) >= 20, "empty binder should be missing the whole 20 plus hangar");

// Fully owned: valid
const all = ownAll();
assert.deepStrictEqual(E.deckProblems(ed2.cards, all, ed2.hangar), []);
assert.deepStrictEqual(E.deckProblems(ed1.cards, all, ed1.hangar), []);

// activeDeck: no loaner on an unowned template -> auto deck
empty.decks = [{ name: ed2.name, cards: ed2.cards.slice(), hangar: ed2.hangar.slice(), template: ed2.id }];
empty.activeDeck = 0;
const auto = E.activeDeck(empty);
assert.strictEqual(auto.custom, false, "online / default must not loan unowned templates");

// vs bot loaner
const loan = E.activeDeck(empty, { allowLoaner: true });
assert.strictEqual(loan.custom, true);
assert.strictEqual(loan.loaner, true);
assert.strictEqual(loan.name, "MECH LINK STARTER");
assert.strictEqual(loan.cards.length, 20);
assert.strictEqual(loan.hangar.length, 2);
assert.ok(loan.cards.every((c) => ed2.cards.includes(c.id)));
assert.ok(loan.missing && loan.missing.length > 0);

// owned custom is not a loaner
all.decks = [{ name: ed2.name, cards: ed2.cards.slice(), hangar: ed2.hangar.slice(), template: ed2.id }];
all.activeDeck = 0;
const owned = E.activeDeck(all, { allowLoaner: true });
assert.strictEqual(owned.custom, true);
assert.strictEqual(!!owned.loaner, false);

// storage persists template id
S.reset();
S.saveDeck(0, { name: ed2.name, cards: ed2.cards.slice(), hangar: ed2.hangar.slice(), template: ed2.id });
S.setActiveDeck(0);
const saved = S.decks().list[0];
assert.strictEqual(saved.template, "ed2-starter");
assert.strictEqual(saved.cards.length, 20);
assert.deepStrictEqual(saved.hangar, ed2.hangar);

// A vs-bot game with the loaner template against an Edition One auto-deck must finish
{
  const e1 = E.deckFromCollection({ edition_one: {}, edition_two: {} }, { set: "edition_one" });
  const { state: s } = E.create({
    seed: 42,
    decks: [loan.cards, e1.cards],
    hangars: [loan.hangar, e1.hangar || []],
    names: ["YOU", "BOT"],
  });
  for (let k = 0; s.winner == null && k < 4000; k++) {
    const p = s.pending ? s.pending.player : s.active;
    try { E.apply(s, p, LLCAI.decide(E.view(s, p), { diff: "normal" })); }
    catch (e) { break; }
  }
  assert.ok(s.winner === 0 || s.winner === 1, "loaner template vs Ed1 auto-deck should finish a game (winner=" + s.winner + ")");
}

console.log("templates: ok (" + D.TEMPLATES.map((t) => t.id).join(", ") + ")");
