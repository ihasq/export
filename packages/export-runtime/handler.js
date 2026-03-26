import { stringify, parse } from "devalue";
import { CORE_CODE } from "./client.js";

const getByPath = (obj, path) => {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
};

const isAsyncIterable = (value) =>
  value != null && typeof value[Symbol.asyncIterator] === "function";

const isReadableStream = (value) =>
  value != null && typeof value.getReader === "function" && typeof value.pipeTo === "function";

const isClass = (fn) =>
  typeof fn === "function" && /^class\s/.test(Function.prototype.toString.call(fn));

// Runtime fallback: generate TypeScript type definitions from exports
const generateTypeDefinitions = (exports, keys) => {
  const lines = [
    "// Auto-generated type definitions",
    "// All functions are async over the network",
    "",
  ];

  for (const name of keys) {
    const value = exports[name];
    if (isClass(value)) {
      const proto = value.prototype;
      const methodNames = Object.getOwnPropertyNames(proto).filter(
        (n) => n !== "constructor" && typeof proto[n] === "function"
      );
      lines.push(`export declare class ${name} {`);
      lines.push(`  constructor(...args: any[]);`);
      for (const method of methodNames) {
        lines.push(`  ${method}(...args: any[]): Promise<any>;`);
      }
      lines.push(`  [Symbol.dispose](): Promise<void>;`);
      lines.push(`  "[release]"(): Promise<void>;`);
      lines.push(`}`);
    } else if (typeof value === "function") {
      const fnStr = Function.prototype.toString.call(value);
      if (fnStr.startsWith("async function*") || fnStr.includes("async *")) {
        lines.push(`export declare function ${name}(...args: any[]): Promise<AsyncIterable<any>>;`);
      } else if (fnStr.includes("ReadableStream")) {
        lines.push(`export declare function ${name}(...args: any[]): Promise<ReadableStream<any>>;`);
      } else {
        lines.push(`export declare function ${name}(...args: any[]): Promise<any>;`);
      }
    } else if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      lines.push(`export declare const ${name}: {`);
      for (const key of keys) {
        const v = value[key];
        if (typeof v === "function") {
          lines.push(`  ${key}(...args: any[]): Promise<any>;`);
        } else {
          lines.push(`  ${key}: any;`);
        }
      }
      lines.push(`};`);
    } else {
      lines.push(`export declare const ${name}: any;`);
    }
    lines.push("");
  }

  lines.push("export declare function createUploadStream(): Promise<{");
  lines.push("  stream: WritableStream<any>;");
  lines.push("  writableId: number;");
  lines.push("}>;");

  return lines.join("\n");
};


const jsHeaders = (extra = {}) => ({
  "Content-Type": "application/javascript; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  ...extra,
});

const tsHeaders = () => ({
  "Content-Type": "application/typescript; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-cache",
});

export const createHandler = (exports, generatedTypes, minifiedCore, coreId) => {
  const exportKeys = Object.keys(exports);
  const iteratorStore = new Map();
  const instanceStore = new Map();
  const streamStore = new Map();
  const writableStreamStore = new Map();
  let nextIteratorId = 1;
  let nextInstanceId = 1;
  let nextStreamId = 1;

  const send = (ws, data) => {
    ws.send(stringify(data));
  };

  const coreModuleCode = minifiedCore || CORE_CODE;
  const corePath = `/${coreId || crypto.randomUUID()}.js`;

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      // --- WebSocket upgrade (path-agnostic) ---
      if (upgradeHeader === "websocket") {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.accept();

        server.addEventListener("message", async (event) => {
          try {
            const msg = parse(event.data);
            const { type, id, path = [], args = [], iteratorId, instanceId } = msg;

            if (type === "ping") {
              send(server, { type: "pong", id });
              return;
            }

            if (type === "construct") {
              try {
                const Ctor = getByPath(exports, path);
                if (!isClass(Ctor)) {
                  send(server, { type: "error", id, error: `${path.join(".")} is not a class` });
                  return;
                }
                const instance = new Ctor(...args);
                const instId = nextInstanceId++;
                instanceStore.set(instId, instance);
                send(server, { type: "result", id, instanceId: instId, valueType: "instance" });
              } catch (err) {
                send(server, { type: "error", id, error: String(err) });
              }
            } else if (type === "call") {
              try {
                let target;
                let thisArg;

                if (instanceId !== undefined) {
                  const instance = instanceStore.get(instanceId);
                  if (!instance) {
                    send(server, { type: "error", id, error: "Instance not found" });
                    return;
                  }
                  target = getByPath(instance, path);
                  thisArg = path.length > 1 ? getByPath(instance, path.slice(0, -1)) : instance;
                } else {
                  target = getByPath(exports, path);
                  thisArg = path.length > 1 ? getByPath(exports, path.slice(0, -1)) : undefined;
                }

                if (typeof target !== "function") {
                  send(server, { type: "error", id, error: `${path.join(".")} is not a function` });
                  return;
                }

                const result = await target.apply(thisArg, args);

                if (isReadableStream(result)) {
                  const streamId = nextStreamId++;
                  streamStore.set(streamId, { stream: result, reader: null });
                  send(server, { type: "result", id, streamId, valueType: "readablestream" });
                } else if (isAsyncIterable(result)) {
                  const iterId = nextIteratorId++;
                  iteratorStore.set(iterId, result[Symbol.asyncIterator]());
                  send(server, { type: "result", id, iteratorId: iterId, valueType: "asynciterator" });
                } else if (typeof result === "function") {
                  send(server, { type: "result", id, path: [...path], valueType: "function" });
                } else {
                  send(server, { type: "result", id, value: result });
                }
              } catch (err) {
                send(server, { type: "error", id, error: String(err) });
              }
            } else if (type === "get") {
              try {
                const instance = instanceStore.get(instanceId);
                if (!instance) {
                  send(server, { type: "error", id, error: "Instance not found" });
                  return;
                }
                const value = getByPath(instance, path);
                if (typeof value === "function") {
                  send(server, { type: "result", id, valueType: "function" });
                } else {
                  send(server, { type: "result", id, value });
                }
              } catch (err) {
                send(server, { type: "error", id, error: String(err) });
              }
            } else if (type === "set") {
              try {
                const instance = instanceStore.get(instanceId);
                if (!instance) {
                  send(server, { type: "error", id, error: "Instance not found" });
                  return;
                }
                const parent = path.length > 1 ? getByPath(instance, path.slice(0, -1)) : instance;
                const prop = path[path.length - 1];
                parent[prop] = args[0];
                send(server, { type: "result", id, value: true });
              } catch (err) {
                send(server, { type: "error", id, error: String(err) });
              }
            } else if (type === "release") {
              instanceStore.delete(instanceId);
              send(server, { type: "result", id, value: true });
            } else if (type === "iterate-next") {
              const iter = iteratorStore.get(iteratorId);
              if (!iter) {
                send(server, { type: "error", id, error: "Iterator not found" });
                return;
              }
              try {
                const { value, done } = await iter.next();
                if (done) iteratorStore.delete(iteratorId);
                send(server, { type: "iterate-result", id, value, done: !!done });
              } catch (err) {
                send(server, { type: "error", id, error: String(err) });
              }
            } else if (type === "iterate-return") {
              const iter = iteratorStore.get(iteratorId);
              if (iter?.return) await iter.return(undefined);
              iteratorStore.delete(iteratorId);
              send(server, { type: "iterate-result", id, value: undefined, done: true });
            } else if (type === "stream-read") {
              const { streamId } = msg;
              const entry = streamStore.get(streamId);
              if (!entry) {
                send(server, { type: "error", id, error: "Stream not found" });
                return;
              }
              try {
                let reader = entry.reader;
                if (!reader) {
                  reader = entry.stream.getReader();
                  entry.reader = reader;
                }
                const { value, done } = await reader.read();
                if (done) {
                  streamStore.delete(streamId);
                }
                const serializedValue = value instanceof Uint8Array ? Array.from(value) : value;
                send(server, { type: "stream-result", id, value: serializedValue, done: !!done });
              } catch (err) {
                streamStore.delete(streamId);
                send(server, { type: "error", id, error: String(err) });
              }
            } else if (type === "stream-cancel") {
              const { streamId } = msg;
              const entry = streamStore.get(streamId);
              if (entry) {
                try {
                  if (entry.reader) {
                    await entry.reader.cancel();
                  } else {
                    await entry.stream.cancel();
                  }
                } catch (e) { /* ignore */ }
                streamStore.delete(streamId);
              }
              send(server, { type: "result", id, value: true });
            } else if (type === "writable-create") {
              const { targetPath, targetInstanceId } = msg;
              let chunks = [];
              const writableId = nextStreamId++;

              const writable = new WritableStream({
                write(chunk) { chunks.push(chunk); },
                close() {},
                abort(reason) { chunks = []; }
              });

              writableStreamStore.set(writableId, { writable, chunks, targetPath, targetInstanceId });
              send(server, { type: "result", id, writableId, valueType: "writablestream" });
            } else if (type === "writable-write") {
              const { writableId, chunk } = msg;
              const entry = writableStreamStore.get(writableId);
              if (!entry) {
                send(server, { type: "error", id, error: "WritableStream not found" });
                return;
              }
              try {
                const data = Array.isArray(chunk) ? new Uint8Array(chunk) : chunk;
                entry.chunks.push(data);
                send(server, { type: "result", id, value: true });
              } catch (err) {
                send(server, { type: "error", id, error: String(err) });
              }
            } else if (type === "writable-close") {
              const { writableId } = msg;
              const entry = writableStreamStore.get(writableId);
              if (!entry) {
                send(server, { type: "error", id, error: "WritableStream not found" });
                return;
              }
              writableStreamStore.delete(writableId);
              send(server, { type: "result", id, value: entry.chunks });
            } else if (type === "writable-abort") {
              const { writableId } = msg;
              writableStreamStore.delete(writableId);
              send(server, { type: "result", id, value: true });
            }
          } catch (err) {
            console.error("WebSocket message error:", err);
          }
        });

        server.addEventListener("close", () => {
          iteratorStore.clear();
          instanceStore.clear();
          streamStore.clear();
          writableStreamStore.clear();
        });

        return new Response(null, { status: 101, webSocket: client });
      }

      // --- HTTP routing ---

      const fullTypes = generatedTypes || generateTypeDefinitions(exports, exportKeys);
      const pathname = url.pathname;

      // Serve core module — long-cached, content-independent of deployment URL
      if (pathname === corePath) {
        return new Response(coreModuleCode, {
          headers: jsHeaders({ "Cache-Control": "public, max-age=31536000, immutable" }),
        });
      }

      // Type definitions
      if (url.searchParams.has("types") || pathname.endsWith(".d.ts")) {
        if (pathname === "/" || pathname.endsWith(".d.ts")) {
          return new Response(fullTypes, { headers: tsHeaders() });
        }
        // Per-export types — re-export from root to avoid duplication
        const name = pathname.slice(1);
        if (exportKeys.includes(name)) {
          const code = `export { ${name} as default, ${name} } from "./?types";`;
          return new Response(code, { headers: tsHeaders() });
        }
        return new Response("// Export not found", { status: 404, headers: tsHeaders() });
      }

      const baseUrl = `${url.protocol}//${url.host}`;

      // Root — re-exports all from ${corePath}
      if (pathname === "/") {
        const namedExports = exportKeys
          .map((key) => `export const ${key} = createProxy([${JSON.stringify(key)}]);`)
          .join("\n");
        const code = [
          `import { createProxy, createUploadStream } from ".${corePath}";`,
          namedExports,
          `export { createUploadStream };`,
        ].join("\n");

        return new Response(code, {
          headers: jsHeaders({
            "Cache-Control": "no-cache",
            "X-TypeScript-Types": `${baseUrl}/?types`,
          }),
        });
      }

      // Per-export path — e.g. /greet, /Counter
      const exportName = pathname.slice(1);
      if (exportKeys.includes(exportName)) {
        const code = [
          `import { createProxy } from ".${corePath}";`,
          `const _export = createProxy([${JSON.stringify(exportName)}]);`,
          `export default _export;`,
          `export { _export as ${exportName} };`,
        ].join("\n");

        return new Response(code, {
          headers: jsHeaders({
            "Cache-Control": "no-cache",
            "X-TypeScript-Types": `${baseUrl}/${exportName}?types`,
          }),
        });
      }

      return new Response("Not found", { status: 404 });
    },
  };
};
