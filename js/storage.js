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
  function addPulls(pulls) {
    const data = load();
    const set = data.edition_one;
    const result = pulls.map((p) => {
      const wasNew = !(set[p.id] && set[p.id].owned);
      const prev = set[p.id] || { owned: false, foil: false, n: 0 };
      set[p.id] = { owned: true, foil: !!(prev.foil || p.foil), n: (prev.n || (prev.owned ? 1 : 0)) + 1 };
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

  function ink() { return load().ink; }
  function addInk(n) {
    const data = load();
    data.ink = Math.max(0, Math.round(data.ink + n));
    save(data);
    document.dispatchEvent(new CustomEvent("llc:ink", { detail: { ink: data.ink } }));
    return data.ink;
  }
  function spendInk(n) {
    const data = load();
    if (data.ink < n) return false;
    data.ink -= n;
    save(data);
    document.dispatchEvent(new CustomEvent("llc:ink", { detail: { ink: data.ink } }));
    return true;
  }

  global.LLCStorage = { KEY, START_INK, load, save, record, isNew, addPulls, reset, ownedCount, empty, ink, addInk, spendInk };
})(window);
