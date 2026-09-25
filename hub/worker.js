var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// hub.js
var MAX_NAME = 16;
var MAX_PARTY = 8;
var INVITE_MS = 6e4;
var MARK_TTL_MS = 3e4;
var GAME_IDLE_MS = 30 * 6e4;
var KEY_REBIND_MS = 14 * 24 * 36e5;
var MAX_MESSAGE = 2048;
var RATE_PER_10S = 60;
// PortalLive: комната на двоих-троих, кадры и голос пересылаются как есть.
var PORTAL_PEERS = 3;
var PORTAL_MAX_FRAME = 256 * 1024;
var PORTAL_RATE_PER_10S = 900;
var Hub = class {
  static {
    __name(this, "Hub");
  }
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.rate = /* @__PURE__ */ new Map();
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    } catch (_) {
    }
  }
  // ------------------------------------------------------------------
  // соединение
  // ------------------------------------------------------------------
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/portal") return this.portalJoin(url);
    const name = cleanName(url.searchParams.get("name"));
    const key = (url.searchParams.get("key") || "").slice(0, 128);
    const room = cleanRoom(url.searchParams.get("room"));
    if (!name || key.length < 16) return new Response("bad hello", { status: 400 });
    if (!await this.checkKey(name, key)) return new Response("name is taken", { status: 403 });
    const lower = name.toLowerCase();
    for (const old of this.ctx.getWebSockets("n:" + lower)) {
      try {
        old.close(4e3, "replaced");
      } catch (_) {
      }
    }
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, ["n:" + lower, "r:" + room, "all"]);
    server.serializeAttachment({ name, lower, room, pet: null, cosm: null });
    this.ctx.waitUntil(this.welcome(server, name, lower, room));
    return new Response(null, { status: 101, webSocket: client });
  }
  async checkKey(name, key) {
    const hash = await sha256(key);
    const storeKey = "key:" + name.toLowerCase();
    const now = Date.now();
    const known = await this.ctx.storage.get(storeKey);
    if (known && known.hash !== hash && now - (known.seen || 0) < KEY_REBIND_MS) return false;
    await this.ctx.storage.put(storeKey, { hash, seen: now });
    return true;
  }
  async welcome(ws, name, lower, room) {
    send(ws, { t: "hello", name });
    const pets = [];
    for (const other of this.ctx.getWebSockets("r:" + room)) {
      const a = attachment(other);
      if (a && a.lower !== lower && a.pet) pets.push({ name: a.name, pet: a.pet });
    }
    if (pets.length) send(ws, { t: "pets", list: pets });
    // Косметика (Customization) — так же, как питомцы: новичок сразу видит,
    // во что одеты те, кто уже в комнате.
    const cosms = [];
    for (const other of this.ctx.getWebSockets("r:" + room)) {
      const a = attachment(other);
      if (a && a.lower !== lower && a.cosm) cosms.push({ name: a.name, cosm: a.cosm });
    }
    if (cosms.length) send(ws, { t: "cosms", list: cosms });
    this.broadcastRoom(room, { t: "join", name }, lower);
    await this.sendParty(lower);
    const party = await this.partyOf(lower);
    if (party) await this.broadcastParty(party);
    for (const inv of await this.invitesFor(lower, "pinv:")) send(ws, { t: "p.invite", id: inv.id, from: inv.from });
    for (const inv of await this.invitesFor(lower, "cinv:")) send(ws, { t: "c.invite", id: inv.id, from: inv.from });
    await this.sendGame(lower);
  }
  async webSocketMessage(ws, raw) {
    const p = attachment(ws);
    if (p && p.portal) return this.portalRelay(ws, p, raw);
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    const a = attachment(ws);
    if (!a) return;
    if (!this.allow(a.lower)) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch (_) {
      return;
    }
    if (!m || typeof m.t !== "string") return;
    try {
      await this.handle(ws, a, m);
    } catch (err) {
      send(ws, { t: "err", msg: "server error" });
    }
  }
  async webSocketClose(ws) {
    await this.gone(ws);
  }
  async webSocketError(ws) {
    await this.gone(ws);
  }
  async gone(ws) {
    const a = attachment(ws);
    if (!a) return;
    if (a.portal) {
      for (const s of this.ctx.getWebSockets("portal")) {
        if (s !== ws) send(s, { t: "portal.leave", name: a.name });
      }
      return;
    }
    const still = this.ctx.getWebSockets("n:" + a.lower).some((s) => s !== ws);
    if (still) return;
    this.broadcastRoom(a.room, { t: "leave", name: a.name }, a.lower);
    const party = await this.partyOf(a.lower);
    if (party) await this.broadcastParty(party);
    const game = await this.gameOf(a.lower);
    if (game) await this.pushGame(game);
  }
  allow(lower) {
    const now = Date.now();
    let r = this.rate.get(lower);
    if (!r || now - r.start > 1e4) {
      r = { start: now, n: 0 };
      this.rate.set(lower, r);
    }
    r.n++;
    return r.n <= RATE_PER_10S;
  }
  // ------------------------------------------------------------------
  // сообщения
  // ------------------------------------------------------------------
  async handle(ws, a, m) {
    switch (m.t) {
      case "who": {
        const names = [];
        for (const s of this.ctx.getWebSockets("all")) {
          const o = attachment(s);
          if (o && !names.includes(o.name)) names.push(o.name);
          if (names.length >= 300) break;
        }
        send(ws, { t: "who", names });
        return;
      }
      case "emote": {
        const id = Number.isInteger(m.id) ? m.id : -1;
        if (id < 0 || id > 63) return;
        this.broadcastRoom(a.room, { t: "emote", name: a.name, id }, a.lower);
        return;
      }
      case "pet": {
        const pet = m.pet && typeof m.pet === "object" ? m.pet : null;
        if (pet && JSON.stringify(pet).length > 512) return;
        a.pet = pet;
        ws.serializeAttachment(a);
        this.broadcastRoom(a.room, { t: "pet", name: a.name, pet }, a.lower);
        return;
      }
      case "cosm": {
        const cosm = m.cosm && typeof m.cosm === "object" ? m.cosm : null;
        if (cosm && JSON.stringify(cosm).length > 512) return;
        a.cosm = cosm;
        ws.serializeAttachment(a);
        this.broadcastRoom(a.room, { t: "cosm", name: a.name, cosm }, a.lower);
        return;
      }
      // --- команда ---
      case "p.create":
        return this.partyCreate(ws, a);
      case "p.invite":
        return this.partyInvite(ws, a, cleanName(m.to));
      case "p.accept":
        return this.partyAnswer(ws, a, String(m.id || ""), true);
      case "p.decline":
        return this.partyAnswer(ws, a, String(m.id || ""), false);
      case "p.leave":
        return this.partyLeave(a.lower);
      case "p.kick":
        return this.partyKick(ws, a, cleanName(m.who));
      case "p.mark":
        return this.partyMark(a, m);
      // --- карты ---
      case "c.invite":
        return this.cardsInvite(ws, a, cleanName(m.to));
      case "c.accept":
        return this.cardsAnswer(ws, a, String(m.id || ""), true);
      case "c.decline":
        return this.cardsAnswer(ws, a, String(m.id || ""), false);
      case "c.play":
        return this.cardsAct(ws, a, "play", m);
      case "c.beat":
        return this.cardsAct(ws, a, "beat", m);
      case "c.take":
        return this.cardsAct(ws, a, "take", m);
      case "c.done":
        return this.cardsAct(ws, a, "done", m);
      case "c.leave":
        return this.cardsAct(ws, a, "leave", m);
      default:
        return;
    }
  }
  // ------------------------------------------------------------------
  // PortalLive: свой экземпляр Hub на каждый код комнаты (см. /portal в
  // worker.fetch). Здесь только пересылка: всё, что прислал один, уходит
  // остальным в этой комнате — кадры (бинарные) и служебные строки.
  // ------------------------------------------------------------------
  portalJoin(url) {
    const name = cleanName(url.searchParams.get("name"));
    if (!name || !cleanPortal(url.searchParams.get("code"))) return new Response("bad hello", { status: 400 });
    const lower = name.toLowerCase();
    const peers = this.ctx.getWebSockets("portal").filter((s) => {
      const o = attachment(s);
      if (o && o.lower === lower) {
        try {
          s.close(4e3, "replaced");
        } catch (_) {
        }
        return false;
      }
      return true;
    });
    if (peers.length >= PORTAL_PEERS) return new Response("room is full", { status: 409 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, ["portal"]);
    server.serializeAttachment({ portal: true, name, lower });
    send(server, { t: "portal.hello", peers: peers.map((s) => (attachment(s) || {}).name).filter(Boolean) });
    for (const s of peers) send(s, { t: "portal.join", name });
    return new Response(null, { status: 101, webSocket: client });
  }
  portalRelay(ws, a, raw) {
    const size = typeof raw === "string" ? raw.length : raw.byteLength;
    if (!size || size > PORTAL_MAX_FRAME) return;
    const now = Date.now();
    let r = this.rate.get("portal:" + a.lower);
    if (!r || now - r.start > 1e4) {
      r = { start: now, n: 0 };
      this.rate.set("portal:" + a.lower, r);
    }
    if (++r.n > PORTAL_RATE_PER_10S) return;
    for (const s of this.ctx.getWebSockets("portal")) {
      if (s === ws) continue;
      try {
        s.send(raw);
      } catch (_) {
      }
    }
  }
  // ------------------------------------------------------------------
  // команда (party)
  // ------------------------------------------------------------------
  async partyOf(lower) {
    const id = await this.ctx.storage.get("pm:" + lower);
    if (!id) return null;
    const party = await this.ctx.storage.get("party:" + id);
    if (!party || !party.members.includes(lower)) {
      await this.ctx.storage.delete("pm:" + lower);
      return null;
    }
    return party;
  }
  async savePart(party) {
    await this.ctx.storage.put("party:" + party.id, party);
  }
  partyView(party) {
    return {
      id: party.id,
      leader: party.names[party.leader] || party.leader,
      members: party.members.map((l) => ({
        name: party.names[l] || l,
        online: this.ctx.getWebSockets("n:" + l).length > 0
      }))
    };
  }
  async sendParty(lower) {
    const party = await this.partyOf(lower);
    this.toName(lower, { t: "p.state", party: party ? this.partyView(party) : null });
  }
  async broadcastParty(party) {
    const view = { t: "p.state", party: this.partyView(party) };
    for (const l of party.members) this.toName(l, view);
  }
  async partyCreate(ws, a) {
    if (await this.partyOf(a.lower)) return send(ws, { t: "err", msg: "Ты уже в команде" });
    const party = { id: randomId(), leader: a.lower, members: [a.lower], names: { [a.lower]: a.name } };
    await this.savePart(party);
    await this.ctx.storage.put("pm:" + a.lower, party.id);
    await this.broadcastParty(party);
  }
  async partyInvite(ws, a, to) {
    if (!to) return;
    const party = await this.partyOf(a.lower);
    if (!party) return send(ws, { t: "err", msg: "Сначала создай команду" });
    const lower = to.toLowerCase();
    if (party.members.includes(lower)) return send(ws, { t: "err", msg: to + " уже в команде" });
    if (party.members.length >= MAX_PARTY) return send(ws, { t: "err", msg: "Команда заполнена" });
    if (this.ctx.getWebSockets("n:" + lower).length === 0) {
      return send(ws, { t: "err", msg: to + " сейчас не в игре с Nebula" });
    }
    const inv = { id: randomId(), party: party.id, from: a.name, to: lower, exp: Date.now() + INVITE_MS };
    await this.ctx.storage.put("pinv:" + inv.id, inv);
    this.toName(lower, { t: "p.invite", id: inv.id, from: a.name });
    send(ws, { t: "info", msg: "Приглашение отправлено: " + to });
  }
  async partyAnswer(ws, a, id, accept) {
    const inv = await this.ctx.storage.get("pinv:" + id);
    await this.ctx.storage.delete("pinv:" + id);
    if (!inv || inv.to !== a.lower || inv.exp < Date.now()) {
      return send(ws, { t: "err", msg: "Приглашение устарело" });
    }
    if (!accept) {
      this.toName(inv.from.toLowerCase(), { t: "info", msg: a.name + " отклонил приглашение" });
      return;
    }
    const party = await this.ctx.storage.get("party:" + inv.party);
    if (!party) return send(ws, { t: "err", msg: "Команды больше нет" });
    if (party.members.length >= MAX_PARTY) return send(ws, { t: "err", msg: "Команда заполнена" });
    if (await this.partyOf(a.lower)) await this.partyLeave(a.lower);
    party.members.push(a.lower);
    party.names[a.lower] = a.name;
    await this.savePart(party);
    await this.ctx.storage.put("pm:" + a.lower, party.id);
    await this.broadcastParty(party);
  }
  async partyLeave(lower) {
    const party = await this.partyOf(lower);
    await this.ctx.storage.delete("pm:" + lower);
    this.toName(lower, { t: "p.state", party: null });
    if (!party) return;
    party.members = party.members.filter((l) => l !== lower);
    delete party.names[lower];
    if (party.members.length === 0) {
      await this.ctx.storage.delete("party:" + party.id);
      return;
    }
    if (party.leader === lower) party.leader = party.members[0];
    await this.savePart(party);
    await this.broadcastParty(party);
  }
  async partyKick(ws, a, who) {
    if (!who) return;
    const party = await this.partyOf(a.lower);
    if (!party || party.leader !== a.lower) return send(ws, { t: "err", msg: "Исключать может только лидер" });
    const lower = who.toLowerCase();
    if (!party.members.includes(lower) || lower === a.lower) return;
    this.toName(lower, { t: "info", msg: "Тебя исключили из команды" });
    await this.partyLeave(lower);
  }
  async partyMark(a, m) {
    const x = num(m.x), y = num(m.y), z = num(m.z);
    if (x === null || y === null || z === null) return;
    const party = await this.partyOf(a.lower);
    if (!party) return;
    const dim = typeof m.dim === "string" ? m.dim.slice(0, 64) : "";
    const msg = { t: "p.mark", from: a.name, x, y, z, dim, ttl: MARK_TTL_MS };
    for (const l of party.members) {
      for (const s of this.ctx.getWebSockets("n:" + l)) {
        const o = attachment(s);
        if (o && o.room === a.room) send(s, msg);
      }
    }
  }
  // ------------------------------------------------------------------
  // карты: подкидной дурак на двоих
  // ------------------------------------------------------------------
  async gameOf(lower) {
    const id = await this.ctx.storage.get("cg:" + lower);
    if (!id) return null;
    const g = await this.ctx.storage.get("game:" + id);
    if (!g || !g.players.includes(lower) || g.over && Date.now() - g.touched > 6e4 || Date.now() - g.touched > GAME_IDLE_MS) {
      await this.ctx.storage.delete("cg:" + lower);
      return null;
    }
    return g;
  }
  async cardsInvite(ws, a, to) {
    if (!to) return;
    const lower = to.toLowerCase();
    if (lower === a.lower) return;
    if (await this.gameOf(a.lower)) return send(ws, { t: "err", msg: "Сначала доиграй текущую партию" });
    if (this.ctx.getWebSockets("n:" + lower).length === 0) {
      return send(ws, { t: "err", msg: to + " сейчас не в игре с Nebula" });
    }
    if (await this.gameOf(lower)) return send(ws, { t: "err", msg: to + " уже играет" });
    const inv = { id: randomId(), from: a.name, fromLower: a.lower, to: lower, exp: Date.now() + INVITE_MS };
    await this.ctx.storage.put("cinv:" + inv.id, inv);
    this.toName(lower, { t: "c.invite", id: inv.id, from: a.name });
    send(ws, { t: "info", msg: "Вызов в дурака отправлен: " + to });
  }
  async cardsAnswer(ws, a, id, accept) {
    const inv = await this.ctx.storage.get("cinv:" + id);
    await this.ctx.storage.delete("cinv:" + id);
    if (!inv || inv.to !== a.lower || inv.exp < Date.now()) {
      return send(ws, { t: "err", msg: "Вызов устарел" });
    }
    if (!accept) {
      this.toName(inv.fromLower, { t: "info", msg: a.name + " отказался от партии" });
      return;
    }
    if (await this.gameOf(inv.fromLower) || await this.gameOf(a.lower)) {
      return send(ws, { t: "err", msg: "Кто-то из вас уже играет" });
    }
    const g = newGame([inv.fromLower, a.lower], { [inv.fromLower]: inv.from, [a.lower]: a.name });
    await this.saveGame(g);
    for (const p of g.players) await this.ctx.storage.put("cg:" + p, g.id);
    await this.pushGame(g);
  }
  async cardsAct(ws, a, action, m) {
    const g = await this.gameOf(a.lower);
    if (!g) return send(ws, { t: "c.state", game: null });
    let error = null;
    if (action === "leave") {
      if (!g.over) {
        g.over = true;
        g.winner = g.players.find((p) => p !== a.lower);
        g.log = (g.names[a.lower] || a.name) + " сдался";
      } else {
        await this.ctx.storage.delete("cg:" + a.lower);
        send(ws, { t: "c.state", game: null });
        return;
      }
    } else {
      error = gameAction(g, a.lower, action, m);
    }
    if (error) return send(ws, { t: "err", msg: error });
    g.touched = Date.now();
    await this.saveGame(g);
    await this.pushGame(g);
  }
  async saveGame(g) {
    await this.ctx.storage.put("game:" + g.id, g);
  }
  async sendGame(lower) {
    const g = await this.gameOf(lower);
    this.toName(lower, { t: "c.state", game: g ? this.gameView(g, lower) : null });
  }
  async pushGame(g) {
    for (const p of g.players) this.toName(p, { t: "c.state", game: this.gameView(g, p) });
  }
  gameView(g, lower) {
    const opp = g.players.find((p) => p !== lower);
    return {
      id: g.id,
      you: g.names[lower],
      opp: g.names[opp],
      oppOnline: this.ctx.getWebSockets("n:" + opp).length > 0,
      hand: g.hands[lower].slice(),
      oppCount: g.hands[opp].length,
      deck: g.deck.length,
      trump: g.trumpCard,
      trumpSuit: g.trumpSuit,
      table: g.table.map((p) => [p[0], p[1]]),
      attacker: g.names[g.attacker],
      defender: g.names[g.defender],
      taking: g.taking,
      discard: g.discard,
      over: g.over,
      winner: g.over ? g.winner ? g.names[g.winner] : "" : null,
      log: g.log || ""
    };
  }
  // ------------------------------------------------------------------
  // рассылка
  // ------------------------------------------------------------------
  toName(lower, msg) {
    for (const s of this.ctx.getWebSockets("n:" + lower)) send(s, msg);
  }
  broadcastRoom(room, msg, exceptLower) {
    const text = JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets("r:" + room)) {
      const o = attachment(s);
      if (o && o.lower === exceptLower) continue;
      try {
        s.send(text);
      } catch (_) {
      }
    }
  }
  async invitesFor(lower, prefix) {
    const out = [];
    const now = Date.now();
    const all = await this.ctx.storage.list({ prefix, limit: 200 });
    for (const [k, inv] of all) {
      if (inv.exp < now) {
        await this.ctx.storage.delete(k);
        continue;
      }
      if (inv.to === lower) out.push(inv);
    }
    return out;
  }
};
var suitOf = /* @__PURE__ */ __name((c) => Math.floor(c / 9), "suitOf");
var rankOf = /* @__PURE__ */ __name((c) => c % 9, "rankOf");
function beats(attack, defense, trump) {
  if (suitOf(defense) === suitOf(attack)) return rankOf(defense) > rankOf(attack);
  return suitOf(defense) === trump && suitOf(attack) !== trump;
}
__name(beats, "beats");
function shuffle(cards) {
  const rnd = new Uint32Array(cards.length);
  crypto.getRandomValues(rnd);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
__name(shuffle, "shuffle");
function newGame(players, names) {
  const deck = shuffle([...Array(36).keys()]);
  const hands = { [players[0]]: [], [players[1]]: [] };
  for (let i = 0; i < 6; i++) for (const p of players) hands[p].push(deck.shift());
  const trumpCard = deck[deck.length - 1];
  const trumpSuit = suitOf(trumpCard);
  let first = players[Math.random() < 0.5 ? 0 : 1];
  let best = 99;
  for (const p of players) {
    for (const c of hands[p]) {
      if (suitOf(c) === trumpSuit && rankOf(c) < best) {
        best = rankOf(c);
        first = p;
      }
    }
  }
  const second = players.find((p) => p !== first);
  return {
    id: randomId(),
    players,
    names,
    deck,
    hands,
    trumpCard,
    trumpSuit,
    attacker: first,
    defender: second,
    table: [],
    taking: false,
    discard: 0,
    over: false,
    winner: null,
    touched: Date.now(),
    log: names[first] + " ходит первым"
  };
}
__name(newGame, "newGame");
function unbeaten(g) {
  return g.table.filter((p) => p[1] < 0).length;
}
__name(unbeaten, "unbeaten");
function tableRanks(g) {
  const ranks = /* @__PURE__ */ new Set();
  for (const [a, d] of g.table) {
    ranks.add(rankOf(a));
    if (d >= 0) ranks.add(rankOf(d));
  }
  return ranks;
}
__name(tableRanks, "tableRanks");
function takeCard(hand, card) {
  const i = hand.indexOf(card);
  if (i < 0) return false;
  hand.splice(i, 1);
  return true;
}
__name(takeCard, "takeCard");
function refill(g, first) {
  for (const p of [first, g.players.find((q) => q !== first)]) {
    while (g.hands[p].length < 6 && g.deck.length > 0) g.hands[p].push(g.deck.shift());
  }
}
__name(refill, "refill");
function checkEnd(g) {
  if (g.deck.length > 0) return;
  const [p, q] = g.players;
  const pe = g.hands[p].length === 0, qe = g.hands[q].length === 0;
  if (!pe && !qe) return;
  g.over = true;
  g.winner = pe && qe ? null : pe ? p : q;
  g.log = g.winner ? g.names[g.winner] + " победил, " + g.names[g.players.find((x) => x !== g.winner)] + " — дурак" : "Ничья";
}
__name(checkEnd, "checkEnd");
function gameAction(g, who, action, m) {
  if (g.over) return "Партия окончена";
  const attacker = who === g.attacker, defender = who === g.defender;
  const hand = g.hands[who];
  if (action === "play") {
    if (!attacker) return "Сейчас не твой ход";
    const card = Number(m.card);
    if (!hand.includes(card)) return "Такой карты нет";
    if (g.table.length >= 6) return "На столе уже шесть карт";
    if (unbeaten(g) + 1 > g.hands[g.defender].length) return "Отбиваться больше нечем";
    if (g.table.length > 0 && !tableRanks(g).has(rankOf(card))) return "Подкидывать можно только те же достоинства";
    takeCard(hand, card);
    g.table.push([card, -1]);
    g.log = g.names[who] + (g.table.length === 1 ? " ходит" : " подкидывает");
    return null;
  }
  if (action === "beat") {
    if (!defender) return "Сейчас не твой ход";
    if (g.taking) return "Ты уже берёшь";
    const card = Number(m.card);
    let slot = Number.isInteger(m.slot) ? m.slot : -1;
    if (!hand.includes(card)) return "Такой карты нет";
    if (slot < 0) slot = g.table.findIndex((p) => p[1] < 0 && beats(p[0], card, g.trumpSuit));
    if (slot < 0 || slot >= g.table.length || g.table[slot][1] >= 0) return "Нечего бить";
    if (!beats(g.table[slot][0], card, g.trumpSuit)) return "Этой картой не побить";
    takeCard(hand, card);
    g.table[slot][1] = card;
    g.log = g.names[who] + " отбивается";
    return null;
  }
  if (action === "take") {
    if (!defender) return "Сейчас не твой ход";
    if (unbeaten(g) === 0) return "Брать нечего";
    g.taking = true;
    g.log = g.names[who] + " берёт";
    return null;
  }
  if (action === "done") {
    if (!attacker) return "Сейчас не твой ход";
    if (g.table.length === 0) return "Сначала сходи";
    if (g.taking) {
      for (const [a, d] of g.table) {
        g.hands[g.defender].push(a);
        if (d >= 0) g.hands[g.defender].push(d);
      }
      g.table = [];
      g.taking = false;
      refill(g, g.attacker);
      g.log = g.names[g.defender] + " взял карты";
    } else {
      if (unbeaten(g) > 0) return "Не всё отбито";
      g.discard += g.table.length * 2;
      g.table = [];
      refill(g, g.attacker);
      const next = g.defender;
      g.defender = g.attacker;
      g.attacker = next;
      g.log = "Бито";
    }
    checkEnd(g);
    return null;
  }
  return "Неизвестный ход";
}
__name(gameAction, "gameAction");
function attachment(ws) {
  try {
    return ws.deserializeAttachment();
  } catch (_) {
    return null;
  }
}
__name(attachment, "attachment");
function send(ws, msg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch (_) {
  }
}
__name(send, "send");
function cleanName(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t || t.length > MAX_NAME) return null;
  return /^[A-Za-z0-9_.\-]+$/.test(t) ? t : null;
}
__name(cleanName, "cleanName");
function cleanRoom(value) {
  return typeof value === "string" && /^[a-f0-9]{8,64}$/.test(value) ? value : "none";
}
__name(cleanRoom, "cleanRoom");
function cleanPortal(value) {
  return typeof value === "string" && /^[A-Za-z0-9_\-]{4,32}$/.test(value) ? value.toLowerCase() : null;
}
__name(cleanPortal, "cleanPortal");
function num(v) {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 3e7 ? v : null;
}
__name(num, "num");
function randomId() {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(randomId, "randomId");
async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");

// worker.js
var TTL_SECONDS = 300;
var CACHE_SECONDS = 90;
var MAX_NAME2 = 16;
var MAX_QUERY_NAMES = 100;
var PREFIX = "p:";
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const hub = env.HUB.get(env.HUB.idFromName("global"));
      return hub.fetch(request);
    }
    if (url.pathname === "/portal") {
      // Своя комната на каждый код: кадры PortalLive не проходят через общий
      // хаб и не упираются в его лимиты. Класс тот же — новых привязок не надо.
      const code = cleanPortal(url.searchParams.get("code"));
      if (!code) return new Response("bad code", { status: 400 });
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const room = env.HUB.get(env.HUB.idFromName("portal:" + code));
      return room.fetch(request);
    }
    try {
      if (request.method === "POST" && url.pathname === "/beat") {
        return await beat(request, env);
      }
      if (request.method === "GET" && url.pathname === "/online") {
        return await online(url, env, ctx);
      }
    } catch (err) {
      return json({ ok: false, count: -1, online: [] }, 200);
    }
    return json({ ok: false, error: "not found" }, 404);
  }
};
async function beat(request, env) {
  const body = await request.json().catch(() => null);
  const name = clean(body && body.name, MAX_NAME2);
  if (!name) return json({ ok: false, error: "bad name" }, 400);
  await env.PRESENCE.put(PREFIX + name.toLowerCase(), "", { expirationTtl: TTL_SECONDS });
  return json({ ok: true });
}
__name(beat, "beat");
async function online(url, env, ctx) {
  const asked = (url.searchParams.get("names") || "").split(",").map((n) => clean(n, MAX_NAME2)).filter(Boolean).slice(0, MAX_QUERY_NAMES).map((n) => n.toLowerCase());
  const snapshot = await cached(url, env, ctx);
  if (asked.length === 0) return json(snapshot);
  const live = new Set(snapshot.online);
  return json({ count: snapshot.count, online: asked.filter((n) => live.has(n)) });
}
__name(online, "online");
async function cached(url, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/__snapshot", url).toString());
  const hit = await cache.match(key);
  if (hit) return await hit.json();
  const snapshot = await listAll(env);
  const stored = json(snapshot);
  stored.headers.set("cache-control", `max-age=${CACHE_SECONDS}`);
  ctx.waitUntil(cache.put(key, stored.clone()));
  return snapshot;
}
__name(cached, "cached");
async function listAll(env) {
  const names = [];
  let cursor;
  do {
    const page = await env.PRESENCE.list({ prefix: PREFIX, cursor, limit: 1e3 });
    for (const key of page.keys) names.push(key.name.slice(PREFIX.length));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return { count: names.length, online: names };
}
__name(listAll, "listAll");
function clean(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return /^[A-Za-z0-9_.\-]+$/.test(trimmed) ? trimmed : null;
}
__name(clean, "clean");
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
export {
  Hub,
  worker_default as default
};
//# sourceMappingURL=worker.js.map
