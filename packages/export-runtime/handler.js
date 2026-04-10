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

export const createHandler = (moduleMap, generatedTypes, minifiedCore, coreId, minifiedSharedCore) => {
  // moduleMap: { routePath: moduleNamespace, ... }
  const moduleRoutes = Object.keys(moduleMap); // e.g. ["", "greet", "utils/math"]
  const moduleExportKeys = {};
  for (const [route, mod] of Object.entries(moduleMap)) {
    const keys = Object.keys(mod);
    if (keys.includes("default")) {
      const modulePath = route || "(root)";
      console.warn(`[export-runtime] WARN: default export in "${modulePath}" is ignored. Use named exports instead.`);
    }
    moduleExportKeys[route] = keys.filter(k => k !== "default");
  }

  const coreModuleCode = minifiedCore || CORE_CODE;
  const sharedCoreModuleCode = minifiedSharedCore || SHARED_CORE_CODE;
  const corePath = `/${coreId || crypto.randomUUID()}.js`;
  const sharedCorePath = corePath.replace(".js", "-shared.js");

  // Resolve a URL pathname to { route, exportName } or null
  const resolveRoute = (pathname) => {
    const p = pathname === "/" ? "" : pathname.slice(1);

    // Exact module match: /greet → route "greet", /utils/math → route "utils/math"
    if (moduleRoutes.includes(p)) {
      return { route: p, exportName: null };
    }

    // Try parent as module, last segment as export: /greet/foo → route "greet", export "foo"
    const lastSlash = p.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentRoute = p.slice(0, lastSlash);
      const name = p.slice(lastSlash + 1);
      if (moduleRoutes.includes(parentRoute) && moduleExportKeys[parentRoute]?.includes(name)) {
        return { route: parentRoute, exportName: name };
      }
    }

    // Root module export: /greet → route "", export "greet" (only if no module named "greet")
    if (moduleExportKeys[""]?.includes(p) && !p.includes("/")) {
      return { route: "", exportName: p };
    }

    return null;
  };

  const buildIndexModule = (cpath, route) => {
    const keys = moduleExportKeys[route] || [];
    const namedExports = keys
      .map((key) => `export const ${key} = createProxy([${JSON.stringify(route)}, ${JSON.stringify(key)}]);`)
      .join("\n");
    return `import { createProxy } from ".${cpath}";\n${namedExports}`;
  };

  const buildExportModule = (cpath, route, name) =>
    `import { createProxy } from ".${cpath}";\n` +
    `const _export = createProxy([${JSON.stringify(route)}, ${JSON.stringify(name)}]);\n` +
    `export default _export;\nexport { _export as ${name} };`;

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
          const dispatcher = createRpcDispatcher(moduleMap);
          wireWebSocket(server, dispatcher, () => dispatcher.clearAll());
        }

        return new Response(null, { status: 101, webSocket: client });
      }

      // --- HTTP routing ---
      const pathname = url.pathname;

      // Core modules
      if (pathname === corePath) return jsResponse(coreModuleCode, { "Cache-Control": IMMUTABLE });
      if (pathname === sharedCorePath) return jsResponse(sharedCoreModuleCode, { "Cache-Control": IMMUTABLE });

      // Type definitions
      if (url.searchParams.has("types")) {
        const p = pathname === "/" ? "" : pathname.slice(1);
        // Module types
        if (generatedTypes?.[p] !== undefined) {
          return tsResponse(generatedTypes[p]);
        }
        // Per-export re-export
        const resolved = resolveRoute(pathname);
        if (resolved?.exportName) {
          const routeTypesPath = resolved.route ? `./${resolved.route}?types` : "./?types";
          const code = `export { ${resolved.exportName} as default, ${resolved.exportName} } from "${routeTypesPath}";`;
          return tsResponse(code);
        }
        return tsResponse("// Not found", 404);
      }
      if (pathname.endsWith(".d.ts")) {
        return tsResponse(generatedTypes?.[""] || "");
      }

      const baseUrl = `${url.protocol}//${url.host}`;
      const cpath = isShared ? sharedCorePath : corePath;

      const resolved = resolveRoute(pathname);
      if (!resolved) {
        // Fallback to static assets if ASSETS binding is available
        if (env?.ASSETS) {
          return env.ASSETS.fetch(request);
        }
        return new Response("Not found", { status: 404 });
      }

      const { route, exportName } = resolved;

      if (exportName) {
        // Per-export module
        return jsResponse(buildExportModule(cpath, route, exportName), {
          "Cache-Control": "no-cache",
          "X-TypeScript-Types": `${baseUrl}${pathname}?types`,
        });
      }

      // Module index
      const typesPath = route ? `${baseUrl}/${route}?types` : `${baseUrl}/?types`;
      return jsResponse(buildIndexModule(cpath, route), {
        "Cache-Control": "no-cache",
        "X-TypeScript-Types": typesPath,
      });
    },
  };
};
