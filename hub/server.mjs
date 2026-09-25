// Хаб Nebula на обычном сервере — без Cloudflare.
//
// Зачем: в России Cloudflare режут провайдеры, и у игроков оттуда метки команды,
// портал и остальное доходили с опозданием или соединение рвалось. Здесь тот же
// hub (worker.js — ровно тот файл, что крутится на Cloudflare, без изменений),
// а под ним — свои заменители того, что давал Cloudflare:
//
//   Durable Object      — объект Hub в памяти, по одному на имя ("global",
//                         "portal:<код>"), как idFromName;
//   хранилище DO        — Map, которая пишется в JSON-файл (data/<имя>.json);
//   hibernation WebSocket — свой WebSocket-сервер на node:http (RFC 6455),
//                         теги, attachment и автоответ на {"t":"ping"};
//   KV присутствия      — Map с временем жизни записи.
//
// Без зависимостей: нужен только Node 18+. Запуск: node server.mjs
// Порт — PORT (по умолчанию 8080), данные — DATA_DIR (по умолчанию ./data).

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(HERE, "data");
/** Самое большое сообщение от клиента. Кадр портала — до 256 КБ, с запасом. */
const MAX_MESSAGE = 1024 * 1024;
/** Сколько может ждать отправки одному клиенту, прежде чем кадры видео начнут пропускаться. */
const MAX_BUFFERED = 2 * 1024 * 1024;
/** Тишина дольше — соединение мёртвое (клиент шлёт ping каждые 25 с, мы — каждые 30 с). */
const IDLE_MS = 120_000;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

// ------------------------------------------------------------------
// заменители API Cloudflare
// ------------------------------------------------------------------

/** Ответ Worker-а: тело, статус, заголовки и, для 101, сокет. */
class ShimResponse {
  constructor(body, init = {}) {
    this.body = body ?? null;
    this.status = init.status || 200;
    this.webSocket = init.webSocket || null;
    const h = new Map();
    for (const [k, v] of Object.entries(init.headers || {})) h.set(k.toLowerCase(), String(v));
    this.headers = { get: (k) => h.get(k.toLowerCase()) ?? null, set: (k, v) => h.set(k.toLowerCase(), String(v)), entries: () => h.entries() };
  }
  clone() { return this; }
  async json() { return JSON.parse(this.body); }
  async text() { return String(this.body ?? ""); }
}
globalThis.Response = ShimResponse;
globalThis.WebSocketRequestResponsePair = class {
  constructor(request, response) { this.request = request; this.response = response; }
};
/** Кэш Worker-а для /online: не нужен, список и так в памяти. */
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

/**
 * Серверная половина сокета, как её видит hub: send, close, attachment.
 * Живое соединение (node-сокет) подключается к ней после ответа 101.
 */
class HubSocket {
  constructor() {
    this.tags = [];
    this.attachment = null;
    this.conn = null;
    this.closed = false;
    this.pending = [];
  }
  send(data) {
    if (this.closed) return;
    if (!this.conn) {
      this.pending.push(data);
      return;
    }
    this.conn.send(data);
  }
  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    // Закрытие по инициативе хаба («replaced»): обработчик ухода не зовём —
    // тот же игрок уже вошёл заново, и «ушёл» после «вошёл» сбило бы остальных.
    this.serverClosed = true;
    this.conn?.close(code, reason);
  }
  serializeAttachment(a) { this.attachment = a == null ? null : JSON.parse(JSON.stringify(a)); }
  deserializeAttachment() { return this.attachment == null ? null : JSON.parse(JSON.stringify(this.attachment)); }
}
globalThis.WebSocketPair = class {
  constructor() {
    const server = new HubSocket();
    this[0] = { server };
    this[1] = server;
  }
};

/** Хранилище Durable Object: Map, которая через секунду после изменений пишется на диск. */
class Storage {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    this.dirty = false;
    if (file && fs.existsSync(file)) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) this.map.set(k, v);
      } catch (e) {
        console.error("storage: не прочитался " + file + ": " + e.message);
      }
    }
  }
  copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  async get(k) { return this.copy(this.map.get(k)); }
  async put(k, v) { this.map.set(k, this.copy(v)); this.touch(); }
  async delete(k) { const had = this.map.delete(k); if (had) this.touch(); return had; }
  async list({ prefix = "", limit = Infinity } = {}) {
    const out = new Map();
    for (const k of [...this.map.keys()].sort()) {
      if (!k.startsWith(prefix)) continue;
      out.set(k, this.copy(this.map.get(k)));
      if (out.size >= limit) break;
    }
    return out;
  }
  touch() {
    if (!this.file || this.dirty) return;
    this.dirty = true;
    setTimeout(() => this.flush(), 1000);
  }
  flush() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const tmp = this.file + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error("storage: не записалось " + this.file + ": " + e.message);
    }
  }
}

/** Контекст Durable Object: сокеты с тегами, хранилище, автоответ. */
class Ctx {
  constructor(name, persist) {
    this.name = name;
    this.sockets = new Set();
    this.autoResponse = null;
    this.storage = new Storage(persist ? path.join(DATA_DIR, name.replace(/[^a-z0-9_-]/gi, "_") + ".json") : null);
  }
  acceptWebSocket(ws, tags = []) { ws.tags = tags; ws.ctx = this; this.sockets.add(ws); }
  getWebSockets(tag) {
    const out = [];
    for (const s of this.sockets) if (!s.closed && (!tag || s.tags.includes(tag))) out.push(s);
    return out;
  }
  setWebSocketAutoResponse(pair) { this.autoResponse = pair; }
  waitUntil(promise) { Promise.resolve(promise).catch((e) => console.error(this.name + ": " + e.stack)); }
}

const { Hub, default: worker } = await import(new URL("./worker.js", import.meta.url).href);

/** Экземпляры Hub по имени — как idFromName + get. Порталы в памяти, «global» — на диске. */
const instances = new Map();
function instance(name) {
  let it = instances.get(name);
  if (!it) {
    const ctx = new Ctx(name, !name.startsWith("portal:"));
    it = { ctx, hub: new Hub(ctx, env) };
    ctx.hub = it.hub;
    instances.set(name, it);
  }
  return it;
}

/** KV присутствия: ключ живёт expirationTtl секунд. */
const presence = new Map();
const env = {
  HUB: {
    idFromName: (name) => name,
    get: (name) => {
      const it = instance(name);
      return { fetch: (request) => it.hub.fetch(request) };
    },
  },
  PRESENCE: {
    async put(key, value, opts = {}) {
      presence.set(key, { value, until: Date.now() + (opts.expirationTtl || 300) * 1000 });
    },
    async list({ prefix = "" } = {}) {
      const now = Date.now();
      const keys = [];
      for (const [name, e] of presence) {
        if (e.until < now) { presence.delete(name); continue; }
        if (name.startsWith(prefix)) keys.push({ name });
      }
      return { keys, list_complete: true };
    },
  },
};

// ------------------------------------------------------------------
// WebSocket (RFC 6455) поверх node:http
// ------------------------------------------------------------------

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class Conn {
  constructor(socket, hubSocket) {
    this.socket = socket;
    this.hs = hubSocket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.fragOp = 0;
    this.open = true;
    this.lastSeen = Date.now();
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.on("data", (d) => this.onData(d));
    socket.on("close", () => this.gone());
    socket.on("error", () => this.gone());
  }

  onData(chunk) {
    this.lastSeen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.fail(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_MESSAGE) return this.fail(1009);
      if (!masked) return this.fail(1002);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.frame(fin, op, payload);
    }
  }

  frame(fin, op, payload) {
    if (op === 0x8) return this.close(1000, "");
    if (op === 0x9) return this.write(0xa, payload);
    if (op === 0xa) return;
    if (op === 0x0) {
      if (!this.frag) return this.fail(1002);
      this.frag.push(payload);
      if (this.frag.reduce((n, b) => n + b.length, 0) > MAX_MESSAGE) return this.fail(1009);
      if (!fin) return;
      const whole = Buffer.concat(this.frag);
      const kind = this.fragOp;
      this.frag = null;
      return this.message(kind, whole);
    }
    if (op === 0x1 || op === 0x2) {
      if (!fin) {
        this.frag = [payload];
        this.fragOp = op;
        return;
      }
      return this.message(op, payload);
    }
    this.fail(1002);
  }

  message(op, payload) {
    const hs = this.hs;
    const ctx = hs.ctx;
    if (op === 0x1) {
      const text = payload.toString("utf8");
      // Автоответ хаба: ping отвечается без разбора, как у Cloudflare.
      if (ctx.autoResponse && text === ctx.autoResponse.request) return this.send(ctx.autoResponse.response);
      dispatch(ctx, hs, text);
    } else {
      dispatch(ctx, hs, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
    }
  }

  send(data) {
    if (!this.open) return;
    if (typeof data === "string") return this.write(0x1, Buffer.from(data, "utf8"));
    // Видео портала — единственное, что может не успевать. Пусть лучше пропадёт
    // кадр, чем у медленного клиента вырастет очередь и задержка.
    if (this.socket.writableLength > MAX_BUFFERED) return;
    const buf = data instanceof ArrayBuffer ? Buffer.from(data)
      : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(String(data));
    this.write(0x2, buf);
  }

  write(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  close(code = 1000, reason = "") {
    if (!this.open) return;
    const r = Buffer.from(String(reason).slice(0, 100), "utf8");
    const body = Buffer.alloc(2 + r.length);
    body.writeUInt16BE(code, 0);
    r.copy(body, 2);
    this.write(0x8, body);
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2000).unref();
    this.gone();
  }

  fail(code) {
    this.close(code, "");
  }

  gone() {
    if (this.done) return;
    this.done = true;
    this.open = false;
    conns.delete(this);
    const hs = this.hs;
    const ctx = hs.ctx;
    const byServer = hs.serverClosed;
    hs.closed = true;
    ctx.sockets.delete(hs);
    if (!byServer) {
      Promise.resolve()
        .then(() => ctx.hub.webSocketClose(hs, 1000, "", true))
        .catch((e) => console.error(ctx.name + ": close: " + e.stack))
        .finally(() => cleanup(ctx));
    } else {
      cleanup(ctx);
    }
  }
}

const conns = new Set();

/** Сообщения одного Hub — строго по очереди, как в Durable Object. */
function dispatch(ctx, hs, data) {
  ctx.queue = (ctx.queue || Promise.resolve())
    .then(() => ctx.hub.webSocketMessage(hs, data))
    .catch((e) => console.error(ctx.name + ": message: " + e.stack));
}

/** Пустая комната портала больше не нужна. */
function cleanup(ctx) {
  if (ctx.name.startsWith("portal:") && ctx.sockets.size === 0) instances.delete(ctx.name);
}

// Живы ли соединения: ping раз в 30 с, молчащих дольше IDLE_MS — закрыть.
setInterval(() => {
  const now = Date.now();
  for (const c of conns) {
    if (now - c.lastSeen > IDLE_MS) c.close(1001, "idle");
    else c.write(0x9, Buffer.alloc(0));
  }
}, 30_000).unref();

// ------------------------------------------------------------------
// HTTP
// ------------------------------------------------------------------

function requestOf(req, body) {
  const url = "http://" + (req.headers.host || "hub") + req.url;
  return {
    url,
    method: req.method,
    headers: { get: (k) => req.headers[k.toLowerCase()] ?? null },
    json: async () => JSON.parse(body || "null"),
  };
}

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on("data", (d) => {
    size += d.length;
    if (size > 16 * 1024) req.destroy();
    else chunks.push(d);
  });
  req.on("end", async () => {
    const url = new URL(req.url, "http://hub");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("ok " + conns.size + "\n");
    }
    try {
      const r = await worker.fetch(requestOf(req, Buffer.concat(chunks).toString("utf8")), env, new Ctx("req", false));
      const headers = Object.fromEntries(r.headers.entries());
      headers["access-control-allow-origin"] = "*";
      res.writeHead(r.status, headers);
      res.end(r.body == null ? "" : String(r.body));
    } catch (e) {
      console.error("http: " + e.stack);
      res.writeHead(500);
      res.end();
    }
  });
});

server.on("upgrade", async (req, socket) => {
  socket.on("error", () => {});
  const key = req.headers["sec-websocket-key"];
  if (!key || String(req.headers.upgrade).toLowerCase() !== "websocket") return socket.destroy();
  let r;
  try {
    const request = requestOf(req, "");
    request.headers = { get: (k) => (k.toLowerCase() === "upgrade" ? "websocket" : req.headers[k.toLowerCase()] ?? null) };
    r = await worker.fetch(request, env, new Ctx("req", false));
  } catch (e) {
    console.error("upgrade: " + e.stack);
    r = new ShimResponse("error", { status: 500 });
  }
  if (r.status !== 101 || !r.webSocket) {
    const body = String(r.body ?? "");
    socket.end(`HTTP/1.1 ${r.status} Error\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    return;
  }
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const hs = r.webSocket.server;
  if (!hs.ctx) return socket.destroy();
  const conn = new Conn(socket, hs);
  conns.add(conn);
  hs.conn = conn;
  // Хаб мог закрыть сокет или что-то послать ещё до рукопожатия (welcome).
  if (hs.closed) return conn.close(4000, "replaced");
  for (const m of hs.pending.splice(0)) conn.send(m);
});

function shutdown() {
  for (const it of instances.values()) it.ctx.storage.flush();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// HOST — если хостинг разрешает слушать только свой адрес (иначе все адреса).
server.listen(PORT, process.env.HOST || undefined, () => console.log(`nebula hub: порт ${PORT}, данные в ${DATA_DIR}`));
