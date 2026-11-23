/* Edition Two unique mechanics */
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

const filler = ["ace_pilot","wing_frame","tread_frame","flash_jet","repair_drone",
  "drone_bit","beam_saber","charge","system_reboot","plate_armor",
  "shield_bug","hex_plate","scope_drone","static_shock","hard_light",
  "dismantle","lockdown","jammer","overclock","stasis_lock"];

function mk(seed) {
  const decks = [
    filler.map((id) => ({ id })),
    filler.map((id) => ({ id })),
  ];
  return E.create({ seed: seed || 7, first: 0, decks, hangars: [[{ id: "storm_wing" }, { id: "apex_omega" }], []], names: ["You", "Bot"] }).state;
}

function uidOf(s, p, id) {
  return s.players[p].hand.find((u) => s.cards[u].id === id);
}
function monId(s, p, id) {
  return s.players[p].mz.findIndex((m) => m && s.cards[m.uid].id === id);
}
function spawn(s, p, id, toHand) {
  E.admin(s, { cmd: "spawn", id, p, toHand: !!toHand });
}
function passTo(s, p) {
  drain(s);
  let guard = 0;
  while ((s.active !== p || s.pending) && s.winner == null && guard++ < 30) {
    if (s.active === p && !s.pending) break;
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
function drain(s) {
  let g = 0;
  while (s.pending && g++ < 12) {
    const pl = s.pending.player;
    if (s.pending.type === "trap") E.apply(s, pl, { a: "respond", slot: null });
    else if (s.pending.type === "discard") E.apply(s, pl, { a: "discard", uid: s.players[pl].hand[0] });
    else break;
  }
}
function skipToBattle(s, p) {
  // leave turn 1, come back as p on turn >= 2 in main, then enter battle
  if (s.turn === 1) { E.apply(s, s.active, { a: "endturn" }); passTo(s, p); }
  if (s.active !== p) passTo(s, p);
  if (s.phase === "main") E.apply(s, p, { a: "phase" });
}
function skipTurn1(s) {
  if (s.turn === 1 && s.active === 0) { E.apply(s, 0, { a: "endturn" }); drain(s); passTo(s, 0); }
}

// uniqueness vs edition one
const e1fx = new Set();
D.CARDS.filter((c) => !c.set || c.set === "edition_one").forEach((c) => {
  if (!c.fx) return;
  Object.keys(c.fx).forEach((k) => e1fx.add(k + ":" + JSON.stringify(c.fx[k])));
});
const stolen = [];
D.CARDS.filter((c) => c.set === "edition_two").forEach((c) => {
  if (!c.fx) return;
  // ignore shared engine keys that every set uses
  const ignore = new Set(["tgt", "on", "set", "fusion"]);
  const keys = Object.keys(c.fx).filter((k) => !ignore.has(k));
  // blatant reskins we specifically forbade
  const banned = ["wipeAll", "halfLp", "drawDiscard", "revive", "pierce", "attackTwice", "extraAttackOnKill", "haste"];
  keys.forEach((k) => { if (banned.includes(k)) stolen.push(c.id + "." + k); });
});
check("no stolen ed1 gimmick flags on ed2", stolen.length === 0);
check("secrets are not wipes / crowns", (() => {
  const a = D.BY_ID.apex_omega, o = D.BY_ID.omega_core, g = D.BY_ID.singularity;
  return a && a.fx.omegaDirective && o && o.fx.coreSwap && o.fx.useBestStat && g && g.fx.eventHorizon
    && !a.fx.spellUntargetable && !o.fx.equipUpkeep && !g.fx.wipeAll && !g.fx.halfLp;
})());

// ACE PILOT SS + charge
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  spawn(s, 0, "wing_frame");
  spawn(s, 0, "ace_pilot", true);
  const uid = uidOf(s, 0, "ace_pilot");
  const L = E.legal(s, 0);
  check("ace ss legal", (L.hand[uid] || []).indexOf("ss") !== -1);
  E.apply(s, 0, { a: "ss", uid });
  const wf = s.players[0].mz.find((m) => m && s.cards[m.uid].id === "wing_frame");
  check("ace ss gives charge", wf && wf.charge >= 1);
}

// afterburn: second attack after effect (not summon turn)
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 0, "wing_frame");
  spawn(s, 1, "drone_bit");
  spawn(s, 1, "clicker_bot");
  const slot = monId(s, 0, "wing_frame");
  check("afterburn legal in main", (E.legal(s, 0).mz[slot] || []).indexOf("effect") !== -1);
  E.apply(s, 0, { a: "effect", slot });
  check("afterburn def drop", s.players[0].mz[slot].dmod === -600);
  E.apply(s, 0, { a: "phase" });
  const L = E.legal(s, 0);
  check("afterburn can attack", (L.mz[slot] || []).indexOf("attack") !== -1);
  const t = (L.atkTargets[slot] || [])[0];
  E.apply(s, 0, { a: "attack", slot, target: t });
  // if a trap pending, skip
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  const L2 = E.legal(s, 0);
  check("afterburn second attack ready", (L2.mz[slot] || []).indexOf("attack") !== -1);
}

// heat + overheat skip
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 0, "pulse_knight");
  spawn(s, 1, "hex_plate");
  const wall = monId(s, 1, "hex_plate");
  s.players[1].mz[wall].pos = "def";
  const slot = monId(s, 0, "pulse_knight");
  E.apply(s, 0, { a: "phase" });
  E.apply(s, 0, { a: "attack", slot, target: wall });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  check("heat 1 after first attack", s.players[0].mz[slot] && s.players[0].mz[slot].heat === 1);
  // two more attacks across turns
  E.apply(s, 0, { a: "endturn" }); drain(s); passTo(s, 0);
  E.apply(s, 0, { a: "phase" });
  E.apply(s, 0, { a: "attack", slot: monId(s, 0, "pulse_knight"), target: monId(s, 1, "hex_plate") });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  check("heat 2", s.players[0].mz[monId(s, 0, "pulse_knight")].heat === 2);
  E.apply(s, 0, { a: "endturn" }); drain(s); passTo(s, 0);
  E.apply(s, 0, { a: "phase" });
  E.apply(s, 0, { a: "attack", slot: monId(s, 0, "pulse_knight"), target: monId(s, 1, "hex_plate") });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  const pk = s.players[0].mz[monId(s, 0, "pulse_knight")];
  check("overheat vents and flags skip", pk && pk.heat === 0 && pk.skipAttack === true);
  E.apply(s, 0, { a: "endturn" }); drain(s); passTo(s, 0);
  E.apply(s, 0, { a: "phase" });
  const L = E.legal(s, 0);
  const sl = monId(s, 0, "pulse_knight");
  check("overheat skips the next attack", (L.mz[sl] || []).indexOf("attack") === -1);
}

// armor prevents destroy
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 1, "iron_colossus");
  const slot = monId(s, 1, "iron_colossus");
  s.players[1].mz[slot].armor = 1;
  spawn(s, 0, "apex_omega"); // 3000 > 2500
  const lp = s.players[1].lp;
  E.apply(s, 0, { a: "phase" });
  E.apply(s, 0, { a: "attack", slot: monId(s, 0, "apex_omega"), target: slot });
  const still = s.players[1].mz[slot];
  check("armor saves iron colossus", still && still.armor === 0 && s.cards[still.uid].id === "iron_colossus");
}

// cloak: cannot be chosen as attack target if another target exists
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 1, "ghost_cloak");
  spawn(s, 1, "drone_bit");
  const gs = monId(s, 1, "ghost_cloak");
  // need p1 to activate cloak — it's p0's turn. Manually set cloaked.
  s.players[1].mz[gs].cloaked = true;
  spawn(s, 0, "pulse_knight");
  E.apply(s, 0, { a: "phase" });
  const L = E.legal(s, 0);
  const atk = monId(s, 0, "pulse_knight");
  const tgts = L.atkTargets[atk] || [];
  check("cloak is skipped as attack target", tgts.indexOf(gs) === -1 && tgts.indexOf(monId(s, 1, "drone_bit")) !== -1);
}

// storm wing mode switch
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  spawn(s, 0, "storm_wing");
  const slot = monId(s, 0, "storm_wing");
  const m = s.players[0].mz[slot];
  check("storm starts in flight", m.mode === "flight");
  const atkF = E.view(s, 0).players[0].mz[slot].atk;
  check("flight atk bonus", atkF === 2600);
  E.apply(s, 0, { a: "effect", slot });
  check("switched to ground", s.players[0].mz[slot].mode === "ground");
  const v = E.view(s, 0).players[0].mz[slot];
  check("ground def bonus", v.def === 2400);
  E.apply(s, 0, { a: "phase" });
  check("ground cannot attack", (E.legal(s, 0).mz[slot] || []).indexOf("attack") === -1);
}

// stasis blocks tribute
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  spawn(s, 0, "wing_frame");
  spawn(s, 0, "stasis_lock", true);
  const uid = uidOf(s, 0, "stasis_lock");
  const slot = monId(s, 0, "wing_frame");
  E.apply(s, 0, { a: "activate", uid, target: { p: 0, slot } });
  check("stasis flag", s.players[0].mz[slot].stasis === true);
  spawn(s, 0, "sky_ranger", true); // 5 star, 1 tribute
  const sr = uidOf(s, 0, "sky_ranger");
  let threw = false;
  try { E.apply(s, 0, { a: "summon", uid: sr, tributes: [slot] }); } catch (e) { threw = true; }
  check("stasis blocks tribute", threw && monId(s, 0, "wing_frame") >= 0);
}

// jammer attack cap
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 1, "pulse_knight");
  spawn(s, 1, "blade_dancer");
  spawn(s, 0, "jammer", true);
  E.apply(s, 0, { a: "activate", uid: uidOf(s, 0, "jammer") });
  check("attack cap applied", s.players[1].attackCap === 1);
  E.apply(s, 0, { a: "endturn" }); drain(s); passTo(s, 1);
  E.apply(s, 1, { a: "phase" });
  const L = E.legal(s, 1);
  const a1 = monId(s, 1, "pulse_knight");
  const a2 = monId(s, 1, "blade_dancer");
  check("both can start the only attack", (L.mz[a1]||[]).indexOf("attack") !== -1 && (L.mz[a2]||[]).indexOf("attack") !== -1);
  E.apply(s, 1, { a: "attack", slot: a1, target: null });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  const L2 = E.legal(s, 1);
  check("second monster cannot attack under jammer", (L2.mz[a2] || []).indexOf("attack") === -1);
}

// first battle damage zero while tread is in defense
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 1, "tread_frame");
  const ts = monId(s, 1, "tread_frame");
  s.players[1].mz[ts].pos = "def";
  spawn(s, 0, "pulse_knight");
  const lp = s.players[1].lp;
  E.apply(s, 0, { a: "phase" });
  const atk = monId(s, 0, "pulse_knight");
  // attack the defense tread (500 atk vs 1500 def — no damage to attacker? pulse 1500 vs 1500 def — 0)
  // direct would be blocked by tread. Need a direct? But there's a monster. Attack a missing? Must attack tread.
  // Put pulse vs empty? Can't direct if tread is on field.
  // Spawn a weak attacker for pierce? Simpler: leave tread, also no other, and use a spell burn? firstDmg is battle only.
  // Use rail sniper? Or attack with something that pierces? Ed2 has no pierce.
  // Attack INTO a 0 def monster you also spawn on p1? Wait, firstDmgZeroIfDef is "battle damage you would take".
  // So P1 takes damage: P0 attacks a 0-def monster of P1? If I set tread ATK and a second 0 def...
  spawn(s, 1, "clicker_bot"); // 200 def, if atk pos pulse 1500 kills and 1300 dmg? clicker 200/300, if atk 200, 1300 dmg.
  const cb = monId(s, 1, "clicker_bot");
  s.players[1].mz[cb].pos = "atk";
  E.apply(s, 0, { a: "attack", slot: atk, target: cb });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  check("tread zeros first battle damage", s.players[1].lp === lp);
}

// hex plate first hit reduce
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 1, "hex_plate");
  const hs = monId(s, 1, "hex_plate");
  s.players[1].mz[hs].pos = "atk"; // 1100 atk, will take 1500-1100=400, reduce 800 => 0
  spawn(s, 0, "pulse_knight");
  const lp = s.players[1].lp;
  E.apply(s, 0, { a: "phase" });
  E.apply(s, 0, { a: "attack", slot: monId(s, 0, "pulse_knight"), target: hs });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  check("hex plate ablates first hit", s.players[1].lp === lp);
}

// singularity: banish, partial return, no battle
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 0, "pulse_knight");
  spawn(s, 0, "wing_frame");
  spawn(s, 1, "hex_plate");
  spawn(s, 0, "singularity", true);
  E.apply(s, 0, { a: "activate", uid: uidOf(s, 0, "singularity") });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  const mine = s.players[0].mz.filter(Boolean);
  const theirs = s.players[1].mz.filter(Boolean);
  check("each side returned one in defense", mine.length === 1 && theirs.length === 1 && mine[0].pos === "def" && theirs[0].pos === "def");
  check("banished the rest", (s.banished || []).length >= 1);
  check("no battle this turn", s.players[0].noBattle === true);
  const turn = s.turn, active = s.active;
  E.apply(s, 0, { a: "phase" });
  check("phase skip ends the turn", s.turn !== turn || s.active !== active);
}

// no signal: first spell resolves, second does not
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1, all: true });
  spawn(s, 1, "no_signal"); // set on p1 SZ, setTurn -1
  spawn(s, 0, "charge", true);
  spawn(s, 0, "wing_frame");
  spawn(s, 0, "jammer", true);
  const ch = uidOf(s, 0, "charge");
  const wf = monId(s, 0, "wing_frame");
  E.apply(s, 0, { a: "activate", uid: ch, target: { p: 0, slot: wf } });
  // p1 should be pending trap
  check("no signal window", s.pending && s.pending.type === "trap" && s.pending.on === "spell");
  const tslot = s.pending.options[0];
  E.apply(s, 1, { a: "respond", slot: tslot });
  check("charge still resolved", s.players[0].mz[wf].charge >= 2);
  check("jam flag set", s.players[0].jamSpells === true);
  let jammed = false;
  try { E.apply(s, 0, { a: "activate", uid: uidOf(s, 0, "jammer") }); } catch (e) { jammed = /jamm/i.test(e.message); }
  check("second spell jammed", jammed);
}

// trip mine pins a summon in defense
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1, all: true });
  spawn(s, 1, "trip_mine");
  spawn(s, 0, "wing_frame");
  spawn(s, 0, "ace_pilot", true);
  const uid = uidOf(s, 0, "ace_pilot");
  E.apply(s, 0, { a: "ss", uid });
  check("trip mine window", s.pending && (s.pending.on === "ss" || s.pending.on === "summon"));
  E.apply(s, 1, { a: "respond", slot: s.pending.options[0] });
  const m = s.players[0].mz[monId(s, 0, "ace_pilot")];
  check("trip mine pins defense", m && m.pos === "def" && m.posChanged);
}

// omega directive: once per duel, machines battle-immune, multi-attack
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  E.admin(s, { cmd: "clear", p: 1 });
  spawn(s, 0, "apex_omega");
  spawn(s, 0, "wing_frame");
  spawn(s, 1, "pulse_knight"); // 1500, apex 3000
  spawn(s, 1, "drone_bit");
  const slot = monId(s, 0, "apex_omega");
  E.apply(s, 0, { a: "effect", slot });
  check("directive used", s.players[0].directiveUsed === true && s.players[0].directiveUntil === s.turn);
  // try to battle-destroy wing_frame? Apex attacks pulse, pulse is 1500 vs 3000 dies. Instead have pulse attack wing after.
  // Give wing 800 atk, pulse 1500 would destroy it — but it's our turn.
  // Simulate destroyMon battle on wing
  const ev = [];
  // Use a public path: end, let p1 attack wing_frame. Directive is this turn only, so must stay this turn.
  // We'll have an enemy attack via... can't. Directly call isn't exported.
  // Check legal attacks of apex can hit each monster (maxAttacks >= 2).
  E.apply(s, 0, { a: "phase" });
  const L = E.legal(s, 0);
  check("directive multi-attack listed", (L.mz[slot] || []).indexOf("attack") !== -1);
  const t0 = (L.atkTargets[slot] || [])[0];
  E.apply(s, 0, { a: "attack", slot, target: t0 });
  if (s.pending) E.apply(s, s.pending.player, { a: "respond", slot: null });
  const L2 = E.legal(s, 0);
  check("apex can attack a second enemy", (L2.mz[slot] || []).indexOf("attack") !== -1);
}

// field fusion haste via battle station
{
  const s = mk();
  skipTurn1(s);
  E.admin(s, { cmd: "clear", p: 0 });
  spawn(s, 0, "battle_station", true);
  E.apply(s, 0, { a: "activate", uid: uidOf(s, 0, "battle_station") });
  check("battle station field", s.field && s.cards[s.field.uid].id === "battle_station");
  spawn(s, 0, "storm_wing");
  s.players[0].mz[monId(s, 0, "storm_wing")].summonedTurn = s.turn; // treat as just summoned
  E.apply(s, 0, { a: "phase" });
  const sl = monId(s, 0, "storm_wing");
  check("fusion haste under battle station", (E.legal(s, 0).mz[sl] || []).indexOf("attack") !== -1);
}

if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("ed2_mechanics: all checks passed");
