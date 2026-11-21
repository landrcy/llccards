/* LLC Cards online: WebRTC peer-to-peer through the free PeerJS cloud signalling server.
   Quick match = first free numbered lobby slot hosts, the next player joins it.
   Rooms = a 4-letter code that maps to a peer id. */
(function (global) {
  const QM = "llccards-qm3-";
  const ROOM = "llccards-room3-";
  const SLOTS = 10;
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  let session = 0;
  let peers = [];
  let timers = [];

  function stop() {
    session++;
    timers.forEach(clearInterval);
    timers = [];
    peers.forEach((p) => { try { p.destroy(); } catch (e) {} });
    peers = [];
  }
  /* Keep a peer alive after a match (its data channel lives on it), drop the rest. */
  function keepOnly(peer) {
    timers.forEach(clearInterval);
    timers = [];
    peers.forEach((p) => { if (p !== peer) { try { p.destroy(); } catch (e) {} } });
    peers = peer ? [peer] : [];
  }

  function openPeer(id) {
    return new Promise((res, rej) => {
      if (!global.Peer) { rej({ type: "no-lib" }); return; }
      const peer = id ? new global.Peer(id, { debug: 0 }) : new global.Peer({ debug: 0 });
      peers.push(peer);
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch (e) {} rej({ type: "timeout" }); } }, 12000);
      peer.on("open", () => { if (done) return; done = true; clearTimeout(t); res(peer); });
      peer.on("error", (err) => {
        if (done) return;
        done = true; clearTimeout(t);
        try { peer.destroy(); } catch (e) {}
        rej({ type: err && err.type, message: err && err.message });
      });
    });
  }

  /* Connect to a hosting peer, say hello, wait for accept/busy. Resolves conn or null. */
  function tryJoin(peer, id, hello, ms) {
    return new Promise((res) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        peer.off("error", onErr);
        if (conn) conn.off("data", onData);
        if (!v && conn) { try { conn.close(); } catch (e) {} }
        res(v);
      };
      const onErr = (err) => { if (err && (err.type === "peer-unavailable" || err.type === "network")) finish(null); };
      peer.on("error", onErr);
      const conn = peer.connect(id, { reliable: true, serialization: "json" });
      const onData = (d) => {
        if (!d || typeof d !== "object") return;
        if (d.t === "accept") finish({ conn, hello: d.hello || {} });
        else if (d.t === "busy") finish(null);
      };
      conn.on("open", () => conn.send(Object.assign({ t: "hello" }, hello)));
      conn.on("data", onData);
      conn.on("error", () => finish(null));
      const t = setTimeout(() => finish(null), ms || 7000);
    });
  }

  function listenAsHost(peer, hello, h, sid, onTaken) {
    let busy = false;
    peer.on("connection", (c) => {
      const onData = (d) => {
        if (!d || d.t !== "hello") return;
        if (busy || sid !== session) {
          c.send({ t: "busy" });
          setTimeout(() => { try { c.close(); } catch (e) {} }, 400);
          return;
        }
        busy = true;
        c.off("data", onData);
        c.send({ t: "accept", hello });
        if (onTaken) onTaken();
        keepOnly(peer);
        h.onMatch({ conn: c, role: "host", hello: d, peer });
      };
      c.on("data", onData);
    });
    return () => busy;
  }

  async function quick(hello, h) {
    stop();
    const sid = session;
    let anon = null;
    const getAnon = async () => {
      if (!anon || anon.destroyed || anon.disconnected) anon = await openPeer(null);
      return anon;
    };
    try {
      for (let slot = 0; slot < SLOTS; slot++) {
        if (sid !== session) return;
        h.onStatus("Checking the arena… table " + (slot + 1));
        let hostPeer = null;
        try {
          hostPeer = await openPeer(QM + slot);
        } catch (e) {
          if (e.type !== "unavailable-id") throw e;
        }
        if (sid !== session) { if (hostPeer) hostPeer.destroy(); return; }
        if (hostPeer) {
          h.onStatus("Waiting for a rival at table " + (slot + 1) + "…");
          let joining = false;
          const isBusy = listenAsHost(hostPeer, hello, h, sid);
          /* While waiting, keep checking lower tables in case someone is waiting there. */
          if (slot > 0) {
            const iv = setInterval(async () => {
              if (joining || isBusy() || sid !== session) return;
              joining = true;
              try {
                const a = await getAnon();
                for (let j = 0; j < slot && !isBusy() && sid === session; j++) {
                  const got = await tryJoin(a, QM + j, hello, 5000);
                  if (got && sid === session && !isBusy()) {
                    keepOnly(a);
                    h.onMatch({ conn: got.conn, role: "guest", hello: got.hello, peer: a });
                    return;
                  } else if (got) { try { got.conn.close(); } catch (e) {} }
                }
              } catch (e) { /* keep waiting */ }
              joining = false;
            }, 6000);
            timers.push(iv);
          }
          return;
        }
        const a = await getAnon();
        if (sid !== session) return;
        const got = await tryJoin(a, QM + slot, hello, 6000);
        if (sid !== session) return;
        if (got) {
          keepOnly(a);
          h.onMatch({ conn: got.conn, role: "guest", hello: got.hello, peer: a });
          return;
        }
      }
      h.onError("Every table is busy. Try again in a minute, or play the bot.");
    } catch (e) {
      if (sid !== session) return;
      h.onError(netError(e));
    }
  }

  function makeCode() {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  async function host(hello, h) {
    stop();
    const sid = session;
    try {
      for (let tries = 0; tries < 5; tries++) {
        const code = makeCode();
        try {
          const peer = await openPeer(ROOM + code);
          if (sid !== session) { peer.destroy(); return; }
          h.onRoom(code);
          listenAsHost(peer, hello, h, sid);
          return;
        } catch (e) {
          if (e.type !== "unavailable-id") throw e;
        }
      }
      h.onError("Could not make a room. Try again.");
    } catch (e) {
      if (sid !== session) return;
      h.onError(netError(e));
    }
  }

  async function join(code, hello, h) {
    stop();
    const sid = session;
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 4) { h.onError("Room codes are 4 letters."); return; }
    try {
      h.onStatus("Joining room " + code + "…");
      const a = await openPeer(null);
      if (sid !== session) return;
      const got = await tryJoin(a, ROOM + code, hello, 9000);
      if (sid !== session) return;
      if (!got) { h.onError("No open room " + code + ". Check the code."); return; }
      keepOnly(a);
      h.onMatch({ conn: got.conn, role: "guest", hello: got.hello, peer: a });
    } catch (e) {
      if (sid !== session) return;
      h.onError(netError(e));
    }
  }

  function netError(e) {
    if (e && e.type === "no-lib") return "Online play could not load. Check your connection.";
    if (e && (e.type === "timeout" || e.type === "network" || e.type === "server-error" || e.type === "socket-error"))
      return "Couldn't reach the match server. Try again, or play the bot.";
    if (e && e.type === "browser-incompatible") return "This browser can't do online play.";
    return "Online play hit a snag (" + ((e && e.type) || "unknown") + "). Try again.";
  }

  global.LLCNet = { quick, host, join, stop, makeCode };
})(window);
