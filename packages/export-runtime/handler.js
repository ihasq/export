import { stringify, parse } from "devalue";
import { generateCoreCode, CORE_CODE, SHARED_CORE_CODE } from "./client.js";
import { createRpcDispatcher } from "./rpc.js";
import { handleAuthRoute, getSessionFromRequest, verifySession } from "./auth.js";

const JS = "application/javascript; charset=utf-8";
const TS = "application/typescript; charset=utf-8";
const CORS = { "Access-Control-Allow-Origin": "*" };
const IMMUTABLE = "public, max-age=31536000, immutable";

const jsResponse = (body, extra = {}) =>
  new Response(body, { headers: { "Content-Type": JS, ...CORS, ...extra } });

const tsResponse = (body, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": TS, ...CORS, "Cache-Control": "no-cache" } });

export const createHandler = (moduleMap, generatedTypes, minifiedCore, coreId, minifiedSharedCore, exportConfig = {}) => {
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

  // Export configuration
  const { d1Bindings = [], r2Bindings = [], kvBindings = [], authConfig = null } = exportConfig;
  const hasClient = d1Bindings.length > 0 || r2Bindings.length > 0 || kvBindings.length > 0 || authConfig;

  // Generate core code with config
  const coreConfig = { d1: d1Bindings, r2: r2Bindings, kv: kvBindings, auth: !!authConfig };
  const coreModuleCode = minifiedCore || generateCoreCode(coreConfig);
  const sharedCoreModuleCode = minifiedSharedCore || generateCoreCode({ ...coreConfig, shared: true });
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
    // Include default export (client) if configured
    const defaultExport = hasClient ? `\nexport { default } from ".${cpath}";` : "";
    return `import { createProxy } from ".${cpath}";\n${namedExports}${defaultExport}`;
  };

  const buildExportModule = (cpath, route, name) =>
    `import { createProxy } from ".${cpath}";\n` +
    `const _export = createProxy([${JSON.stringify(route)}, ${JSON.stringify(name)}]);\n` +
    `export default _export;\nexport { _export as ${name} };`;

  // D1 request handler
  const handleD1Request = async (env, msg) => {
    const { binding, method, sql, params = [], colName } = msg;
    const db = env[binding];
    if (!db) throw new Error(`D1 binding not found: ${binding}`);

    const stmt = db.prepare(sql).bind(...params);
    switch (method) {
      case "all": return { type: "result", value: await stmt.all() };
      case "first": return { type: "result", value: await stmt.first(colName) };
      case "run": return { type: "result", value: await stmt.run() };
      case "raw": return { type: "result", value: await stmt.raw() };
      default: throw new Error(`Unknown D1 method: ${method}`);
    }
  };

  // R2 request handler
  const handleR2Request = async (env, msg) => {
    const { binding, method, key, value, options } = msg;
    const bucket = env[binding];
    if (!bucket) throw new Error(`R2 binding not found: ${binding}`);

    switch (method) {
      case "get": {
        const obj = await bucket.get(key, options);
        if (!obj) return { type: "result", value: null };
        // Return object metadata and body as ArrayBuffer
        const body = await obj.arrayBuffer();
        return {
          type: "result",
          value: {
            body: new Uint8Array(body),
            key: obj.key,
            version: obj.version,
            size: obj.size,
            etag: obj.etag,
            httpEtag: obj.httpEtag,
            httpMetadata: obj.httpMetadata,
            customMetadata: obj.customMetadata,
          }
        };
      }
      case "put": {
        const result = await bucket.put(key, value, options);
        return { type: "result", value: result };
      }
      case "delete": {
        await bucket.delete(key);
        return { type: "result", value: true };
      }
      case "list": {
        const result = await bucket.list(options);
        return { type: "result", value: result };
      }
      case "head": {
        const obj = await bucket.head(key);
        return { type: "result", value: obj };
      }
      default: throw new Error(`Unknown R2 method: ${method}`);
    }
  };

  // KV request handler
  const handleKVRequest = async (env, msg) => {
    const { binding, method, key, value, options } = msg;
    const kv = env[binding];
    if (!kv) throw new Error(`KV binding not found: ${binding}`);

    switch (method) {
      case "get": return { type: "result", value: await kv.get(key, options) };
      case "put": {
        await kv.put(key, value, options);
        return { type: "result", value: true };
      }
      case "delete": {
        await kv.delete(key);
        return { type: "result", value: true };
      }
      case "list": return { type: "result", value: await kv.list(options) };
      case "getWithMetadata": return { type: "result", value: await kv.getWithMetadata(key, options) };
      default: throw new Error(`Unknown KV method: ${method}`);
    }
  };

  // Auth request handler (WebSocket-based auth operations)
  const handleAuthRequest = async (env, msg, wsSession) => {
    const { method, provider, email, password, name, options, token } = msg;

    // Handle methods that work without auth config
    if (!authConfig) {
      switch (method) {
        case "signOut":
          return { type: "result", value: { success: true } };
        case "getSession":
        case "getUser":
          return { type: "result", value: null };
        case "signIn.social": {
          const hint = provider ? ` For ${provider} OAuth, also set ${provider.toUpperCase()}_CLIENT_ID/SECRET env vars.` : "";
          return { type: "result", value: { error: `Auth not configured. Add 'auth: true' to cloudflare config in package.json.${hint}` } };
        }
        default:
          if (!["signIn.email", "signUp.email", "setToken"].includes(method)) {
            throw new Error(`Unknown auth method: ${method}`);
          }
          return { type: "result", value: { error: "Auth not configured. Add 'auth: true' to cloudflare config in package.json." } };
      }
    }

    const baseUrl = env.WORKER_URL || "https://localhost:8787";

    switch (method) {
      case "signIn.social": {
        // Return the OAuth URL for client to redirect to
        const callbackUrl = options?.callbackUrl || "/";
        const authUrl = `${baseUrl}/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        return { type: "result", value: { redirectUrl: authUrl } };
      }
      case "signIn.email": {
        // Forward to better-auth via internal fetch
        try {
          const response = await fetch(`${baseUrl}/api/auth/signin/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const data = await response.json();
          if (response.ok && data.token) {
            return { type: "result", value: { success: true, token: data.token, user: data.user } };
          }
          return { type: "result", value: { error: data.error || "Sign in failed" } };
        } catch (err) {
          return { type: "result", value: { error: String(err) } };
        }
      }
      case "signUp.email": {
        try {
          const response = await fetch(`${baseUrl}/api/auth/signup/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, name }),
          });
          const data = await response.json();
          if (response.ok && data.token) {
            return { type: "result", value: { success: true, token: data.token, user: data.user } };
          }
          return { type: "result", value: { error: data.error || "Sign up failed" } };
        } catch (err) {
          return { type: "result", value: { error: String(err) } };
        }
      }
      case "signOut": {
        // Clear session via better-auth
        if (wsSession?.token) {
          try {
            await fetch(`${baseUrl}/api/auth/signout`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Cookie": `better-auth.session_token=${wsSession.token}`,
              },
            });
          } catch {}
        }
        return { type: "result", value: { success: true } };
      }
      case "getSession": {
        if (!wsSession?.token) return { type: "result", value: null };
        const session = await verifySession(wsSession.token, env, authConfig);
        return { type: "result", value: session };
      }
      case "getUser": {
        if (!wsSession?.token) return { type: "result", value: null };
        const session = await verifySession(wsSession.token, env, authConfig);
        return { type: "result", value: session?.user || null };
      }
      case "setToken": {
        // Client sends token after OAuth redirect
        if (token) {
          const session = await verifySession(token, env, authConfig);
          if (session) {
            return { type: "result", value: { success: true, session } };
          }
        }
        return { type: "result", value: { error: "Invalid token" } };
      }
      default:
        throw new Error(`Unknown auth method: ${method}`);
    }
  };

  const dispatchMessage = async (dispatcher, msg, env, wsSession) => {
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
      // Client requests
      case "d1": return handleD1Request(env, msg);
      case "r2": return handleR2Request(env, msg);
      case "kv": return handleKVRequest(env, msg);
      case "auth": return handleAuthRequest(env, msg, wsSession);
    }
  };

  const wireWebSocket = (server, dispatcher, env, onClose) => {
    // Track session state for this WebSocket connection
    const wsSession = { token: null };

    server.addEventListener("message", async (event) => {
      let id;
      try {
        const msg = parse(event.data);
        id = msg.id;

        // Handle auth token updates (on reconnect or explicit setToken)
        if (msg.type === "auth" && msg.token && !msg.method) {
          // Direct token send on reconnect - just update session
          wsSession.token = msg.token;
          server.send(stringify({ type: "auth-result", id, success: true }));
          return;
        }

        const result = await dispatchMessage(dispatcher, msg, env, wsSession);

        // Extract token from auth responses
        if (result?.value?.token && msg.type === "auth") {
          wsSession.token = result.value.token;
        }

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
          wireWebSocket(server, stub, env);
        } else {
          const dispatcher = createRpcDispatcher(moduleMap);
          wireWebSocket(server, dispatcher, env, () => dispatcher.clearAll());
        }

        return new Response(null, { status: 101, webSocket: client });
      }

      // --- HTTP routing ---
      const pathname = url.pathname;

      // Auth routes (handled by better-auth)
      if (authConfig && pathname.startsWith("/api/auth/")) {
        return handleAuthRoute(request, env, authConfig);
      }

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
