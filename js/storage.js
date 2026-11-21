/* Collection saved in localStorage. Per card: owned, foil, how many copies (n). Plus INK, the shop currency. */
(function (global) {
  const KEY = "llc-cards-collection-v1";

  const START_INK = 300;   // enough for one Super Rare pack
  function empty() {
    return { edition_one: {}, ink: START_INK, v: 2 };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return empty();
      if (!data.edition_one) data.edition_one = {};
      if (typeof data.ink !== "number") data.ink = START_INK;   // older saves get the starter ink once
      data.v = 2;
      return data;
    } catch (e) {
      return empty();
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function record(id) {
    const data = load();
    return data.edition_one[id] || null;
  }

  function isNew(id) {
    const rec = record(id);
    return !(rec && rec.owned);
  }

  /* Add pulled cards. Returns the same list annotated with wasNew (before this pack). */
  function addPulls(pulls, max) {
    const data = load();
    const set = data.edition_one;
    const result = pulls.map((p) => {
      const wasNew = !(set[p.id] && set[p.id].owned);
      const prev = set[p.id] || { owned: false, foil: false, n: 0 };
      set[p.id] = { owned: true, foil: !!(prev.foil || p.foil), n: Math.max(prev.n || (prev.owned ? 1 : 0), 0) + (p.count || 1) };
      return Object.assign({}, p, { wasNew });
    });
    save(data);
    return result;
  }

  function reset() {
    localStorage.removeItem(KEY);
  }

  function ownedCount() {
    const set = load().edition_one;
    return Object.keys(set).filter((id) => set[id] && set[id].owned).length;
  }

  /* admin flags (persist in the save): inf = infinite ink, instant = instant pack opening, force = next pack's top rarity */
  function flags() { return load().admin || {}; }
  function setFlag(k, v) { const d = load(); d.admin = d.admin || {}; if (v == null || v === false) delete d.admin[k]; else d.admin[k] = v; save(d); document.dispatchEvent(new CustomEvent("llc:ink", { detail: { ink: ink() } })); }
  function infinite() { return !!flags().inf; }
  function ink() { const d = load(); return d.admin && d.admin.inf ? Infinity : d.ink; }
  function inkLabel() { const v = ink(); return v === Infinity ? "\u221e" : String(v); }
  function setInk(n) { const d = load(); d.ink = Math.max(0, Math.round(Number(n) || 0)); save(d); document.dispatchEvent(new CustomEvent("llc:ink", { detail: { ink: ink() } })); return d.ink; }
  /* custom decks: 3 slots of { name, cards: [id...] }; active = slot index or -1 for the auto deck */
  const DECK_SLOTS = 3;
  function decks() {
    const d = load();
    const list = Array.isArray(d.decks) ? d.decks.slice(0, DECK_SLOTS) : [];
    while (list.length < DECK_SLOTS) list.push({ name: "DECK " + (list.length + 1), cards: [] });
    return { list, active: typeof d.activeDeck === "number" ? d.activeDeck : -1 };
  }
  function saveDeck(i, deck) { const d = load(); const cur = decks(); cur.list[i] = { name: String(deck.name || "DECK " + (i + 1)).slice(0, 18), cards: (deck.cards || []).slice(0, 40) }; d.decks = cur.list; save(d); }
  function setActiveDeck(i) { const d = load(); d.activeDeck = i; save(d); }
  function addInk(n) {
    const data = load();
    data.ink = Math.max(0, Math.round(data.ink + n));
    save(data);
    document.dispatchEvent(new CustomEvent("llc:ink", { detail: { ink: data.ink } }));
    return data.ink;
  }
  function spendInk(n) {
    const data = load();
    if (data.admin && data.admin.inf) return true;
    if (data.ink < n) return false;
    data.ink -= n;
    save(data);
    document.dispatchEvent(new CustomEvent("llc:ink", { detail: { ink: data.ink } }));
    return true;
  }

  global.LLCStorage = { KEY, START_INK, load, save, record, isNew, addPulls, reset, ownedCount, empty, ink, inkLabel, setInk, addInk, spendInk, flags, setFlag, infinite, decks, saveDeck, setActiveDeck, DECK_SLOTS };
})(window);
