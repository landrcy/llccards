/* Admin panel: press L. LOCAL ONLY. Collection tools always work; duel tools only touch a local VS BOT game
   and are disabled whenever an online match is running (the host is authoritative, so nothing here can sync). */
(function () {
  const $ = (id) => document.getElementById(id);
  const D = window.LLCData;
  const panel = $("admin");
  // LOCAL ONLY: the panel exists on localhost / 127.0.0.1 / file:// (or with ?admin=1 for a deliberate test on the live site).
  const h = location.hostname;
  const LOCAL = location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "" || /[?&]admin=1\b/.test(location.search);
  if (!LOCAL) { if (panel) panel.remove(); return; }
  let god = false;

  const opt = (c) => '<option value="' + c.id + '">' + c.name + " (" + c.rarity + (c.kind === "monster" ? ", " + c.stars + "★" : ", " + c.kind) + ")</option>";
  $("adm-card").innerHTML = D.CARDS.map(opt).join("");
  $("adm-spawn").innerHTML = D.CARDS.map(opt).join("");

  function duelCtl() {
    const d = window.LLCDuel;
    const ctl = d && d.ctl;
    return ctl && ctl.mode === "bot" && ctl.admin && LLC.screen === "duel" ? ctl : null;
  }
  function refresh() {
    const ctl = duelCtl();
    const online = window.LLCDuel && LLCDuel.ctl && LLCDuel.ctl.mode === "online";
    $("adm-duel").classList.toggle("off", !ctl);
    $("adm-duel-off").textContent = online ? "Disabled: you are in an ONLINE game." : "Start a VS BOT duel to use these. Disabled in online games.";
    $("adm-duel-off").hidden = !!ctl;
    $("adm-duel").querySelectorAll("button, select, input").forEach((b) => { b.disabled = !ctl; });
    if (ctl && LLCDuel.V) { god = !!(LLCDuel.V.god && LLCDuel.V.god[+$("adm-who").value]); }
    $("adm-god").textContent = "GOD MODE: " + (god ? "ON" : "OFF");
    $("adm-god").classList.toggle("on", god);
  }
  function toggle(force) {
    const open = force != null ? force : panel.hidden;
    panel.hidden = !open;
    if (open) refresh();
  }
  const say = (msg) => { const n = document.querySelector(".admin-note"); n.textContent = msg; clearTimeout(say.t); say.t = setTimeout(() => { n.textContent = "local only · press L to close"; }, 1800); };

  document.addEventListener("keydown", (e) => {
    if ((e.key === "l" || e.key === "L") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") && t.closest && !t.closest("#admin")) return;
      if (t && t.tagName === "INPUT" && t.closest("#admin")) return;
      e.preventDefault();
      toggle();
    }
    if (e.key === "Escape" && !panel.hidden) toggle(false);
  });
  $("admin-x").addEventListener("click", () => toggle(false));
  panel.addEventListener("click", (e) => { if (e.target === panel) toggle(false); });

  const after = () => { if (LLC.screen === "binder") LLC.renderBinder(); if (LLC.screen === "shop") LLC.renderShop(); if (LLC.screen === "arena") document.dispatchEvent(new CustomEvent("llc:screen", { detail: { name: "arena", prev: "arena" } })); };
  $("adm-give").addEventListener("click", () => {
    const id = $("adm-card").value;
    LLCStorage.addPulls([{ id, card: D.BY_ID[id], foil: $("adm-foil").checked }]);
    say("Gave " + D.BY_ID[id].name + "."); after();
  });
  $("adm-give-all").addEventListener("click", () => {
    LLCStorage.addPulls(D.CARDS.map((c) => ({ id: c.id, card: c, foil: $("adm-foil").checked })));
    say("Gave all " + D.CARDS.length + " cards."); after();
  });
  $("adm-add-ink").addEventListener("click", () => {
    const n = Math.round(Number($("adm-ink").value) || 0);
    say("Ink: " + LLCStorage.addInk(n)); after();
  });
  const openFree = (id) => { toggle(false); if (LLC.screen === "duel") return say("Leave the duel first."); LLC.startOpening(id); };
  $("adm-open-e1").addEventListener("click", () => openFree("edition_one"));
  $("adm-open-sr").addEventListener("click", () => openFree("super_rare"));
  $("adm-reset").addEventListener("click", () => {
    if (!confirm("Reset ALL progress (cards and ink)?")) return;
    LLCStorage.reset(); say("Progress reset."); after();
  });

  const act = (op) => { const ctl = duelCtl(); if (!ctl) return refresh(); ctl.admin(op); setTimeout(refresh, 50); };
  const who = () => +$("adm-who").value;
  $("adm-spawn-go").addEventListener("click", () => act({ cmd: "spawn", p: who(), id: $("adm-spawn").value }));
  $("adm-hand-go").addEventListener("click", () => act({ cmd: "spawn", p: who(), id: $("adm-spawn").value, toHand: true }));
  $("adm-clear").addEventListener("click", () => act({ cmd: "clear", p: who() }));
  $("adm-clear-all").addEventListener("click", () => act({ cmd: "clear", p: who(), all: true }));
  $("adm-draw").addEventListener("click", () => act({ cmd: "draw", p: who() }));
  $("adm-lp-go").addEventListener("click", () => act({ cmd: "lp", p: who(), value: Number($("adm-lp").value) || 0 }));
  $("adm-god").addEventListener("click", () => { god = !god; act({ cmd: "god", p: who(), on: god }); });
  $("adm-who").addEventListener("change", refresh);
  document.addEventListener("llc:screen", () => { if (!panel.hidden) refresh(); });
  window.LLCAdmin = { toggle, refresh };
})();
