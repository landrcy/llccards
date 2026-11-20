/* Collection saved in localStorage. Per card: owned + whether a foil was pulled. */
(function (global) {
  const KEY = "llc-cards-collection-v1";

  function empty() {
    return { edition_one: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return empty();
      if (!data.edition_one) data.edition_one = {};
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
      const prev = set[p.id] || { owned: false, foil: false };
      set[p.id] = { owned: true, foil: !!(prev.foil || p.foil) };
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

  global.LLCStorage = { KEY, load, save, record, isNew, addPulls, reset, ownedCount, empty };
})(window);
