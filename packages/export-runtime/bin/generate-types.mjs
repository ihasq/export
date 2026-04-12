#!/usr/bin/env node

import { parseSync } from "oxc-parser";
import { minifySync } from "oxc-minify";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const cwd = process.cwd();

// --- Read package.json for configuration ---

const pkgPath = path.join(cwd, "package.json");
if (!fs.existsSync(pkgPath)) {
  console.error("package.json not found in", cwd);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

// Required fields
const workerName = pkg.name;
if (!workerName) {
  console.error("package.json must have a 'name' field for the Worker name");
  process.exit(1);
}

const exportsEntry = pkg.exports;
if (!exportsEntry) {
  console.error("package.json must have an 'exports' field pointing to the source entry (e.g., './src' or './src/index.ts')");
  process.exit(1);
}

// Optional: static assets directory
const assetsDir = pkg.main || null;

// Optional: Cloudflare bindings configuration (d1, r2, kv, auth)
const cloudflareConfig = pkg.cloudflare || {};
const d1Bindings = cloudflareConfig.d1 || [];
const r2Bindings = cloudflareConfig.r2 || [];
const kvBindings = cloudflareConfig.kv || [];
const authConfig = cloudflareConfig.auth || null;

// Optional: Security configuration
const securityConfig = pkg.security || {};
const accessConfig = securityConfig.access || {};
const allowedOrigins = accessConfig.origin || []; // empty = allow all (default Workers behavior)

// Auth requires a D1 database for better-auth
const allD1Bindings = [...d1Bindings];
if (authConfig && !allD1Bindings.includes("AUTH_DB")) {
  allD1Bindings.unshift("AUTH_DB");
}

// Validate binding names
const validateBindings = (bindings, type) => {
  for (const name of bindings) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      console.error(`Invalid ${type} binding name: "${name}". Use UPPER_SNAKE_CASE.`);
      process.exit(1);
    }
  }
};
validateBindings(d1Bindings, "D1");
validateBindings(r2Bindings, "R2");
validateBindings(kvBindings, "KV");

// --- Resolve source directory from exports field ---

const exportsPath = path.resolve(cwd, exportsEntry.replace(/^\.\//, ""));
const srcDir = fs.existsSync(exportsPath) && fs.statSync(exportsPath).isDirectory()
  ? exportsPath
  : path.dirname(exportsPath);

if (!fs.existsSync(srcDir)) {
  console.error(`Source directory not found: ${srcDir}`);
  process.exit(1);
}

// --- Discover all source files under srcDir ---

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function discoverModules(dir, base = "") {
  const modules = [];
  if (!fs.existsSync(dir)) return modules;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      modules.push(...discoverModules(fullPath, base ? `${base}/${entry.name}` : entry.name));
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      const nameWithoutExt = entry.name.replace(/\.(ts|tsx|js|jsx)$/, "");
      const routePath = nameWithoutExt === "index"
        ? base  // index.ts → directory path ("" for root)
        : (base ? `${base}/${nameWithoutExt}` : nameWithoutExt);
      modules.push({ routePath, filePath: fullPath });
    }
  }
  return modules;
}

const modules = discoverModules(srcDir);
if (modules.length === 0) {
  console.error("No source files found in", srcDir);
  process.exit(1);
}

// --- Type extraction helpers ---

function extractType(node) {
  if (!node) return "any";
  const ta = node.type === "TSTypeAnnotation" ? node.typeAnnotation : node;
  switch (ta.type) {
    case "TSStringKeyword": return "string";
    case "TSNumberKeyword": return "number";
    case "TSBooleanKeyword": return "boolean";
    case "TSVoidKeyword": return "void";
    case "TSAnyKeyword": return "any";
    case "TSNullKeyword": return "null";
    case "TSUndefinedKeyword": return "undefined";
    case "TSNeverKeyword": return "never";
    case "TSUnknownKeyword": return "unknown";
    case "TSBigIntKeyword": return "bigint";
    case "TSSymbolKeyword": return "symbol";
    case "TSObjectKeyword": return "object";
    case "TSArrayType": return `${extractType(ta.elementType)}[]`;
    case "TSTupleType": return `[${(ta.elementTypes || []).map(e => extractType(e)).join(", ")}]`;
    case "TSUnionType": return ta.types.map(t => extractType(t)).join(" | ");
    case "TSIntersectionType": return ta.types.map(t => extractType(t)).join(" & ");
    case "TSLiteralType": {
      const lit = ta.literal;
      if (lit.type === "StringLiteral") return JSON.stringify(lit.value);
      if (lit.type === "NumericLiteral") return String(lit.value);
      if (lit.type === "BooleanLiteral") return String(lit.value);
      if (lit.type === "UnaryExpression") return `-${lit.argument.value}`;
      return "any";
    }
    case "TSTypeReference": {
      const name = ta.typeName?.name || ta.typeName?.right?.name || "any";
      const typeArgs = ta.typeArguments || ta.typeParameters;
      if (typeArgs?.params?.length) {
        const args = typeArgs.params.map(p => extractType(p)).join(", ");
        return `${name}<${args}>`;
      }
      return name;
    }
    case "TSFunctionType": {
      const params = extractParams(ta.params);
      const ret = ta.returnType ? extractType(ta.returnType) : "any";
      return `(${params.join(", ")}) => ${ret}`;
    }
    case "TSTypeLiteral": {
      const members = (ta.members || []).map(m => {
        if (m.type === "TSPropertySignature") {
          const key = m.key?.name || m.key?.value;
          const type = m.typeAnnotation ? extractType(m.typeAnnotation) : "any";
          const opt = m.optional ? "?" : "";
          return `${key}${opt}: ${type}`;
        }
        return "";
      }).filter(Boolean);
      return `{ ${members.join("; ")} }`;
    }
    case "TSTypeAnnotation": return extractType(ta.typeAnnotation);
    default: return "any";
  }
}

function extractParams(params) {
  return params.map(p => {
    if (p.type === "AssignmentPattern") {
      const name = p.left?.name || "arg";
      const type = p.left?.typeAnnotation ? extractType(p.left.typeAnnotation) : "any";
      return `${name}?: ${type}`;
    }
    const name = p.name || p.argument?.name || "arg";
    const type = p.typeAnnotation ? extractType(p.typeAnnotation) : "any";
    const opt = p.optional ? "?" : "";
    const rest = p.type === "RestElement" ? "..." : "";
    return `${rest}${name}${opt}: ${type}`;
  });
}

function wrapReturnType(returnType, isAsync, isGenerator) {
  if (isGenerator) {
    if (returnType.startsWith("AsyncGenerator")) {
      const inner = returnType.match(/^AsyncGenerator<(.+?)(?:,.*)?>/);
      return `Promise<AsyncIterable<${inner ? inner[1] : "any"}>>`;
    }
    return `Promise<AsyncIterable<${returnType === "any" ? "any" : returnType}>>`;
  }
  if (returnType.startsWith("Promise<")) return returnType;
  if (returnType.startsWith("ReadableStream")) return `Promise<${returnType}>`;
  return `Promise<${returnType}>`;
}

// --- Extract types and export names from a single file ---

function extractFileTypes(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);
  const result = parseSync(fileName, source, { sourceType: "module" });
  const program = result.program;

  const lines = [];
  const exportNames = [];

  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration" || !node.declaration) continue;
    const decl = node.declaration;

    if (decl.type === "FunctionDeclaration") {
      const name = decl.id.name;
      exportNames.push(name);
      const params = extractParams(decl.params);
      const rawRet = decl.returnType ? extractType(decl.returnType) : "any";
      const ret = wrapReturnType(rawRet, decl.async, decl.generator);
      lines.push(`export declare function ${name}(${params.join(", ")}): ${ret};`);
      lines.push("");
    } else if (decl.type === "ClassDeclaration") {
      const name = decl.id.name;
      exportNames.push(name);
      lines.push(`export declare class ${name} {`);
      for (const member of decl.body.body) {
        if (member.type === "MethodDefinition") {
          const mName = member.key.name || member.key.value;
          if (member.kind === "constructor") {
            lines.push(`  constructor(${extractParams(member.value.params).join(", ")});`);
          } else {
            const params = extractParams(member.value.params);
            const rawRet = member.value.returnType ? extractType(member.value.returnType) : "any";
            const ret = wrapReturnType(rawRet, member.value.async, member.value.generator);
            lines.push(`  ${mName}(${params.join(", ")}): ${ret};`);
          }
        } else if (member.type === "PropertyDefinition") {
          if (member.accessibility === "private") continue;
          const mName = member.key.name;
          const type = member.typeAnnotation ? extractType(member.typeAnnotation) : "any";
          lines.push(`  ${mName}: ${type};`);
        }
      }
      lines.push(`  [Symbol.dispose](): Promise<void>;`);
      lines.push(`  "[release]"(): Promise<void>;`);
      lines.push(`}`);
      lines.push("");
    } else if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        const name = d.id.name;
        exportNames.push(name);
        if (d.init?.type === "ObjectExpression") {
          lines.push(`export declare const ${name}: {`);
          for (const prop of d.init.properties) {
            if (prop.type === "SpreadElement") continue;
            const key = prop.key?.name || prop.key?.value;
            if (prop.value?.type === "FunctionExpression" || prop.value?.type === "ArrowFunctionExpression") {
              const params = extractParams(prop.value.params);
              const rawRet = prop.value.returnType ? extractType(prop.value.returnType) : "any";
              const ret = wrapReturnType(rawRet, prop.value.async, prop.value.generator);
              lines.push(`  ${key}(${params.join(", ")}): ${ret};`);
            } else {
              lines.push(`  ${key}: any;`);
            }
          }
          lines.push(`};`);
          lines.push("");
        } else {
          const type = d.id.typeAnnotation ? extractType(d.id.typeAnnotation) : "any";
          lines.push(`export declare const ${name}: ${type};`);
          lines.push("");
        }
      }
    }
  }

  return { types: lines.join("\n"), exportNames };
}

// --- Process all modules ---

const typesMap = {};     // routePath → type definition string
const exportsMap = {};   // routePath → export names array

for (const mod of modules) {
  const { types, exportNames } = extractFileTypes(mod.filePath);
  typesMap[mod.routePath] = types;
  exportsMap[mod.routePath] = exportNames;
}

// --- Minify core modules ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { generateCoreCode } = await import(path.join(__dirname, "..", "client.js"));

// Generate core code with export config
const coreConfig = {
  d1: allD1Bindings,
  r2: r2Bindings,
  kv: kvBindings,
  auth: !!authConfig,
};
const CORE_CODE = generateCoreCode(coreConfig);
const SHARED_CORE_CODE = generateCoreCode({ ...coreConfig, shared: true });

const minified = minifySync("_core.js", CORE_CODE);
if (minified.errors?.length) console.error("Minification errors (core):", minified.errors);

const minifiedShared = minifySync("_core-shared.js", SHARED_CORE_CODE);
if (minifiedShared.errors?.length) console.error("Minification errors (shared core):", minifiedShared.errors);

const coreId = crypto.randomUUID();

// --- Write .export-types.js ---

const outPath = path.join(cwd, ".export-types.js");
fs.writeFileSync(outPath, [
  `export default ${JSON.stringify(typesMap)};`,
  `export const minifiedCore = ${JSON.stringify(minified.code)};`,
  `export const minifiedSharedCore = ${JSON.stringify(minifiedShared.code)};`,
  `export const coreId = ${JSON.stringify(coreId)};`,
].join("\n") + "\n");

// --- Write .export-module-map.js ---

const moduleMapPath = path.join(cwd, ".export-module-map.js");
const relSrcDir = path.relative(cwd, srcDir);
const mapLines = [];
modules.forEach((mod, i) => {
  const relFile = "./" + path.relative(cwd, mod.filePath).replace(/\\/g, "/");
  mapLines.push(`import * as _${i} from ${JSON.stringify(relFile)};`);
});
mapLines.push(`export default { ${modules.map((mod, i) => `${JSON.stringify(mod.routePath)}: _${i}`).join(", ")} };`);
fs.writeFileSync(moduleMapPath, mapLines.join("\n") + "\n");

// --- Write .export-shared.js ---

const sharedModulePath = path.join(cwd, ".export-shared.js");
const sharedLines = [
  `import { env } from "cloudflare:workers";`,
  ``,
  `const getStub = (room = "default") =>`,
  `  env.SHARED_EXPORT.get(env.SHARED_EXPORT.idFromName(room));`,
  ``,
  `const createSharedInstanceProxy = (stub, instanceId, path = []) =>`,
  `  new Proxy(function(){}, {`,
  `    get(_, prop) {`,
  `      if (prop === "then" || prop === Symbol.toStringTag) return undefined;`,
  `      if (prop === Symbol.dispose || prop === Symbol.asyncDispose || prop === "[release]")`,
  `        return () => stub.rpcRelease(instanceId);`,
  `      return createSharedInstanceProxy(stub, instanceId, [...path, prop]);`,
  `    },`,
  `    async apply(_, __, args) {`,
  `      const r = await stub.rpcInstanceCall(instanceId, path, args);`,
  `      return r.value;`,
  `    },`,
  `  });`,
  ``,
  `const createSharedProxy = (stub, path = []) =>`,
  `  new Proxy(function(){}, {`,
  `    get(_, prop) {`,
  `      if (prop === "then" || prop === Symbol.toStringTag) return undefined;`,
  `      return createSharedProxy(stub, [...path, prop]);`,
  `    },`,
  `    async apply(_, __, args) {`,
  `      const r = await stub.rpcCall(path, args);`,
  `      return r.value;`,
  `    },`,
  `    async construct(_, args) {`,
  `      const r = await stub.rpcConstruct(path, args);`,
  `      return createSharedInstanceProxy(stub, r.instanceId);`,
  `    },`,
  `  });`,
  ``,
  `const _stub = getStub();`,
];
// Generate proxies for all modules' exports, prefixed with route
for (const mod of modules) {
  const names = exportsMap[mod.routePath] || [];
  for (const n of names) {
    const proxyPath = mod.routePath ? `[${JSON.stringify(mod.routePath)}, ${JSON.stringify(n)}]` : `[${JSON.stringify("")}, ${JSON.stringify(n)}]`;
    const exportAlias = mod.routePath ? `${mod.routePath.replace(/\//g, "_")}_${n}` : n;
    sharedLines.push(`export const ${exportAlias} = createSharedProxy(_stub, ${proxyPath});`);
  }
}
sharedLines.push(`export { getStub };`);
fs.writeFileSync(sharedModulePath, sharedLines.join("\n") + "\n");

// --- Generate wrangler.toml ---

const wranglerLines = [
  `# Auto-generated by export-runtime. Do not edit manually.`,
  `name = "${workerName}"`,
  `main = "node_modules/export-runtime/entry.js"`,
  `compatibility_date = "2024-11-01"`,
  ``,
];

// Add static assets configuration if main is specified
if (assetsDir) {
  const normalizedAssetsDir = assetsDir.startsWith("./") ? assetsDir : `./${assetsDir}`;
  wranglerLines.push(
    `[assets]`,
    `directory = "${normalizedAssetsDir}"`,
    `binding = "ASSETS"`,
    `run_worker_first = true`,
    ``,
  );
}

// Add Durable Objects for shared state
wranglerLines.push(
  `[durable_objects]`,
  `bindings = [`,
  `  { name = "SHARED_EXPORT", class_name = "SharedExportDO" }`,
  `]`,
  ``,
  `[[migrations]]`,
  `tag = "v1"`,
  `new_classes = ["SharedExportDO"]`,
  ``,
);

// Add D1 bindings
if (allD1Bindings.length > 0) {
  for (const name of allD1Bindings) {
    wranglerLines.push(`[[d1_databases]]`);
    wranglerLines.push(`binding = "${name}"`);
    wranglerLines.push(`database_name = "${workerName}-${name.toLowerCase().replace(/_/g, "-")}"`);
    wranglerLines.push(`database_id = "" # Run: wrangler d1 create ${workerName}-${name.toLowerCase().replace(/_/g, "-")}`);
    wranglerLines.push(``);
  }
}

// Add R2 bindings
if (r2Bindings.length > 0) {
  for (const name of r2Bindings) {
    wranglerLines.push(`[[r2_buckets]]`);
    wranglerLines.push(`binding = "${name}"`);
    wranglerLines.push(`bucket_name = "${workerName}-${name.toLowerCase().replace(/_/g, "-")}"`);
    wranglerLines.push(``);
  }
}

// Add KV bindings
if (kvBindings.length > 0) {
  for (const name of kvBindings) {
    wranglerLines.push(`[[kv_namespaces]]`);
    wranglerLines.push(`binding = "${name}"`);
    wranglerLines.push(`id = "" # Run: wrangler kv namespace create ${name}`);
    wranglerLines.push(``);
  }
}

// Add alias
wranglerLines.push(
  `[alias]`,
  `"__USER_MODULE__" = "./.export-module-map.js"`,
  `"__GENERATED_TYPES__" = "./.export-types.js"`,
  `"__SHARED_MODULE__" = "./.export-shared.js"`,
  `"__EXPORT_CONFIG__" = "./.export-config.js"`,
  ``,
);

// --- Write .export-config.js ---

const configPath = path.join(cwd, ".export-config.js");
const configContent = `// Auto-generated export configuration
export const d1Bindings = ${JSON.stringify(allD1Bindings)};
export const r2Bindings = ${JSON.stringify(r2Bindings)};
export const kvBindings = ${JSON.stringify(kvBindings)};
export const authConfig = ${JSON.stringify(authConfig)};
export const securityConfig = ${JSON.stringify({ access: { origin: allowedOrigins } })};
`;
fs.writeFileSync(configPath, configContent);

const wranglerPath = path.join(cwd, "wrangler.toml");
fs.writeFileSync(wranglerPath, wranglerLines.join("\n"));

// --- Generate .export-client.d.ts ---

const clientDtsLines = [
  `// Auto-generated client type definitions. Do not edit manually.`,
  ``,
  `/** D1 query result from tagged template literal */`,
  `export interface ExportD1Query<T = Record<string, unknown>> {`,
  `  /** Execute query and return all results */`,
  `  all(): Promise<{ results: T[]; success: boolean; meta: object }>;`,
  `  /** Execute query and return first result */`,
  `  first<K extends keyof T>(colName?: K): Promise<K extends keyof T ? T[K] : T | null>;`,
  `  /** Execute query without returning results */`,
  `  run(): Promise<{ success: boolean; meta: object }>;`,
  `  /** Execute query and return raw array results */`,
  `  raw<K extends keyof T = keyof T>(): Promise<K extends keyof T ? T[K][] : unknown[][]>;`,
  `  /** Thenable - defaults to .all() */`,
  `  then<TResult = { results: T[]; success: boolean; meta: object }>(`,
  `    onfulfilled?: (value: { results: T[]; success: boolean; meta: object }) => TResult | PromiseLike<TResult>,`,
  `    onrejected?: (reason: any) => TResult | PromiseLike<TResult>`,
  `  ): Promise<TResult>;`,
  `}`,
  ``,
  `/** D1 database proxy - use as tagged template literal */`,
  `export interface ExportD1Proxy {`,
  `  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): ExportD1Query<T>;`,
  `}`,
  ``,
  `/** R2 object metadata */`,
  `export interface ExportR2ObjectMeta {`,
  `  key: string;`,
  `  size: number;`,
  `  etag: string;`,
  `  httpEtag: string;`,
  `  uploaded: Date;`,
  `  httpMetadata?: Record<string, string>;`,
  `  customMetadata?: Record<string, string>;`,
  `}`,
  ``,
  `/** R2 object with body */`,
  `export interface ExportR2Object extends ExportR2ObjectMeta {`,
  `  body: ReadableStream<Uint8Array>;`,
  `  bodyUsed: boolean;`,
  `  arrayBuffer(): Promise<ArrayBuffer>;`,
  `  text(): Promise<string>;`,
  `  json<T = unknown>(): Promise<T>;`,
  `  blob(): Promise<Blob>;`,
  `}`,
  ``,
  `/** R2 list result */`,
  `export interface ExportR2ListResult {`,
  `  objects: ExportR2ObjectMeta[];`,
  `  truncated: boolean;`,
  `  cursor?: string;`,
  `  delimitedPrefixes: string[];`,
  `}`,
  ``,
  `/** R2 bucket proxy */`,
  `export interface ExportR2Proxy {`,
  `  get(key: string, options?: { type?: "arrayBuffer" | "text" | "json" | "stream" }): Promise<ExportR2Object | null>;`,
  `  put(key: string, value: string | ArrayBuffer | ReadableStream | Blob, options?: {`,
  `    httpMetadata?: Record<string, string>;`,
  `    customMetadata?: Record<string, string>;`,
  `  }): Promise<ExportR2ObjectMeta>;`,
  `  delete(key: string | string[]): Promise<void>;`,
  `  list(options?: {`,
  `    prefix?: string;`,
  `    limit?: number;`,
  `    cursor?: string;`,
  `    delimiter?: string;`,
  `    include?: ("httpMetadata" | "customMetadata")[];`,
  `  }): Promise<ExportR2ListResult>;`,
  `  head(key: string): Promise<ExportR2ObjectMeta | null>;`,
  `}`,
  ``,
  `/** KV list result */`,
  `export interface ExportKVListResult {`,
  `  keys: { name: string; expiration?: number; metadata?: unknown }[];`,
  `  list_complete: boolean;`,
  `  cursor?: string;`,
  `}`,
  ``,
  `/** KV namespace proxy */`,
  `export interface ExportKVProxy {`,
  `  get<T = string>(key: string, options?: { type?: "text" | "json" | "arrayBuffer" | "stream"; cacheTtl?: number }): Promise<T | null>;`,
  `  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: {`,
  `    expiration?: number;`,
  `    expirationTtl?: number;`,
  `    metadata?: unknown;`,
  `  }): Promise<void>;`,
  `  delete(key: string): Promise<void>;`,
  `  list(options?: {`,
  `    prefix?: string;`,
  `    limit?: number;`,
  `    cursor?: string;`,
  `  }): Promise<ExportKVListResult>;`,
  `  getWithMetadata<T = string, M = unknown>(key: string, options?: { type?: "text" | "json" | "arrayBuffer" | "stream"; cacheTtl?: number }): Promise<{`,
  `    value: T | null;`,
  `    metadata: M | null;`,
  `  }>;`,
  `}`,
  ``,
  `/** Auth sign-in methods */`,
  `export interface ExportAuthSignIn {`,
  `  /** Sign in with OAuth provider */`,
  `  social(provider: string, options?: { callbackURL?: string; scopes?: string[] }): Promise<{ redirectUrl?: string; token?: string; user?: object }>;`,
  `  /** Sign in with email and password */`,
  `  email(email: string, password: string, options?: object): Promise<{ success: boolean; token?: string; user?: object; error?: string }>;`,
  `}`,
  ``,
  `/** Auth sign-up methods */`,
  `export interface ExportAuthSignUp {`,
  `  /** Sign up with email, password, and name */`,
  `  email(email: string, password: string, name?: string, options?: object): Promise<{ success: boolean; token?: string; user?: object; error?: string }>;`,
  `}`,
  ``,
  `/** Auth session */`,
  `export interface ExportAuthSession {`,
  `  token: string;`,
  `  userId: string;`,
  `  expiresAt: Date;`,
  `}`,
  ``,
  `/** Auth user */`,
  `export interface ExportAuthUser {`,
  `  id: string;`,
  `  email: string;`,
  `  name?: string;`,
  `  image?: string;`,
  `  emailVerified: boolean;`,
  `  createdAt: Date;`,
  `  updatedAt: Date;`,
  `}`,
  ``,
  `/** Auth client proxy */`,
  `export interface ExportAuthProxy {`,
  `  signIn: ExportAuthSignIn;`,
  `  signUp: ExportAuthSignUp;`,
  `  signOut(): Promise<{ success: boolean }>;`,
  `  getSession(): Promise<ExportAuthSession | null>;`,
  `  getUser(): Promise<ExportAuthUser | null>;`,
  `  setToken(token: string): Promise<{ success: boolean }>;`,
  `  readonly isAuthenticated: boolean;`,
  `}`,
  ``,
];

// Generate D1 type mapping
if (allD1Bindings.length > 0) {
  clientDtsLines.push(`/** D1 database bindings */`);
  clientDtsLines.push(`export interface ExportD1Bindings {`);
  for (const name of allD1Bindings) {
    clientDtsLines.push(`  ${name}: ExportD1Proxy;`);
  }
  clientDtsLines.push(`}`);
  clientDtsLines.push(``);
} else {
  clientDtsLines.push(`export interface ExportD1Bindings {}`);
  clientDtsLines.push(``);
}

// Generate R2 type mapping
if (r2Bindings.length > 0) {
  clientDtsLines.push(`/** R2 bucket bindings */`);
  clientDtsLines.push(`export interface ExportR2Bindings {`);
  for (const name of r2Bindings) {
    clientDtsLines.push(`  ${name}: ExportR2Proxy;`);
  }
  clientDtsLines.push(`}`);
  clientDtsLines.push(``);
} else {
  clientDtsLines.push(`export interface ExportR2Bindings {}`);
  clientDtsLines.push(``);
}

// Generate KV type mapping
if (kvBindings.length > 0) {
  clientDtsLines.push(`/** KV namespace bindings */`);
  clientDtsLines.push(`export interface ExportKVBindings {`);
  for (const name of kvBindings) {
    clientDtsLines.push(`  ${name}: ExportKVProxy;`);
  }
  clientDtsLines.push(`}`);
  clientDtsLines.push(``);
} else {
  clientDtsLines.push(`export interface ExportKVBindings {}`);
  clientDtsLines.push(``);
}

// Generate main client interface
clientDtsLines.push(`/** Export client with typed storage bindings */`);
clientDtsLines.push(`export interface ExportClient {`);
clientDtsLines.push(`  d1: ExportD1Bindings;`);
clientDtsLines.push(`  r2: ExportR2Bindings;`);
clientDtsLines.push(`  kv: ExportKVBindings;`);
clientDtsLines.push(`  auth: ${authConfig ? 'ExportAuthProxy' : 'null'};`);
clientDtsLines.push(`}`);
clientDtsLines.push(``);
clientDtsLines.push(`declare const client: ExportClient;`);
clientDtsLines.push(`export default client;`);
clientDtsLines.push(``);

const clientDtsPath = path.join(cwd, ".export-client.d.ts");
fs.writeFileSync(clientDtsPath, clientDtsLines.join("\n"));

// --- Generate export.d.ts (module declaration helper) ---

const moduleDtsLines = [
  `// Type declarations for your export worker.`,
  `// Update the URL to match your deployed worker or local dev server.`,
  `//`,
  `// Usage in your client code:`,
  `//   import client, { myFunction } from "https://my-worker.workers.dev";`,
  `//   const result = await client.d1.MY_DB\`SELECT * FROM users\`;`,
  ``,
  `declare module "http://localhost:8787" {`,
  `  export * from "./.export-client";`,
  `  export { default } from "./.export-client";`,
  `}`,
  ``,
  `// Add more module declarations for your deployed URLs:`,
  `// declare module "https://my-worker.workers.dev" {`,
  `//   export * from "./.export-client";`,
  `//   export { default } from "./.export-client";`,
  `// }`,
  ``,
];

const moduleDtsPath = path.join(cwd, "export.d.ts");
// Only write if it doesn't exist (user may have customized it)
if (!fs.existsSync(moduleDtsPath)) {
  fs.writeFileSync(moduleDtsPath, moduleDtsLines.join("\n"));
  console.log("Generated module declarations →", moduleDtsPath);
}

// --- Output summary ---

console.log(`Discovered ${modules.length} module(s): ${modules.map(m => m.routePath || "/").join(", ")}`);
console.log("Generated type definitions + minified core →", outPath);
console.log("Generated module map →", moduleMapPath);
console.log("Generated shared import module →", sharedModulePath);
console.log("Generated client types →", clientDtsPath);
console.log("Generated wrangler.toml →", wranglerPath);
