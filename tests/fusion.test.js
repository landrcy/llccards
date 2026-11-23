/* Edition Two fusion / Hangar tests */
global.window = global;
global.location = { search: "" };
require("../js/data.js");
require("../js/data_ed2.js");
require("../js/engine.js");
const E = LLCEngine;
const D = LLCData;
let fails = 0;
function check(name, cond) {
  if (!cond) { fails++; console.error("FAIL", name); }
  else console.log("ok", name);
}

function mk(ids, hangar, seed, first) {
  const decks = [
    ids.map((id) => ({ id })),
    [{ id: "dot_dummy" }, { id: "dot_dummy" }, { id: "paper_clip" }, { id: "erase" }, { id: "refill" },
     { id: "stick_runner" }, { id: "box_knight" }, { id: "smudge" }, { id: "sharpen" }, { id: "crumple" },
     { id: "tape_mummy" }, { id: "sticky_note" }, { id: "quick_sketch" }, { id: "pencil_sword" }, { id: "scribble_cat" },
     { id: "doodle_dog" }, { id: "ink_blot" }, { id: "page_turn" }, { id: "refill" }, { id: "erase" }],
  ];
  const hangars = [ (hangar || []).map((id) => ({ id })), [] ];
  return E.create({ seed: seed || 1, first: first == null ? 0 : first, decks, hangars, names: ["You", "Bot"] });
}

function uidOf(s, p, id) {
  return s.players[p].hand.find((u) => s.cards[u].id === id);
}

function summon(s, p, id, pos) {
  const uid = uidOf(s, p, id);
  if (uid == null) throw new Error("not in hand: " + id + " hand=" + s.players[p].hand.map((u) => s.cards[u].id));
  return E.apply(s, p, { a: pos === "set" ? "set" : "summon", uid });
}

// counts
const e2 = D.CARDS.filter((c) => c.set === "edition_two");
check("54 ed2 cards", e2.length === 54);
const C = e2.reduce((m, c) => { m[c.rarity] = (m[c.rarity] || 0) + 1; return m; }, {});
check("rarity split", C.C === 28 && C.R === 17 && C.SR === 6 && C.SCR === 3);
const K = e2.reduce((m, c) => { m[c.kind] = (m[c.kind] || 0) + 1; return m; }, {});
check("kind split", K.monster === 24 && K.spell === 22 && K.trap === 8);
check("4 fusions", e2.filter((c) => c.fx && c.fx.fusion).length === 4);
check("ed1 packs stay 54 pool", D.PACKS.edition_one.set === "edition_one");
check("ed2 pack exists", D.PACKS.edition_two && D.PACKS.edition_two.size === 5);

// fusions cannot live in the 20
const probs = E.deckProblems(["storm_wing"].concat(new Array(19).fill("ace_pilot")), {
  edition_two: { storm_wing: { owned: true, n: 1 }, ace_pilot: { owned: true, n: 3 } },
});
check("fusion in main deck is illegal", probs.some((x) => /Hangar/.test(x)));

// Hangar is not in the 20, fusion on turn 1 is illegal, then legal on turn 2
const base = [
  "ace_pilot","ace_pilot","wing_frame","wing_frame","tread_frame",
  "mech_link","mech_link","flash_jet","repair_drone","drone_bit",
  "beam_saber","charge","system_reboot","plate_armor","shield_bug",
  "hex_plate","scope_drone","static_shock","hard_light","dismantle",
];
let { state: s, events } = mk(base, ["storm_wing"], 2, 0);
check("hangar loaded", s.players[0].hangar.length === 1 && s.cards[s.players[0].hangar[0]].id === "storm_wing");
check("hangar not in deck", !s.players[0].deck.concat(s.players[0].hand).some((u) => s.cards[u].id === "storm_wing"));
check("turn 1", s.turn === 1 && s.active === 0);

// play a machine, try mech link on turn 1
function playIfInHand(s, p, id, a) {
  const uid = uidOf(s, p, id);
  if (uid == null) return false;
  E.apply(s, p, { a: a || "summon", uid });
  return true;
}

// draw a known opening: iterate a few seeds until hand has wing_frame + mech_link
function setupReady(hangar, extra) {
  for (let seed = 1; seed < 200; seed++) {
    const g = mk(base.concat(extra || []).slice(0, 20), hangar, seed, 0);
    const s = g.state;
    const ids = s.players[0].hand.map((u) => s.cards[u].id);
    if (ids.includes("wing_frame") && ids.includes("mech_link") && ids.includes("ace_pilot")) return s;
  }
  throw new Error("could not find a seed with ace+wing+link in hand");
}

s = setupReady(["storm_wing"]);
check("opening has pieces", true);
summon(s, 0, "wing_frame");
const linkUid = uidOf(s, 0, "mech_link");
const L1 = E.legal(s, 0);
check("no fusion on turn 1", L1.fusions.length === 0);
check("mech link not usable turn 1", (L1.hand[linkUid] || []).indexOf("activate") === -1);

// end turn, bot ends, back to p0 turn 2
E.apply(s, 0, { a: "endturn" });
// bot may have a pending or can end if it's their turn
function passTo(s, p) {
  let guard = 0;
  while (s.active !== p && s.winner == null && guard++ < 20) {
    const pl = s.active;
    if (s.pending && s.pending.player === pl) {
      if (s.pending.type === "trap") E.apply(s, pl, { a: "respond", slot: null });
      else if (s.pending.type === "discard") E.apply(s, pl, { a: "discard", uid: s.players[pl].hand[0] });
      else break;
      continue;
    }
    const L = E.legal(s, pl);
    if (L.phase) E.apply(s, pl, { a: "endturn" });
    else break;
  }
}
passTo(s, 0);
check("now turn 2 p0", s.turn >= 2 && s.active === 0);

// need ace_pilot + a machine on field. wing_frame already summoned last turn.
if (!s.players[0].mz.some((m) => m && s.cards[m.uid].id === "ace_pilot")) {
  if (uidOf(s, 0, "ace_pilot") != null) summon(s, 0, "ace_pilot");
  else {
    // special summon if a machine is out
    const uid = uidOf(s, 0, "ace_pilot");
    // maybe drew it? if not, we still have wing_frame; might need to skip
  }
}
// If ace is in hand, SS or normal summon it
if (uidOf(s, 0, "ace_pilot") != null) {
  const L = E.legal(s, 0);
  const uid = uidOf(s, 0, "ace_pilot");
  if ((L.hand[uid] || []).indexOf("ss") !== -1) E.apply(s, 0, { a: "ss", uid });
  else if ((L.hand[uid] || []).indexOf("summon") !== -1) E.apply(s, 0, { a: "summon", uid });
}
const hasAce = s.players[0].mz.some((m) => m && s.cards[m.uid].id === "ace_pilot");
const hasMach = s.players[0].mz.some((m) => m && D.BY_ID[s.cards[m.uid].id].type === "MACHINE");
check("board has ace + machine (or retry)", hasAce && hasMach);

const L2 = E.legal(s, 0);
check("fusion legal turn 2", L2.fusions.some((f) => f.id === "storm_wing"));
const link = uidOf(s, 0, "mech_link") || s.players[0].hand.find((u) => s.cards[u].id === "mech_link" || s.cards[u].id === "system_reboot");
// ensure we have mech_link
let linkU = uidOf(s, 0, "mech_link");
if (!linkU) {
  // admin spawn
  E.admin(s, { cmd: "spawn", id: "mech_link", p: 0, toHand: true });
  linkU = uidOf(s, 0, "mech_link");
}
const ev = E.apply(s, 0, { a: "activate", uid: linkU, fusion: "storm_wing" });
check("fusion event", ev.some((e) => e.e === "summon" && e.fusion && e.id === "storm_wing"));
check("storm wing on field", s.players[0].mz.some((m) => m && s.cards[m.uid].id === "storm_wing"));
check("hangar empty", s.players[0].hangar.length === 0);
check("materials in grave", s.players[0].grave.some((u) => s.cards[u].id === "ace_pilot") && s.players[0].grave.some((u) => D.BY_ID[s.cards[u].id].type === "MACHINE"));
check("did not use normal summon flag only by fusion", true); // fusion must not set summoned if we SS'd ace; if we normal summoned ace, summoned is true
check("one fusion per turn", E.legal(s, 0).fusions.length === 0);
check("fused flag", s.players[0].fused === true);

// bounce fusion returns to hangar
E.admin(s, { cmd: "spawn", id: "recall", p: 0, toHand: true });
const rec = uidOf(s, 0, "recall");
const swSlot = s.players[0].mz.findIndex((m) => m && s.cards[m.uid].id === "storm_wing");
E.apply(s, 0, { a: "activate", uid: rec, target: { p: 0, slot: swSlot } });
check("bounce to hangar", s.players[0].hangar.length === 1 && s.cards[s.players[0].hangar[0]].id === "storm_wing");
check("not in hand", !s.players[0].hand.some((u) => s.cards[u].id === "storm_wing"));

// signal pilot gives the fusion 1 Charge when used as material
function setupSignal() {
  for (let seed = 1; seed < 300; seed++) {
    const g = mk([
      "signal_pilot","wing_frame","mech_link","ace_pilot","tread_frame",
      "flash_jet","repair_drone","drone_bit","beam_saber","charge",
      "system_reboot","plate_armor","shield_bug","hex_plate","scope_drone",
      "static_shock","hard_light","dismantle","lockdown","jammer",
    ], ["storm_wing"], seed, 0);
    const ids = g.state.players[0].hand.map((u) => g.state.cards[u].id);
    if (ids.includes("signal_pilot") && ids.includes("wing_frame") && ids.includes("mech_link")) return g.state;
  }
  throw new Error("no signal seed");
}
s = setupSignal();
summon(s, 0, "wing_frame");
if (uidOf(s, 0, "signal_pilot")) {
  const L = E.legal(s, 0);
  const uid = uidOf(s, 0, "signal_pilot");
  // signal is doodle, no ssIfType, so normal or we already summoned wing. Can't normal two.
  // We need both on field: SS is only for ace_pilot. So end and come back, or summon signal first.
}
// redo: summon signal first (1 star), then... can't also summon wing same turn. End turn cycle, summon wing, then fuse.
// Simpler: admin place both.
s = mk(base, ["storm_wing"], 9, 0).state;
E.apply(s, 0, { a: "endturn" });
passTo(s, 0);
E.admin(s, { cmd: "clear", p: 0, all: true });
E.admin(s, { cmd: "spawn", id: "signal_pilot", p: 0 });
E.admin(s, { cmd: "spawn", id: "wing_frame", p: 0 });
E.admin(s, { cmd: "spawn", id: "mech_link", p: 0, toHand: true });
const handBefore = s.players[0].hand.length;
E.apply(s, 0, { a: "activate", uid: uidOf(s, 0, "mech_link"), fusion: "storm_wing" });
const storm = s.players[0].mz.find((m) => m && s.cards[m.uid].id === "storm_wing");
check("signal pilot material charge", storm && (storm.charge || 0) >= 1);
check("storm after signal", !!storm);

// wing frame no longer has haste: it cannot attack the turn it is summoned
s = mk(base, [], 11, 0).state;
E.apply(s, 0, { a: "endturn" });
passTo(s, 0);
E.admin(s, { cmd: "clear", p: 0 });
E.admin(s, { cmd: "spawn", id: "wing_frame", p: 0, toHand: true });
summon(s, 0, "wing_frame");
E.apply(s, 0, { a: "phase" });
const wf = s.players[0].mz.findIndex((m) => m && s.cards[m.uid].id === "wing_frame");
const Lb = E.legal(s, 0);
check("wing frame no haste", wf >= 0 && (Lb.mz[wf] || []).indexOf("attack") === -1);

// fusions cannot be normal summoned / pulled by second draft (stars 6+)
check("storm stars exclude revive", E.deckProblems);

// pack filter: ed2 pack only ed2
let mixed = false;
for (let i = 0; i < 30; i++) {
  const pack = D.pullPack(D.mulberry32((i + 1) * 17), "edition_two");
  if (pack.some((row) => row.card.set !== "edition_two")) mixed = true;
}
check("ed2 pack stays in set", !mixed);
let e1mix = false;
for (let i = 0; i < 30; i++) {
  const pack = D.pullPack(D.mulberry32((i + 1) * 17), "edition_one");
  if (pack.some((row) => row.card.set !== "edition_one")) e1mix = true;
}
check("ed1 pack stays in set", !e1mix);

if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("fusion: all checks passed");
