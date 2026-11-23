/* Admin panel: press L anywhere (live site too). Collection / ink / pack tools always work.
   Duel tools only touch a local VS BOT game. The whole panel is disabled during ONLINE matches
   (the host is authoritative, so nothing here could sync and it would be cheating). */
(function () {
  const $ = (id) => document.getElementById(id);
  const D = window.LLCData;
  const S = window.LLCStorage;
  const panel = $("admin");
  if (!panel) return;
  let god = false;

  const opt = (c) => '<option value="' + c.id + '">' + c.name + " (" + c.rarity + (c.kind === "monster" ? ", " + c.stars + "★" : ", " + c.kind) + ")</option>";
  $("adm-card").innerHTML = D.CARDS.map(opt).join("");
  $("adm-spawn").innerHTML = D.CARDS.map(opt).join("");

  const inOnline = () => !!(window.LLCDuel && LLCDuel.ctl && LLCDuel.ctl.mode === "online" && LLC.screen === "duel");
  function duelCtl() {
    const d = window.LLCDuel;
    const ctl = d && d.ctl;
    return ctl && ctl.mode === "bot" && ctl.admin && LLC.screen === "duel" ? ctl : null;
  }
  const onOff = (id, label, on) => { $(id).textContent = label + ": " + (on ? "ON" : "OFF"); $(id).classList.toggle("on", !!on); };
  function refresh() {
    const ctl = duelCtl();
    $("adm-duel").classList.toggle("off", !ctl);
    $("adm-duel-off").textContent = "Start a VS BOT duel to use these.";
    $("adm-duel-off").hidden = !!ctl;
    $("adm-duel").querySelectorAll("button, select, input").forEach((b) => { if (b.id !== "adm-bot") b.disabled = !ctl; });
    if (ctl && LLCDuel.V) { god = !!(LLCDuel.V.god && LLCDuel.V.god[+$("adm-who").value]); }
    onOff("adm-god", "GOD MODE", god);
    const f = S.flags();
    onOff("adm-inf", "INFINITE INK", f.inf);
    onOff("adm-instant", "INSTANT OPENING", f.instant);
    $("adm-force").value = f.force || "";
    $("adm-pack-foil").checked = !!f.allFoil;
    $("adm-bot").value = f.bot || "";
    $("adm-ink").placeholder = S.inkLabel();
  }
  function toggle(force) {
    const open = force != null ? force : panel.hidden;
    if (open && inOnline()) { flash("Admin is off during online matches."); return; }
    panel.hidden = !open;
    if (open) refresh();
  }
  function flash(msg) {
    let t = document.getElementById("admin-toast");
    if (!t) { t = document.createElement("div"); t.id = "admin-toast"; t.className = "admin-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => { t.hidden = true; }, 1600);
  }
  const NOTE = "press L to close · off in online games";
  const say = (msg) => { const n = panel.querySelector(".admin-note"); n.textContent = msg; clearTimeout(say.t); say.t = setTimeout(() => { n.textContent = NOTE; }, 1800); };

  document.addEventListener("keydown", (e) => {
    if ((e.key === "l" || e.key === "L") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      toggle();
    }
    if (e.key === "Escape" && !panel.hidden) toggle(false);
  });
  $("admin-x").addEventListener("click", () => toggle(false));
  panel.addEventListener("click", (e) => { if (e.target === panel) toggle(false); });
  document.addEventListener("llc:screen", () => { if (!panel.hidden) { if (inOnline()) toggle(false); else refresh(); } });

  const after = () => {
    if (LLC.screen === "binder") LLC.renderBinder();
    if (LLC.screen === "shop") LLC.renderShop();
    if (LLC.screen === "decks" && window.LLCDecks) LLCDecks.render();
    if (LLC.screen === "arena") document.dispatchEvent(new CustomEvent("llc:screen", { detail: { name: "arena", prev: "arena" } }));
    refresh();
  };
  const guard = (fn) => () => { if (inOnline()) { toggle(false); return; } fn(); };
  const on = (id, fn) => $(id).addEventListener("click", guard(fn));

  /* ink */
  on("adm-inf", () => { const v = !S.flags().inf; S.setFlag("inf", v); say("Infinite ink " + (v ? "ON" : "OFF") + "."); after(); });
  on("adm-add-ink", () => { const n = Math.round(Number($("adm-ink").value) || 0); S.addInk(n); say("Ink: " + S.inkLabel()); after(); });
  on("adm-set-ink", () => { S.setInk($("adm-ink").value); say("Ink set to " + S.load().ink + "."); after(); });

  /* cards */
  on("adm-give", () => {
    const id = $("adm-card").value;
    const n = Math.max(1, Math.min(99, Math.round(Number($("adm-n").value) || 1)));
    S.addPulls([{ id, card: D.BY_ID[id], foil: $("adm-foil").checked, count: n }]);
    say("Gave " + D.BY_ID[id].name + " x" + n + "."); after();
  });
  on("adm-give-all", () => { S.addPulls(D.CARDS.map((c) => ({ id: c.id, card: c, foil: $("adm-foil").checked }))); say("Gave 1 of all " + D.CARDS.length + " cards."); after(); });
  on("adm-max", () => {
    const data = S.load();
    D.CARDS.forEach((c) => { const set = S.bucket(data, c.id); const r = set[c.id] || {}; set[c.id] = { owned: true, foil: !!r.foil, n: Math.max(r.n || 0, LLCEngine.copyCap(c)) }; });
    S.save(data); say("Every card unlocked at max copies."); after();
  });
  on("adm-all-foil", () => {
    const data = S.load();
    ["edition_one","edition_two"].forEach((k) => { const set = data[k] || {}; Object.keys(set).forEach((id) => { if (set[id].owned) set[id].foil = true; }); });
    S.save(data); say("Every owned card is foil."); after();
  });

  /* packs */
  const openFree = (id) => { if (LLC.screen === "duel") return say("Leave the duel first."); toggle(false); LLC.startOpening(id); };
  on("adm-open-e1", () => openFree("edition_one"));
  if ($("adm-open-e2")) on("adm-open-e2", () => openFree("edition_two"));
  on("adm-open-sr", () => openFree("super_rare"));
  on("adm-instant", () => { const v = !S.flags().instant; S.setFlag("instant", v); say("Instant opening " + (v ? "ON" : "OFF") + "."); refresh(); });
  $("adm-force").addEventListener("change", guard(() => { const v = $("adm-force").value; S.setFlag("force", v || null); say(v ? "Next pack ends with a " + D.RARITY_NAME[v] + "." : "Next pack is random."); }));
  $("adm-pack-foil").addEventListener("change", guard(() => { S.setFlag("allFoil", $("adm-pack-foil").checked); say("All-foil pulls " + ($("adm-pack-foil").checked ? "ON" : "OFF") + "."); }));

  /* duel (vs bot only) */
  const act = (op) => { const ctl = duelCtl(); if (!ctl) return refresh(); ctl.admin(op); setTimeout(refresh, 50); };
  const who = () => +$("adm-who").value;
  on("adm-spawn-go", () => act({ cmd: "spawn", p: who(), id: $("adm-spawn").value }));
  on("adm-hand-go", () => act({ cmd: "spawn", p: who(), id: $("adm-spawn").value, toHand: true }));
  on("adm-clear", () => act({ cmd: "clear", p: who() }));
  on("adm-clear-all", () => act({ cmd: "clear", p: who(), all: true }));
  on("adm-draw", () => act({ cmd: "draw", p: who() }));
  on("adm-lp-go", () => act({ cmd: "lp", p: who(), value: Number($("adm-lp").value) || 0 }));
  on("adm-god", () => { god = !god; act({ cmd: "god", p: who(), on: god }); });
  on("adm-win", () => { act({ cmd: "lp", p: 1, value: 0 }); toggle(false); });
  $("adm-bot").addEventListener("change", guard(() => { S.setFlag("bot", $("adm-bot").value || null); say("Bot: " + ($("adm-bot").selectedOptions[0].textContent) + "."); }));
  $("adm-who").addEventListener("change", refresh);

  /* reset */
  on("adm-reset", () => {
    if (!confirm("Reset ALL progress (cards, decks, ink and admin settings)?")) return;
    S.reset(); say("Progress reset."); after();
  });
  window.LLCAdmin = { toggle, refresh };
})();
