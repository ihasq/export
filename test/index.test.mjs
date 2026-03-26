import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { stringify, parse } from "devalue";
import WebSocket from "ws";
import path from "node:path";
import fs from "node:fs";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "fixture");
const PORT = 8899;
const BASE = `http://localhost:${PORT}`;

// ─── Helpers ────────────────────────────────────────────────

function rpcClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/`);
    let mid = 0;
    const pending = new Map();

    ws.on("message", (raw) => {
      const msg = parse(raw.toString());
      const r = pending.get(msg.id);
      if (!r) return;
      pending.delete(msg.id);
      if (msg.type === "error") r.reject(new Error(msg.error));
      else r.resolve(msg);
    });

    const send = (msg) =>
      new Promise((res, rej) => {
        const id = ++mid;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(stringify({ ...msg, id }));
      });

    ws.on("open", () =>
      resolve({
        call: (p, args = []) => send({ type: "call", path: p, args }),
        construct: (p, args = []) => send({ type: "construct", path: p, args }),
        instanceCall: (iid, p, args = []) =>
          send({ type: "call", instanceId: iid, path: p, args }),
        instanceGet: (iid, p) => send({ type: "get", instanceId: iid, path: p }),
        instanceSet: (iid, p, v) =>
          send({ type: "set", instanceId: iid, path: p, args: [v] }),
        release: (iid) => send({ type: "release", instanceId: iid }),
        ping: () => send({ type: "ping" }),
        iterateNext: (iid) => send({ type: "iterate-next", iteratorId: iid }),
        iterateReturn: (iid) => send({ type: "iterate-return", iteratorId: iid }),
        streamRead: (sid) => send({ type: "stream-read", streamId: sid }),
        streamCancel: (sid) => send({ type: "stream-cancel", streamId: sid }),
        writableCreate: () => send({ type: "writable-create" }),
        writableWrite: (wid, chunk) =>
          send({ type: "writable-write", writableId: wid, chunk }),
        writableClose: (wid) => send({ type: "writable-close", writableId: wid }),
        writableAbort: (wid) => send({ type: "writable-abort", writableId: wid }),
        close: () => ws.close(),
      })
    );
    ws.on("error", reject);
  });
}

function readCoreId() {
  const content = fs.readFileSync(
    path.join(FIXTURE_DIR, ".export-types.js"),
    "utf8"
  );
  const m = content.match(/export const coreId = "([^"]+)"/);
  return m ? m[1] : null;
}

// ─── Global Setup / Teardown ────────────────────────────────

let wranglerProc;
let coreId;
let rpc; // shared RPC connection

before(async () => {
  // Clean up any leftover processes on the port
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}
  await new Promise((r) => setTimeout(r, 1000));

  execSync("npm install --silent 2>&1", { cwd: FIXTURE_DIR });
  execSync("npx generate-export-types", { cwd: FIXTURE_DIR });

  coreId = readCoreId();
  assert.ok(coreId, "coreId should be generated");

  wranglerProc = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
    cwd: FIXTURE_DIR,
    stdio: "ignore",
    detached: true,
  });

  // Poll until server is reachable
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { await fetch(`${BASE}/`); break; } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const check = await fetch(`${BASE}/`).catch(() => null);
  assert.ok(check?.ok, "wrangler dev should be reachable");

  rpc = await rpcClient();
}, { timeout: 60000 });

after(() => {
  rpc?.close();
  if (wranglerProc) {
    try { process.kill(-wranglerProc.pid, "SIGKILL"); } catch {}
  }
});

// ═════════════════════════════════════════════════════════════
//  HTTP Routing
// ═════════════════════════════════════════════════════════════

describe("HTTP routing", () => {
  it("GET / returns index module importing from dynamic UUID path", async () => {
    const res = await fetch(`${BASE}/`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes(`from "./${coreId}.js"`));
    assert.ok(body.includes("createProxy"));
    assert.ok(body.includes("createUploadStream"));
  });

  it("GET / has correct headers", async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.headers.get("content-type"), "application/javascript; charset=utf-8");
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.ok(res.headers.get("x-typescript-types")?.endsWith("/?types"));
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });

  it("GET / lists all exports", async () => {
    const body = await fetch(`${BASE}/`).then((r) => r.text());
    for (const name of [
      "greet", "add", "willThrow", "countUp", "math", "streamData",
      "Counter", "echo", "getDate", "getRegExp", "getBigInt", "getSet",
      "getMap", "getSpecialNumbers", "getNestedObject", "getTypedArray",
      "VERSION", "MAX_COUNT",
    ]) {
      assert.ok(body.includes(`"${name}"`), `should export ${name}`);
    }
  });

  it("GET /<uuid>.js returns minified core module", async () => {
    const res = await fetch(`${BASE}/${coreId}.js`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes("createProxy"));
    assert.ok(body.includes("WebSocket"));
  });

  it("GET /<uuid>.js has immutable cache headers", async () => {
    const res = await fetch(`${BASE}/${coreId}.js`);
    assert.match(res.headers.get("cache-control"), /immutable/);
    assert.match(res.headers.get("cache-control"), /max-age=31536000/);
  });

  it("core UUID changes per build", () => {
    const typesFile = path.join(FIXTURE_DIR, ".export-types.js");
    const original = fs.readFileSync(typesFile, "utf8");
    try {
      execSync("npx generate-export-types", { cwd: FIXTURE_DIR });
      const id2 = readCoreId();
      assert.notEqual(coreId, id2, "UUIDs should differ between builds");
    } finally {
      fs.writeFileSync(typesFile, original);
    }
  });

  it("GET /greet returns per-export module with default + named", async () => {
    const body = await fetch(`${BASE}/greet`).then((r) => r.text());
    assert.ok(body.includes("export default"));
    assert.ok(body.includes("as greet"));
    assert.ok(body.includes(`from "./${coreId}.js"`));
  });

  it("GET /Counter returns per-export module", async () => {
    const body = await fetch(`${BASE}/Counter`).then((r) => r.text());
    assert.ok(body.includes("as Counter"));
  });

  it("GET /greet has correct headers", async () => {
    const res = await fetch(`${BASE}/greet`);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.ok(res.headers.get("x-typescript-types")?.endsWith("/greet?types"));
  });

  it("GET /nonexistent returns 404", async () => {
    assert.equal((await fetch(`${BASE}/nonexistent`)).status, 404);
  });

  it("GET /?types returns full type definitions", async () => {
    const body = await fetch(`${BASE}/?types`).then((r) => r.text());
    assert.ok(body.includes("export declare function greet"));
    assert.ok(body.includes("export declare class Counter"));
    assert.ok(body.includes("export declare const math"));
    assert.ok(body.includes("createUploadStream"));
  });

  it("GET /?types has typescript content-type", async () => {
    const res = await fetch(`${BASE}/?types`);
    assert.match(res.headers.get("content-type"), /application\/typescript/);
  });

  it("GET /greet?types re-exports from root types", async () => {
    const body = await fetch(`${BASE}/greet?types`).then((r) => r.text());
    assert.equal(body, `export { greet as default, greet } from "./?types";`);
  });

  it("GET /Counter?types re-exports from root types", async () => {
    const body = await fetch(`${BASE}/Counter?types`).then((r) => r.text());
    assert.equal(body, `export { Counter as default, Counter } from "./?types";`);
  });

  it("GET /nonexistent?types returns 404", async () => {
    assert.equal((await fetch(`${BASE}/nonexistent?types`)).status, 404);
  });
});

// ═════════════════════════════════════════════════════════════
//  Type Generation Quality
// ═════════════════════════════════════════════════════════════

describe("generated type definitions", () => {
  let types;
  before(async () => {
    types = await fetch(`${BASE}/?types`).then((r) => r.text());
  });

  it("preserves function parameter names and types", () => {
    assert.ok(types.includes("greet(name: string): Promise<string>"));
    assert.ok(types.includes("add(a: number, b: number): Promise<number>"));
  });

  it("wraps sync return types in Promise", () => {
    assert.ok(types.includes("add(a: number, b: number): Promise<number>"));
  });

  it("handles async generators", () => {
    assert.ok(types.includes("countUp(start: number, end: number): Promise<AsyncIterable<number>>"));
  });

  it("handles ReadableStream return type", () => {
    assert.ok(types.includes("streamData(count: number): Promise<ReadableStream<Uint8Array>>"));
  });

  it("generates class with constructor + methods, excludes private fields", () => {
    assert.ok(types.includes("export declare class Counter"));
    assert.ok(types.includes("constructor(initial?: number"));
    assert.ok(types.includes("increment(): Promise<number>"));
    assert.ok(types.includes("getLabel(): Promise<string>"));
    assert.ok(types.includes("[Symbol.dispose](): Promise<void>"));
    const classBlock = types.slice(
      types.indexOf("export declare class Counter"),
      types.indexOf("}", types.indexOf("export declare class Counter")) + 1
    );
    assert.ok(!classBlock.includes("  count:"), "private field should be excluded");
  });

  it("generates nested object types", () => {
    assert.ok(types.includes("export declare const math"));
    assert.ok(types.includes("multiply(a: number, b: number): Promise<number>"));
  });

  it("includes createUploadStream helper type", () => {
    assert.ok(types.includes("createUploadStream(): Promise<{"));
    assert.ok(types.includes("stream: WritableStream<any>"));
  });
});

// ═════════════════════════════════════════════════════════════
//  RPC: Function Calls
// ═════════════════════════════════════════════════════════════

describe("RPC: function calls", () => {
  it("calls async function", async () => {
    assert.equal((await rpc.call(["greet"], ["World"])).value, "Hello, World!");
  });

  it("calls sync function (auto-awaited)", async () => {
    assert.equal((await rpc.call(["add"], [3, 7])).value, 10);
  });

  it("calls nested object method", async () => {
    assert.equal((await rpc.call(["math", "multiply"], [6, 7])).value, 42);
  });

  it("propagates errors from functions", async () => {
    await assert.rejects(() => rpc.call(["willThrow"]), /intentional error/);
  });

  it("propagates errors from nested methods", async () => {
    await assert.rejects(() => rpc.call(["math", "divide"], [1, 0]), /division by zero/);
  });

  it("errors on calling non-function", async () => {
    await assert.rejects(() => rpc.call(["VERSION"]), /is not a function/);
  });

  it("returns constant values via echo", async () => {
    assert.equal((await rpc.call(["echo"], [42])).value, 42);
  });

  it("handles ping/pong", async () => {
    assert.equal((await rpc.ping()).type, "pong");
  });
});

// ═════════════════════════════════════════════════════════════
//  RPC: Class Instances
// ═════════════════════════════════════════════════════════════

describe("RPC: class instances", () => {
  it("constructs instance with args", async () => {
    const r = await rpc.construct(["Counter"], [10, "test"]);
    assert.equal(r.valueType, "instance");
    assert.ok(r.instanceId > 0);
  });

  it("calls instance methods", async () => {
    const c = await rpc.construct(["Counter"], [100]);
    assert.equal((await rpc.instanceCall(c.instanceId, ["getCount"])).value, 100);
  });

  it("instance state persists across calls", async () => {
    const c = await rpc.construct(["Counter"], [0]);
    await rpc.instanceCall(c.instanceId, ["increment"]);
    await rpc.instanceCall(c.instanceId, ["increment"]);
    await rpc.instanceCall(c.instanceId, ["increment"]);
    assert.equal((await rpc.instanceCall(c.instanceId, ["getCount"])).value, 3);
  });

  it("calls async instance methods", async () => {
    const c = await rpc.construct(["Counter"], [50]);
    assert.equal((await rpc.instanceCall(c.instanceId, ["asyncIncrement"])).value, 51);
  });

  it("gets instance property", async () => {
    const c = await rpc.construct(["Counter"], [0, "myLabel"]);
    assert.equal((await rpc.instanceGet(c.instanceId, ["label"])).value, "myLabel");
  });

  it("sets instance property", async () => {
    const c = await rpc.construct(["Counter"], [0, "old"]);
    await rpc.instanceSet(c.instanceId, ["label"], "new");
    assert.equal((await rpc.instanceGet(c.instanceId, ["label"])).value, "new");
  });

  it("releases instance", async () => {
    const c = await rpc.construct(["Counter"], [0]);
    assert.equal((await rpc.release(c.instanceId)).value, true);
  });

  it("errors on released instance call", async () => {
    const c = await rpc.construct(["Counter"], [0]);
    await rpc.release(c.instanceId);
    await assert.rejects(() => rpc.instanceCall(c.instanceId, ["getCount"]), /Instance not found/);
  });

  it("errors on released instance get", async () => {
    const c = await rpc.construct(["Counter"], [0]);
    await rpc.release(c.instanceId);
    await assert.rejects(() => rpc.instanceGet(c.instanceId, ["label"]), /Instance not found/);
  });

  it("errors on released instance set", async () => {
    const c = await rpc.construct(["Counter"], [0]);
    await rpc.release(c.instanceId);
    await assert.rejects(() => rpc.instanceSet(c.instanceId, ["label"], "x"), /Instance not found/);
  });

  it("tracks multiple instances independently", async () => {
    const c1 = await rpc.construct(["Counter"], [10]);
    const c2 = await rpc.construct(["Counter"], [20]);
    await rpc.instanceCall(c1.instanceId, ["increment"]);
    assert.equal((await rpc.instanceCall(c1.instanceId, ["getCount"])).value, 11);
    assert.equal((await rpc.instanceCall(c2.instanceId, ["getCount"])).value, 20);
  });

  it("errors on constructing non-class", async () => {
    await assert.rejects(() => rpc.construct(["add"]), /is not a class/);
  });
});

// ═════════════════════════════════════════════════════════════
//  RPC: Async Iterators
// ═════════════════════════════════════════════════════════════

describe("RPC: async iterators", () => {
  it("iterates through async generator values", async () => {
    const r = await rpc.call(["countUp"], [1, 3]);
    assert.equal(r.valueType, "asynciterator");
    const values = [];
    let done = false;
    while (!done) {
      const next = await rpc.iterateNext(r.iteratorId);
      if (next.done) done = true; else values.push(next.value);
    }
    assert.deepEqual(values, [1, 2, 3]);
  });

  it("early return terminates iterator", async () => {
    const r = await rpc.call(["countUp"], [1, 100]);
    await rpc.iterateNext(r.iteratorId);
    assert.equal((await rpc.iterateReturn(r.iteratorId)).done, true);
  });

  it("errors on non-existent iterator", async () => {
    await assert.rejects(() => rpc.iterateNext(99999), /Iterator not found/);
  });
});

// ═════════════════════════════════════════════════════════════
//  RPC: ReadableStream
// ═════════════════════════════════════════════════════════════

describe("RPC: ReadableStream", () => {
  it("reads all chunks from stream", async () => {
    const r = await rpc.call(["streamData"], [3]);
    assert.equal(r.valueType, "readablestream");
    const chunks = [];
    let done = false;
    while (!done) {
      const next = await rpc.streamRead(r.streamId);
      if (next.done) done = true; else chunks.push(next.value);
    }
    assert.equal(chunks.length, 3);
    assert.ok(Array.isArray(chunks[0])); // Uint8Array serialized as Array
  });

  it("cancels stream mid-read", async () => {
    const r = await rpc.call(["streamData"], [100]);
    await rpc.streamRead(r.streamId);
    assert.equal((await rpc.streamCancel(r.streamId)).value, true);
  });

  it("errors on non-existent stream", async () => {
    await assert.rejects(() => rpc.streamRead(99999), /Stream not found/);
  });
});

// ═════════════════════════════════════════════════════════════
//  RPC: WritableStream
// ═════════════════════════════════════════════════════════════

describe("RPC: WritableStream", () => {
  it("creates, writes, and closes writable stream", async () => {
    const r = await rpc.writableCreate();
    assert.equal(r.valueType, "writablestream");
    await rpc.writableWrite(r.writableId, [1, 2, 3]);
    await rpc.writableWrite(r.writableId, [4, 5, 6]);
    assert.equal((await rpc.writableClose(r.writableId)).value.length, 2);
  });

  it("aborts writable stream", async () => {
    const r = await rpc.writableCreate();
    await rpc.writableWrite(r.writableId, [1, 2, 3]);
    assert.equal((await rpc.writableAbort(r.writableId)).value, true);
  });

  it("errors on non-existent writable write", async () => {
    await assert.rejects(() => rpc.writableWrite(99999, [1]), /WritableStream not found/);
  });

  it("errors on non-existent writable close", async () => {
    await assert.rejects(() => rpc.writableClose(99999), /WritableStream not found/);
  });
});

// ═════════════════════════════════════════════════════════════
//  RPC: Devalue Serialization Round-Trip
// ═════════════════════════════════════════════════════════════

describe("RPC: devalue round-trip", () => {
  it("string", async () => {
    assert.equal((await rpc.call(["echo"], ["hello"])).value, "hello");
  });

  it("number", async () => {
    assert.equal((await rpc.call(["echo"], [3.14])).value, 3.14);
  });

  it("boolean", async () => {
    assert.equal((await rpc.call(["echo"], [true])).value, true);
  });

  it("null", async () => {
    assert.equal((await rpc.call(["echo"], [null])).value, null);
  });

  it("undefined", async () => {
    assert.equal((await rpc.call(["echo"], [undefined])).value, undefined);
  });

  it("Date", async () => {
    const r = await rpc.call(["getDate"]);
    assert.ok(r.value instanceof Date);
    assert.equal(r.value.toISOString(), "2025-01-01T00:00:00.000Z");
  });

  it("RegExp", async () => {
    const r = await rpc.call(["getRegExp"]);
    assert.ok(r.value instanceof RegExp);
    assert.equal(r.value.source, "hello");
    assert.equal(r.value.flags, "gi");
  });

  it("BigInt", async () => {
    assert.equal((await rpc.call(["getBigInt"])).value, 9007199254740993n);
  });

  it("Set", async () => {
    const r = await rpc.call(["getSet"]);
    assert.ok(r.value instanceof Set);
    assert.deepEqual([...r.value], [1, 2, 3]);
  });

  it("Map", async () => {
    const r = await rpc.call(["getMap"]);
    assert.ok(r.value instanceof Map);
    assert.equal(r.value.get("a"), 1);
    assert.equal(r.value.get("b"), 2);
  });

  it("special numbers (NaN, Infinity, -Infinity, -0)", async () => {
    const r = await rpc.call(["getSpecialNumbers"]);
    assert.ok(Number.isNaN(r.value.nan));
    assert.equal(r.value.inf, Infinity);
    assert.equal(r.value.negInf, -Infinity);
    assert.ok(Object.is(r.value.negZero, -0));
  });

  it("nested objects", async () => {
    assert.deepEqual((await rpc.call(["getNestedObject"])).value, { a: { b: { c: 42 } } });
  });

  it("Uint8Array", async () => {
    const r = await rpc.call(["getTypedArray"]);
    assert.ok(r.value instanceof Uint8Array);
    assert.deepEqual([...r.value], [1, 2, 3, 4, 5]);
  });

  it("complex object via echo", async () => {
    const input = { a: 1, b: [2, 3], c: { d: true } };
    assert.deepEqual((await rpc.call(["echo"], [input])).value, input);
  });

  it("array via echo", async () => {
    assert.deepEqual((await rpc.call(["echo"], [[1, "two", null, true]])).value, [1, "two", null, true]);
  });

  it("Date via echo", async () => {
    const d = new Date("2024-06-15T12:00:00Z");
    const r = await rpc.call(["echo"], [d]);
    assert.equal(r.value.getTime(), d.getTime());
  });

  it("Set via echo", async () => {
    const r = await rpc.call(["echo"], [new Set([10, 20])]);
    assert.deepEqual([...r.value], [10, 20]);
  });

  it("Map via echo", async () => {
    const r = await rpc.call(["echo"], [new Map([["x", 1]])]);
    assert.equal(r.value.get("x"), 1);
  });

  it("RegExp via echo", async () => {
    const r = await rpc.call(["echo"], [/test/i]);
    assert.equal(r.value.source, "test");
    assert.equal(r.value.flags, "i");
  });

  it("BigInt via echo", async () => {
    assert.equal((await rpc.call(["echo"], [42n])).value, 42n);
  });
});
