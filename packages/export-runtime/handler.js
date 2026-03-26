import { stringify, parse } from "devalue";
import { CORE_CODE, SHARED_CORE_CODE } from "./client.js";
import { createRpcDispatcher } from "./rpc.js";

const JS = "application/javascript; charset=utf-8";
const TS = "application/typescript; charset=utf-8";
const CORS = { "Access-Control-Allow-Origin": "*" };
const IMMUTABLE = "public, max-age=31536000, immutable";

const jsResponse = (body, extra = {}) =>
  new Response(body, { headers: { "Content-Type": JS, ...CORS, ...extra } });

const tsResponse = (body, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": TS, ...CORS, "Cache-Control": "no-cache" } });

export const createHandler = (exports, generatedTypes, minifiedCore, coreId, minifiedSharedCore) => {
  const exportKeys = Object.keys(exports);

  const coreModuleCode = minifiedCore || CORE_CODE;
  const sharedCoreModuleCode = minifiedSharedCore || SHARED_CORE_CODE;
  const corePath = `/${coreId || crypto.randomUUID()}.js`;
  const sharedCorePath = corePath.replace(".js", "-shared.js");

  // Pre-generate the named exports string (same for shared and normal, only import source differs)
  const namedExportsCode = exportKeys
    .map((key) => `export const ${key} = createProxy([${JSON.stringify(key)}]);`)
    .join("\n");

  const buildIndexModule = (cpath) =>
    `import { createProxy } from ".${cpath}";\n${namedExportsCode}`;

  const buildExportModule = (cpath, name) =>
    `import { createProxy } from ".${cpath}";\nconst _export = createProxy([${JSON.stringify(name)}]);\nexport default _export;\nexport { _export as ${name} };`;

  // Dispatch a parsed devalue message to an RPC dispatcher
  const dispatchMessage = async (dispatcher, msg) => {
    const { type, path = [], args = [], instanceId, iteratorId, streamId } = msg;
    switch (type) {
      case "ping": return { type: "pong" };
      case "call":
        return instanceId !== undefined
          ? dispatcher.rpcInstanceCall(instanceId, path, args)
          : dispatcher.rpcCall(path, args);
      case "construct": return dispatcher.rpcConstruct(path, args);
      case "get": return dispatcher.rpcGet(instanceId, path);
      case "set": return dispatcher.rpcSet(instanceId, path, args[0]);
      case "release": return dispatcher.rpcRelease(instanceId);
      case "iterate-next": return dispatcher.rpcIterateNext(iteratorId);
      case "iterate-return": return dispatcher.rpcIterateReturn(iteratorId);
      case "stream-read": return dispatcher.rpcStreamRead(streamId);
      case "stream-cancel": return dispatcher.rpcStreamCancel(streamId);
    }
  };

  const wireWebSocket = (server, dispatcher, onClose) => {
    server.addEventListener("message", async (event) => {
      let id;
      try {
        const msg = parse(event.data);
        id = msg.id;
        const result = await dispatchMessage(dispatcher, msg);
        if (result) server.send(stringify({ ...result, id }));
      } catch (err) {
        if (id !== undefined) server.send(stringify({ type: "error", id, error: String(err) }));
      }
    });
    if (onClose) server.addEventListener("close", onClose);
  };

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const isShared = url.searchParams.has("shared");

      // --- WebSocket upgrade ---
      if (request.headers.get("Upgrade") === "websocket") {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();

        if (isShared && env?.SHARED_EXPORT) {
          const room = url.searchParams.get("room") || "default";
          const stub = env.SHARED_EXPORT.get(env.SHARED_EXPORT.idFromName(room));
          wireWebSocket(server, stub);
        } else {
          const dispatcher = createRpcDispatcher(exports);
          wireWebSocket(server, dispatcher, () => dispatcher.clearAll());
        }

        return new Response(null, { status: 101, webSocket: client });
      }

      // --- HTTP routing ---
      const pathname = url.pathname;

      // Core modules (cached immutably)
      if (pathname === corePath) return jsResponse(coreModuleCode, { "Cache-Control": IMMUTABLE });
      if (pathname === sharedCorePath) return jsResponse(sharedCoreModuleCode, { "Cache-Control": IMMUTABLE });

      // Type definitions
      if (url.searchParams.has("types")) {
        if (pathname === "/") return tsResponse(generatedTypes || "");
        const name = pathname.slice(1);
        return exportKeys.includes(name)
          ? tsResponse(`export { ${name} as default, ${name} } from "./?types";`)
          : tsResponse("// Export not found", 404);
      }
      if (pathname.endsWith(".d.ts")) return tsResponse(generatedTypes || "");

      const baseUrl = `${url.protocol}//${url.host}`;
      const cpath = isShared ? sharedCorePath : corePath;

      // Root module
      if (pathname === "/") {
        return jsResponse(buildIndexModule(cpath), {
          "Cache-Control": "no-cache",
          "X-TypeScript-Types": `${baseUrl}/?types`,
        });
      }

      // Per-export module
      const exportName = pathname.slice(1);
      if (exportKeys.includes(exportName)) {
        return jsResponse(buildExportModule(cpath, exportName), {
          "Cache-Control": "no-cache",
          "X-TypeScript-Types": `${baseUrl}/${exportName}?types`,
        });
      }

      return new Response("Not found", { status: 404 });
    },
  };
};
