import { stringify, parse } from "devalue";
import { CORE_CODE, SHARED_CORE_CODE } from "./client.js";
import { createRpcDispatcher } from "./rpc.js";

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

// Runtime fallback: generate TypeScript type definitions from exports
const generateTypeDefinitions = (exports, keys) => {
  const isClass = (fn) =>
    typeof fn === "function" && /^class\s/.test(Function.prototype.toString.call(fn));

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
      const objKeys = Object.keys(value);
      lines.push(`export declare const ${name}: {`);
      for (const key of objKeys) {
        if (typeof value[key] === "function") {
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

export const createHandler = (exports, generatedTypes, minifiedCore, coreId, minifiedSharedCore) => {
  const exportKeys = Object.keys(exports);

  const coreModuleCode = minifiedCore || CORE_CODE;
  const sharedCoreModuleCode = minifiedSharedCore || SHARED_CORE_CODE;
  const corePath = `/${coreId || crypto.randomUUID()}.js`;
  const sharedCorePath = corePath.replace(".js", "-shared.js");

  // Send devalue-encoded message over WebSocket
  const send = (ws, data) => {
    ws.send(stringify(data));
  };

  // Dispatch a parsed devalue message to an RPC dispatcher, return response object
  const dispatchMessage = async (dispatcher, msg) => {
    const { type, path = [], args = [], instanceId, iteratorId, streamId, writableId, chunk } = msg;

    switch (type) {
      case "ping": return { type: "pong" };
      case "call":
        if (instanceId !== undefined) return dispatcher.rpcInstanceCall(instanceId, path, args);
        return dispatcher.rpcCall(path, args);
      case "construct": return dispatcher.rpcConstruct(path, args);
      case "get": return dispatcher.rpcGet(instanceId, path);
      case "set": return dispatcher.rpcSet(instanceId, path, args[0]);
      case "release": return dispatcher.rpcRelease(instanceId);
      case "iterate-next": return dispatcher.rpcIterateNext(iteratorId);
      case "iterate-return": return dispatcher.rpcIterateReturn(iteratorId);
      case "stream-read": return dispatcher.rpcStreamRead(streamId);
      case "stream-cancel": return dispatcher.rpcStreamCancel(streamId);
      case "writable-create": return dispatcher.rpcWritableCreate();
      case "writable-write": return dispatcher.rpcWritableWrite(writableId, chunk);
      case "writable-close": return dispatcher.rpcWritableClose(writableId);
      case "writable-abort": return dispatcher.rpcWritableAbort(writableId);
    }
  };

  // Wire a WebSocket to a dispatcher (used for both normal and shared-bridge modes)
  const wireWebSocket = (server, dispatcher, onClose) => {
    server.addEventListener("message", async (event) => {
      try {
        const msg = parse(event.data);
        const result = await dispatchMessage(dispatcher, msg);
        if (result) send(server, { ...result, id: msg.id });
      } catch (err) {
        try {
          const msg = parse(event.data);
          send(server, { type: "error", id: msg.id, error: String(err) });
        } catch {
          console.error("WebSocket message error:", err);
        }
      }
    });
    if (onClose) server.addEventListener("close", onClose);
  };

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");
      const isShared = url.searchParams.has("shared");

      // --- WebSocket upgrade ---
      if (upgradeHeader === "websocket") {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();

        if (isShared && env?.SHARED_EXPORT) {
          // Shared mode: bridge WebSocket to Durable Object via Workers RPC
          const roomName = url.searchParams.get("room") || "default";
          const stub = env.SHARED_EXPORT.get(env.SHARED_EXPORT.idFromName(roomName));

          // Create a bridge dispatcher that forwards to the DO stub
          const bridgeDispatcher = {
            rpcCall: (path, args) => stub.rpcCall(path, args),
            rpcConstruct: (path, args) => stub.rpcConstruct(path, args),
            rpcInstanceCall: (iid, path, args) => stub.rpcInstanceCall(iid, path, args),
            rpcGet: (iid, path) => stub.rpcGet(iid, path),
            rpcSet: (iid, path, value) => stub.rpcSet(iid, path, value),
            rpcRelease: (iid) => stub.rpcRelease(iid),
            rpcIterateNext: (iid) => stub.rpcIterateNext(iid),
            rpcIterateReturn: (iid) => stub.rpcIterateReturn(iid),
            rpcStreamRead: (sid) => stub.rpcStreamRead(sid),
            rpcStreamCancel: (sid) => stub.rpcStreamCancel(sid),
            rpcWritableCreate: () => stub.rpcWritableCreate(),
            rpcWritableWrite: (wid, chunk) => stub.rpcWritableWrite(wid, chunk),
            rpcWritableClose: (wid) => stub.rpcWritableClose(wid),
            rpcWritableAbort: (wid) => stub.rpcWritableAbort(wid),
          };

          wireWebSocket(server, bridgeDispatcher);
        } else {
          // Normal mode: per-connection state
          const dispatcher = createRpcDispatcher(exports);
          wireWebSocket(server, dispatcher, () => dispatcher.clearAll());
        }

        return new Response(null, { status: 101, webSocket: client });
      }

      // --- HTTP routing ---

      const fullTypes = generatedTypes || generateTypeDefinitions(exports, exportKeys);
      const pathname = url.pathname;
      const baseUrl = `${url.protocol}//${url.host}`;

      // Core modules (cached immutably)
      if (pathname === corePath) {
        return new Response(coreModuleCode, {
          headers: jsHeaders({ "Cache-Control": "public, max-age=31536000, immutable" }),
        });
      }
      if (pathname === sharedCorePath) {
        return new Response(sharedCoreModuleCode, {
          headers: jsHeaders({ "Cache-Control": "public, max-age=31536000, immutable" }),
        });
      }

      // Type definitions
      if (url.searchParams.has("types")) {
        if (pathname === "/") {
          return new Response(fullTypes, { headers: tsHeaders() });
        }
        const name = pathname.slice(1);
        if (exportKeys.includes(name)) {
          const code = `export { ${name} as default, ${name} } from "./?types";`;
          return new Response(code, { headers: tsHeaders() });
        }
        return new Response("// Export not found", { status: 404, headers: tsHeaders() });
      }

      // .d.ts path
      if (pathname.endsWith(".d.ts")) {
        return new Response(fullTypes, { headers: tsHeaders() });
      }

      // Shared mode ESM modules
      if (isShared) {
        if (pathname === "/") {
          const namedExports = exportKeys
            .map((key) => `export const ${key} = createProxy([${JSON.stringify(key)}]);`)
            .join("\n");
          const code = [
            `import { createProxy, createUploadStream } from ".${sharedCorePath}";`,
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

        const exportName = pathname.slice(1);
        if (exportKeys.includes(exportName)) {
          const code = [
            `import { createProxy } from ".${sharedCorePath}";`,
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
      }

      // Normal mode ESM modules
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
