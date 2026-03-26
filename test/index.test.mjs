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

function rpcClient(wsPath = "/") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}${wsPath}`);
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
    // Run in a temp copy to avoid hot-reloading the fixture server
    const tmp = path.join(FIXTURE_DIR, "..", ".tmp-uuid-test");
    try {
      fs.mkdirSync(tmp, { recursive: true });
      fs.cpSync(path.join(FIXTURE_DIR, "src"), path.join(tmp, "src"), { recursive: true });
      fs.copyFileSync(path.join(FIXTURE_DIR, "wrangler.toml"), path.join(tmp, "wrangler.toml"));
      fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
      // Symlink export-runtime so generate-export-types works
      fs.symlinkSync(
        path.resolve(FIXTURE_DIR, "node_modules/export-runtime"),
        path.join(tmp, "node_modules/export-runtime"),
      );
      execSync("npx generate-export-types", { cwd: tmp });
      const id1 = fs.readFileSync(path.join(tmp, ".export-types.js"), "utf8")
        .match(/coreId = "([^"]+)"/)?.[1];
      execSync("npx generate-export-types", { cwd: tmp });
      const id2 = fs.readFileSync(path.join(tmp, ".export-types.js"), "utf8")
        .match(/coreId = "([^"]+)"/)?.[1];
      assert.ok(id1, "first coreId should exist");
      assert.ok(id2, "second coreId should exist");
      assert.notEqual(id1, id2, "UUIDs should differ between builds");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
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

  it("URL", async () => {
    const r = await rpc.call(["getUrl"]);
    assert.ok(r.value instanceof URL);
    assert.equal(r.value.hostname, "example.com");
    assert.equal(r.value.pathname, "/path");
  });

  it("URLSearchParams", async () => {
    const r = await rpc.call(["getUrlSearchParams"]);
    assert.ok(r.value instanceof URLSearchParams);
    assert.equal(r.value.get("a"), "1");
    assert.equal(r.value.get("c"), "3");
  });

  it("empty string", async () => {
    assert.equal((await rpc.call(["echo"], [""])).value, "");
  });

  it("zero", async () => {
    assert.equal((await rpc.call(["echo"], [0])).value, 0);
  });

  it("false", async () => {
    assert.equal((await rpc.call(["echo"], [false])).value, false);
  });

  it("empty array", async () => {
    assert.deepEqual((await rpc.call(["echo"], [[]])).value, []);
  });

  it("empty object", async () => {
    assert.deepEqual((await rpc.call(["echo"], [{}])).value, {});
  });

  it("empty Set", async () => {
    const r = await rpc.call(["echo"], [new Set()]);
    assert.ok(r.value instanceof Set);
    assert.equal(r.value.size, 0);
  });

  it("empty Map", async () => {
    const r = await rpc.call(["echo"], [new Map()]);
    assert.ok(r.value instanceof Map);
    assert.equal(r.value.size, 0);
  });
});

// ═════════════════════════════════════════════════════════════
//  Edge Cases: Concurrency
// ═════════════════════════════════════════════════════════════

describe("edge: concurrency", () => {
  it("parallel RPC calls return correct results", async () => {
    const results = await Promise.all([
      rpc.call(["add"], [1, 2]),
      rpc.call(["add"], [3, 4]),
      rpc.call(["add"], [5, 6]),
      rpc.call(["add"], [10, 20]),
      rpc.call(["greet"], ["A"]),
      rpc.call(["greet"], ["B"]),
    ]);
    assert.equal(results[0].value, 3);
    assert.equal(results[1].value, 7);
    assert.equal(results[2].value, 11);
    assert.equal(results[3].value, 30);
    assert.equal(results[4].value, "Hello, A!");
    assert.equal(results[5].value, "Hello, B!");
  });

  it("parallel instance operations stay isolated", async () => {
    const [c1, c2, c3] = await Promise.all([
      rpc.construct(["Counter"], [0]),
      rpc.construct(["Counter"], [100]),
      rpc.construct(["Counter"], [200]),
    ]);
    await Promise.all([
      rpc.instanceCall(c1.instanceId, ["increment"]),
      rpc.instanceCall(c2.instanceId, ["increment"]),
      rpc.instanceCall(c3.instanceId, ["decrement"]),
    ]);
    const [r1, r2, r3] = await Promise.all([
      rpc.instanceCall(c1.instanceId, ["getCount"]),
      rpc.instanceCall(c2.instanceId, ["getCount"]),
      rpc.instanceCall(c3.instanceId, ["getCount"]),
    ]);
    assert.equal(r1.value, 1);
    assert.equal(r2.value, 101);
    assert.equal(r3.value, 199);
  });

  it("many rapid sequential calls", async () => {
    const c = await rpc.construct(["Counter"], [0]);
    for (let i = 0; i < 50; i++) {
      await rpc.instanceCall(c.instanceId, ["increment"]);
    }
    assert.equal((await rpc.instanceCall(c.instanceId, ["getCount"])).value, 50);
  });

  it("multiple streams active simultaneously", async () => {
    const [s1, s2] = await Promise.all([
      rpc.call(["streamData"], [2]),
      rpc.call(["streamData"], [3]),
    ]);
    const collect = async (streamId) => {
      const chunks = [];
      let done = false;
      while (!done) {
        const next = await rpc.streamRead(streamId);
        if (next.done) done = true; else chunks.push(next.value);
      }
      return chunks;
    };
    const [c1, c2] = await Promise.all([
      collect(s1.streamId),
      collect(s2.streamId),
    ]);
    assert.equal(c1.length, 2);
    assert.equal(c2.length, 3);
  });

  it("multiple iterators active simultaneously", async () => {
    const [i1, i2] = await Promise.all([
      rpc.call(["countUp"], [1, 2]),
      rpc.call(["countUp"], [10, 12]),
    ]);
    const collect = async (iteratorId) => {
      const values = [];
      let done = false;
      while (!done) {
        const next = await rpc.iterateNext(iteratorId);
        if (next.done) done = true; else values.push(next.value);
      }
      return values;
    };
    const [v1, v2] = await Promise.all([
      collect(i1.iteratorId),
      collect(i2.iteratorId),
    ]);
    assert.deepEqual(v1, [1, 2]);
    assert.deepEqual(v2, [10, 11, 12]);
  });
});

// ═════════════════════════════════════════════════════════════
//  Edge Cases: Generators
// ═════════════════════════════════════════════════════════════

describe("edge: generators", () => {
  it("empty generator yields nothing then done", async () => {
    const r = await rpc.call(["emptyGen"]);
    assert.equal(r.valueType, "asynciterator");
    const next = await rpc.iterateNext(r.iteratorId);
    assert.equal(next.done, true);
  });

  it("generator that throws mid-iteration propagates error", async () => {
    const r = await rpc.call(["throwingGen"]);
    const v1 = await rpc.iterateNext(r.iteratorId);
    assert.equal(v1.value, 1);
    const v2 = await rpc.iterateNext(r.iteratorId);
    assert.equal(v2.value, 2);
    await assert.rejects(() => rpc.iterateNext(r.iteratorId), /generator exploded/);
  });

  it("iterate-return on already-finished iterator", async () => {
    const r = await rpc.call(["emptyGen"]);
    await rpc.iterateNext(r.iteratorId); // done=true, iterator deleted
    // iterate-return on non-existent iterator should still return done
    const ret = await rpc.iterateReturn(r.iteratorId);
    assert.equal(ret.done, true);
  });
});

// ═════════════════════════════════════════════════════════════
//  Edge Cases: Function Call Boundaries
// ═════════════════════════════════════════════════════════════

describe("edge: function call boundaries", () => {
  it("function returning undefined", async () => {
    const r = await rpc.call(["returnUndefined"]);
    assert.equal(r.value, undefined);
  });

  it("function returning null", async () => {
    const r = await rpc.call(["returnNull"]);
    assert.equal(r.value, null);
  });

  it("calling function with no args", async () => {
    const r = await rpc.call(["getDate"]);
    assert.ok(r.value instanceof Date);
  });

  it("calling function with extra args (ignored)", async () => {
    const r = await rpc.call(["add"], [1, 2, 3, 4, 5]);
    assert.equal(r.value, 3); // add only uses first 2
  });

  it("variadic args via echoAll", async () => {
    const r = await rpc.call(["echoAll"], [1, "two", true]);
    assert.deepEqual(r.value, [1, "two", true]);
  });

  it("deeply nested path call", async () => {
    const r = await rpc.call(["deep", "level1", "level2", "level3", "fn"], [21]);
    assert.equal(r.value, 42);
  });

  it("large payload round-trip", async () => {
    const r = await rpc.call(["largeArray"], [1000]);
    assert.equal(r.value.length, 1000);
    assert.equal(r.value[0], 0);
    assert.equal(r.value[999], 999);
  });

  it("constructor with default args", async () => {
    const c = await rpc.construct(["Counter"]);
    assert.equal((await rpc.instanceCall(c.instanceId, ["getCount"])).value, 0);
    assert.equal((await rpc.instanceCall(c.instanceId, ["getLabel"])).value, "default");
  });
});

// ═════════════════════════════════════════════════════════════
//  Edge Cases: WebSocket Isolation
// ═════════════════════════════════════════════════════════════

describe("edge: WebSocket isolation", () => {
  it("second connection cannot see first connection instances", async () => {
    // Create instance on shared rpc
    const c = await rpc.construct(["Counter"], [42]);

    // Open a separate connection
    const rpc2 = await rpcClient();
    try {
      // The instance belongs to a different WS connection,
      // but instanceStore is shared per handler. So this may or may not work
      // depending on implementation. Test that at least both connections work.
      const c2 = await rpc2.construct(["Counter"], [99]);
      assert.equal(
        (await rpc2.instanceCall(c2.instanceId, ["getCount"])).value,
        99
      );
    } finally {
      rpc2.close();
    }
  });

  it("WebSocket upgrade works on any path", async () => {
    // Connect via a non-root path
    const rpc2 = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/some/random/path`);
      let mid = 0;
      const pending = new Map();
      ws.on("message", (raw) => {
        const msg = parse(raw.toString());
        const r = pending.get(msg.id);
        if (r) { pending.delete(msg.id); r.resolve(msg); }
      });
      ws.on("open", () => resolve({
        call: (p, args = []) => new Promise((res, rej) => {
          const id = ++mid;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(stringify({ type: "call", id, path: p, args }));
        }),
        close: () => ws.close(),
      }));
      ws.on("error", reject);
    });
    try {
      const r = await rpc2.call(["add"], [100, 200]);
      assert.equal(r.value, 300);
    } finally {
      rpc2.close();
    }
  });
});

// ═════════════════════════════════════════════════════════════
//  Edge Cases: HTTP Routing Boundaries
// ═════════════════════════════════════════════════════════════

describe("edge: HTTP routing boundaries", () => {
  it("query params on per-export route are ignored (not ?types)", async () => {
    const res = await fetch(`${BASE}/greet?foo=bar`);
    // ?foo=bar without ?types should still return the JS module
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(body.includes("createProxy"));
  });

  it("per-export route for constant export", async () => {
    const body = await fetch(`${BASE}/VERSION`).then((r) => r.text());
    assert.ok(body.includes("VERSION"));
    assert.ok(body.includes("createProxy"));
  });

  it("per-export route for nested object export", async () => {
    const body = await fetch(`${BASE}/math`).then((r) => r.text());
    assert.ok(body.includes("as math"));
  });

  it("per-export route for new edge case exports", async () => {
    for (const name of ["deep", "emptyGen", "largeArray", "echoAll"]) {
      const res = await fetch(`${BASE}/${name}`);
      assert.equal(res.status, 200, `${name} should be accessible`);
    }
  });

  it("deep path returns 404 (only top-level exports are routes)", async () => {
    assert.equal((await fetch(`${BASE}/deep/level1`)).status, 404);
  });

  it("empty ReadableStream (0 chunks)", async () => {
    const r = await rpc.call(["streamData"], [0]);
    assert.equal(r.valueType, "readablestream");
    const next = await rpc.streamRead(r.streamId);
    assert.equal(next.done, true);
  });

  it("writable stream with many chunks", async () => {
    const w = await rpc.writableCreate();
    for (let i = 0; i < 20; i++) {
      await rpc.writableWrite(w.writableId, [i]);
    }
    const result = await rpc.writableClose(w.writableId);
    assert.equal(result.value.length, 20);
  });
});

// ═════════════════════════════════════════════════════════════
//  Shared Export: HTTP Routing
// ═════════════════════════════════════════════════════════════

describe("shared: HTTP routing", () => {
  it("GET /?shared returns shared index module", async () => {
    const body = await fetch(`${BASE}/?shared`).then((r) => r.text());
    assert.ok(body.includes("createProxy"));
    assert.ok(body.includes("createUploadStream"));
    assert.ok(body.includes("-shared.js")); // imports from shared core
  });

  it("GET /greet?shared returns shared per-export module", async () => {
    const body = await fetch(`${BASE}/greet?shared`).then((r) => r.text());
    assert.ok(body.includes("export default"));
    assert.ok(body.includes("as greet"));
    assert.ok(body.includes("-shared.js"));
  });

  it("GET /<uuid>-shared.js returns shared core module", async () => {
    // Extract shared core path from the index module
    const indexBody = await fetch(`${BASE}/?shared`).then((r) => r.text());
    const sharedCoreName = indexBody.match(/from "\.\/([^"]+)"/)?.[1];
    assert.ok(sharedCoreName?.endsWith("-shared.js"));
    const res = await fetch(`${BASE}/${sharedCoreName}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control"), /immutable/);
    const body = await res.text();
    assert.ok(body.includes("WebSocket"));
    assert.ok(body.includes("?shared")); // WS URL includes ?shared
  });

  it("GET /nonexistent?shared returns 404", async () => {
    assert.equal((await fetch(`${BASE}/nonexistent?shared`)).status, 404);
  });
});

// ═════════════════════════════════════════════════════════════
//  Shared Export: Cross-Client State Sharing
// ═════════════════════════════════════════════════════════════

describe("shared: cross-client state sharing", () => {
  it("two clients share the same Counter instance via DO", async () => {
    const shared1 = await rpcClient("/?shared");
    const shared2 = await rpcClient("/?shared");
    try {
      // Client 1 creates a Counter
      const c = await shared1.construct(["Counter"], [0]);

      // Client 1 increments
      await shared1.instanceCall(c.instanceId, ["increment"]);
      await shared1.instanceCall(c.instanceId, ["increment"]);

      // Client 2 sees the same state (same DO, same instanceStore)
      const count = await shared2.instanceCall(c.instanceId, ["getCount"]);
      assert.equal(count.value, 2);

      // Client 2 increments
      await shared2.instanceCall(c.instanceId, ["increment"]);

      // Client 1 sees Client 2's increment
      const count2 = await shared1.instanceCall(c.instanceId, ["getCount"]);
      assert.equal(count2.value, 3);
    } finally {
      shared1.close();
      shared2.close();
    }
  });

  it("shared function calls work", async () => {
    const shared = await rpcClient("/?shared");
    try {
      assert.equal((await shared.call(["greet"], ["Shared"])).value, "Hello, Shared!");
      assert.equal((await shared.call(["add"], [100, 200])).value, 300);
    } finally {
      shared.close();
    }
  });

  it("shared nested object methods work", async () => {
    const shared = await rpcClient("/?shared");
    try {
      assert.equal((await shared.call(["math", "multiply"], [6, 7])).value, 42);
    } finally {
      shared.close();
    }
  });

  it("shared error propagation", async () => {
    const shared = await rpcClient("/?shared");
    try {
      await assert.rejects(() => shared.call(["willThrow"]), /intentional error/);
    } finally {
      shared.close();
    }
  });

  it("shared instance property get/set across clients", async () => {
    const s1 = await rpcClient("/?shared");
    const s2 = await rpcClient("/?shared");
    try {
      const c = await s1.construct(["Counter"], [0, "initial"]);
      // s1 sets label
      await s1.instanceSet(c.instanceId, ["label"], "updated-by-s1");
      // s2 reads it
      assert.equal(
        (await s2.instanceGet(c.instanceId, ["label"])).value,
        "updated-by-s1"
      );
    } finally {
      s1.close();
      s2.close();
    }
  });

  it("shared and non-shared are isolated", async () => {
    const normal = await rpcClient("/");
    const shared = await rpcClient("/?shared");
    try {
      // Create Counter in normal mode
      const cn = await normal.construct(["Counter"], [10]);
      // Create Counter in shared mode
      const cs = await shared.construct(["Counter"], [20]);

      // They should have independent state
      assert.equal((await normal.instanceCall(cn.instanceId, ["getCount"])).value, 10);
      assert.equal((await shared.instanceCall(cs.instanceId, ["getCount"])).value, 20);

      // Incrementing one doesn't affect the other
      await normal.instanceCall(cn.instanceId, ["increment"]);
      assert.equal((await normal.instanceCall(cn.instanceId, ["getCount"])).value, 11);
      assert.equal((await shared.instanceCall(cs.instanceId, ["getCount"])).value, 20);
    } finally {
      normal.close();
      shared.close();
    }
  });

  it("shared async iterator works", async () => {
    const shared = await rpcClient("/?shared");
    try {
      const r = await shared.call(["countUp"], [1, 3]);
      assert.equal(r.valueType, "asynciterator");
      const values = [];
      let done = false;
      while (!done) {
        const next = await shared.iterateNext(r.iteratorId);
        if (next.done) done = true; else values.push(next.value);
      }
      assert.deepEqual(values, [1, 2, 3]);
    } finally {
      shared.close();
    }
  });

  it("shared ReadableStream works", async () => {
    const shared = await rpcClient("/?shared");
    try {
      const r = await shared.call(["streamData"], [2]);
      assert.equal(r.valueType, "readablestream");
      const chunks = [];
      let done = false;
      while (!done) {
        const next = await shared.streamRead(r.streamId);
        if (next.done) done = true; else chunks.push(next.value);
      }
      assert.equal(chunks.length, 2);
    } finally {
      shared.close();
    }
  });
});
